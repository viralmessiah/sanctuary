from calendar import monthrange
from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError


CENT = Decimal("0.01")


def money(value):
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def active_loan_settings():
    from .models import LoanSettings

    settings = LoanSettings.objects.filter(is_active=True).first()
    if settings is None:
        raise ValidationError({"loan_settings": "No active loan settings are configured."})
    return settings


def add_months(value, months):
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def repayment_terms(principal, monthly_rate, months, start_date=None):
    principal = money(principal)
    rate = Decimal(str(monthly_rate))
    if principal <= 0 or rate < 0 or int(months) <= 0:
        raise ValidationError({"loan_terms": "Principal, interest rate, and tenor must be valid positive values."})
    months = int(months)
    schedule = []
    base_principal = money(principal / months)
    remaining_principal = principal
    interest_total = Decimal("0.00")
    start_date = start_date or date.today()
    for index in range(1, months + 1):
        principal_due = remaining_principal if index == months else min(base_principal, remaining_principal)
        interest_due = money(remaining_principal * rate / Decimal("100"))
        installment = money(principal_due + interest_due)
        interest_total += interest_due
        schedule.append({
            "installment": index,
            "due_date": add_months(start_date, index).isoformat(),
            "principal": str(money(principal_due)),
            "interest": str(interest_due),
            "amount": str(money(installment)),
        })
        remaining_principal = money(remaining_principal - principal_due)
    interest_total = money(interest_total)
    total = money(principal + interest_total)
    return {
        "principal": principal,
        "interest_total": interest_total,
        "total_cost": total,
        "schedule": schedule,
    }


def offtake_contract_value(contract):
    quantity = Decimal(str(contract.quantity or 0))
    price_per_unit = Decimal(str(contract.price_per_unit or 0))
    if quantity <= 0 or price_per_unit <= 0:
        raise ValidationError({"offtake_contract_id": "The buyer contract needs positive quantity and price."})
    return money(quantity * price_per_unit)


def buyer_guarantee_amount(contract, settings):
    guarantee = money(
        offtake_contract_value(contract)
        * Decimal(str(settings.buyer_withholding_percentage or 0))
        / Decimal("100")
    )
    if settings.maximum_withholding_amount is not None:
        guarantee = min(guarantee, money(settings.maximum_withholding_amount))
    return guarantee


def contract_release_ready(contract):
    return bool(
        contract
        and contract.status == "active"
        and contract.farmer_signed_at
        and contract.buyer_signed_at
        and contract.loan_officer_user_id
        and contract.loan_officer_signed_at
        and contract.buyer_guarantee_accepted_at
        and contract.buyer_guarantee_amount
        and Decimal(str(contract.buyer_guarantee_amount)) > 0
    )


def loan_balances(financing_request_id):
    from .models import LoanLedgerEntry

    entries = LoanLedgerEntry.objects.filter(financing_request_id=str(financing_request_id))
    principal = Decimal("0.00")
    interest = Decimal("0.00")
    for entry in entries:
        principal += Decimal(str(entry.principal_delta or 0))
        interest += Decimal(str(entry.interest_delta or 0))
    return money(principal), money(interest)


def append_ledger_entry(*, financing_request, entry_type, amount, principal_delta=0, interest_delta=0,
                        facility_id="", settlement_id="", reference="", notes="", metadata=None,
                        effective_date=None):
    from .models import LoanLedgerEntry

    principal_delta = money(principal_delta)
    interest_delta = money(interest_delta)
    principal_balance, interest_balance = loan_balances(financing_request.pk)
    principal_balance = money(principal_balance + principal_delta)
    interest_balance = money(interest_balance + interest_delta)
    if principal_balance < 0 or interest_balance < 0:
        raise ValidationError({"amount": "This ledger entry would create a negative loan balance."})
    return LoanLedgerEntry.objects.create(
        created_by=financing_request.created_by,
        financing_request_id=str(financing_request.pk),
        facility_id=str(facility_id or ""),
        settlement_id=str(settlement_id or ""),
        entry_type=entry_type,
        amount=money(amount),
        principal_delta=principal_delta,
        interest_delta=interest_delta,
        principal_balance=principal_balance,
        interest_balance=interest_balance,
        effective_date=effective_date or timezone.now(),
        external_reference=reference,
        notes=notes,
        metadata=metadata or {},
    )


def accrue_monthly_interest(financing_request, through_date=None):
    from .models import LoanDisbursement, LoanLedgerEntry

    through_date = through_date or date.today()
    if isinstance(through_date, datetime):
        through_date = through_date.date()
    if not financing_request.monthly_interest_rate or not financing_request.tenor_months:
        return []
    tranches = LoanDisbursement.objects.filter(
        financing_request_id=str(financing_request.pk), status="released",
    ).order_by("released_at", "created_date")
    entries = []
    for tranche in tranches:
        release_date = (tranche.released_at or tranche.created_date).date()
        for period in range(1, int(financing_request.tenor_months) + 1):
            accrual_date = add_months(release_date, period)
            if accrual_date > through_date:
                break
            marker = {"tranche_id": str(tranche.pk), "period": period}
            if LoanLedgerEntry.objects.filter(
                financing_request_id=str(financing_request.pk),
                entry_type="interest_accrual",
                metadata=marker,
            ).exists():
                continue
            outstanding = _tranche_outstanding(financing_request, tranche, accrual_date)
            accrued = money(outstanding * Decimal(str(financing_request.monthly_interest_rate)) / Decimal("100"))
            if accrued <= 0:
                continue
            entries.append(append_ledger_entry(
                financing_request=financing_request,
                entry_type="interest_accrual",
                amount=accrued,
                interest_delta=accrued,
                facility_id=tranche.facility_id,
                effective_date=timezone.make_aware(datetime.combine(accrual_date, time.min)),
                notes=f"Simple monthly interest at {financing_request.monthly_interest_rate}% on outstanding principal.",
                metadata=marker,
            ))
    return entries


def accrue_portfolio_interest(actor=None, through_date=None):
    from .models import AuditLog, FinancingRequest

    through_date = through_date or timezone.localdate()
    created = 0
    with transaction.atomic():
        financings = FinancingRequest.objects.select_for_update().filter(status="approved").order_by("pk")
        for financing in financings:
            entries = accrue_monthly_interest(financing, through_date)
            if not entries:
                continue
            AuditLog.objects.create(
                created_by=actor,
                actor_email=actor.email if actor else "system",
                action="MONTHLY_INTEREST_ACCRUAL",
                entity_type="FinancingRequest",
                entity_id=str(financing.pk),
                notes=f"Posted {len(entries)} monthly interest accrual entries.",
            )
            created += len(entries)
    return created


def _tranche_outstanding(financing_request, selected_tranche, through_date):
    from .models import LoanDisbursement, LoanLedgerEntry

    tranches = list(LoanDisbursement.objects.filter(
        financing_request_id=str(financing_request.pk),
        status="released",
        released_at__date__lte=through_date,
    ).order_by("released_at", "created_date"))
    balances = {str(tranche.pk): Decimal("0.00") for tranche in tranches}
    ledger = LoanLedgerEntry.objects.filter(
        financing_request_id=str(financing_request.pk),
        effective_date__date__lte=through_date,
    ).order_by("effective_date", "created_date")
    for movement in ledger:
        delta = Decimal(str(movement.principal_delta or 0))
        if movement.entry_type == "disbursement" and delta > 0:
            tranche_id = str((movement.metadata or {}).get("tranche_id") or "")
            if tranche_id in balances:
                balances[tranche_id] += delta
        elif delta < 0:
            repayment = -delta
            for tranche in tranches:
                tranche_id = str(tranche.pk)
                paid = min(balances[tranche_id], repayment)
                balances[tranche_id] -= paid
                repayment -= paid
                if repayment <= 0:
                    break
    return money(balances.get(str(selected_tranche.pk), 0))
