"""Generic entity API: the same operations the Base44 SDK exposed (list / filter / get / create / update /
delete / bulk*), enforced with agri.policies. URL layout is in agri/urls.py."""
import json
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace
from uuid import UUID

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models as dj
from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import policies
from . import finance
from .models import (
    ENTITIES, Agreement, BuyerProfile, FarmerProfile, FieldOfficerProfile, FundingFacility,
    LoanDisbursement, LoanLedgerEntry, OfftakeContract, Order,
)
from .serializers import SERIALIZERS, SYSTEM_FIELDS, editable_fields

DEFAULT_LIMIT, MAX_LIMIT, MAX_BULK = 1000, 5000, 500
OPERATORS = {"$gt": "gt", "$gte": "gte", "$lt": "lt", "$lte": "lte", "$in": "in", "$ne": None, "$nin": None, "$contains": "icontains"}


class NoMatch(Exception):
    """A filter value that can't possibly match anything (e.g. a malformed UUID)."""


def _model(name):
    model = ENTITIES.get(name)
    if model is None:
        raise NotFound(f"Unknown entity '{name}'.")
    return model


# --- query language ------------------------------------------------------------------------------------
def _filterable(model):
    """Only real, non-JSON columns may be filtered/sorted on - never arbitrary ORM lookups."""
    fields = {f.attname: f for f in model._meta.concrete_fields if not isinstance(f, dj.JSONField)}
    fields["created_by_id"] = model._meta.get_field("created_by")
    fields["id"] = model._meta.pk
    return fields


def _coerce(field, value):
    if value is None:
        return None
    if field is None:  # created_by (email)
        return str(value)
    try:
        if isinstance(field, dj.UUIDField) or isinstance(field, dj.ForeignKey):
            return UUID(str(value))
        if isinstance(field, dj.DecimalField):
            return Decimal(str(value))
        if isinstance(field, dj.BooleanField):
            return value if isinstance(value, bool) else str(value).lower() in ("1", "true")
        return field.to_python(value)
    except (ValueError, InvalidOperation, DjangoValidationError):
        raise NoMatch


def build_q(model, query):
    if not isinstance(query, dict):
        raise ValidationError({"q": "Query must be an object."})
    fields = _filterable(model)
    q = Q()
    for key, cond in query.items():
        if key in ("$or", "$and"):
            if not isinstance(cond, list):
                raise ValidationError({"q": f"{key} needs a list."})
            parts = []
            for sub in cond:
                try:
                    parts.append(build_q(model, sub))
                except NoMatch:
                    if key == "$and":
                        raise
                    continue
            if key == "$or":
                combined = Q(pk__in=[])
                for part in parts:
                    combined |= part
                q &= combined
            else:
                for part in parts:
                    q &= part
            continue
        if key == "created_by":
            lookup, field = "created_by__email", None
        elif key in fields:
            lookup, field = key, fields[key]
        else:
            raise ValidationError({"q": f"Unknown field '{key}'."})
        ops = cond if isinstance(cond, dict) else {"": cond}
        for op, value in ops.items():
            if op == "":
                q &= Q(**{f"{lookup}__isnull": True}) if value is None else Q(**{lookup: _coerce(field, value)})
            elif op not in OPERATORS:
                raise ValidationError({"q": f"Unsupported operator '{op}'."})
            elif op in ("$in", "$nin"):
                if not isinstance(value, list):
                    raise ValidationError({"q": f"{op} needs a list."})
                try:
                    values = [_coerce(field, v) for v in value]
                except NoMatch:  # drop un-coercible members instead of failing the whole query
                    values = []
                    for v in value:
                        try:
                            values.append(_coerce(field, v))
                        except NoMatch:
                            pass
                cond_q = Q(**{f"{lookup}__in": values})
                q &= cond_q if op == "$in" else ~cond_q
            elif op == "$ne":
                q &= ~Q(**{lookup: _coerce(field, value)}) if value is not None else Q(**{f"{lookup}__isnull": False})
            elif op == "$contains":
                if not isinstance(field, (dj.CharField, dj.TextField)):
                    raise ValidationError({"q": "$contains only works on text fields."})
                q &= Q(**{f"{lookup}__icontains": str(value)})
            else:
                q &= Q(**{f"{lookup}__{OPERATORS[op]}": _coerce(field, value)})
    return q


def apply_query(model, queryset, query=None, sort=None, limit=None, skip=None):
    try:
        queryset = queryset.filter(build_q(model, query or {}))
    except NoMatch:
        return queryset.none()
    fields = _filterable(model)
    order = []
    for part in str(sort or "-created_date").split(","):
        part = part.strip()
        name = part.lstrip("-")
        if name not in fields:
            raise ValidationError({"sort": f"Cannot sort by '{name}'."})
        order.append(part)
    order.append("-created_date" if "created_date" not in [o.lstrip("-") for o in order] else "id")
    queryset = queryset.order_by(*order)
    try:
        skip = max(int(skip or 0), 0)
        limit = min(int(limit) if limit not in (None, "") else DEFAULT_LIMIT, MAX_LIMIT)
    except (TypeError, ValueError):
        raise ValidationError({"limit": "limit/skip must be integers."})
    return queryset[skip: skip + max(limit, 0)]


# --- write path ----------------------------------------------------------------------------------------
def _same(a, b):
    return str(a) == str(b)


def _reconciliation_total(settlement, payment_type, statuses):
    claims = ENTITIES["SettlementReconciliation"].objects.filter(
        settlement_id=str(settlement.pk),
        payment_type=payment_type,
        status__in=statuses,
    )
    return finance.money(sum((finance.money(item.amount) for item in claims), Decimal("0.00")))


def _refresh_settlement_reconciliation(settlement):
    reported_statuses = ["pending_verification", "verified"]
    buyer_reported = _reconciliation_total(settlement, "buyer_withholding", reported_statuses)
    buyer_verified = _reconciliation_total(settlement, "buyer_withholding", ["verified"])
    farmer_reported = _reconciliation_total(settlement, "farmer_payment", reported_statuses)
    farmer_verified = _reconciliation_total(settlement, "farmer_payment", ["verified"])
    buyer_due = finance.money(settlement.buyer_withholding_amount or 0)
    farmer_due = finance.money(settlement.farmer_payment_due_amount or 0)

    def payment_status(due, reported, verified):
        if due <= 0 or verified >= due:
            return "verified"
        if verified > 0:
            return "partially_verified"
        if reported > 0:
            return "pending_verification"
        return "due"

    settlement.buyer_remitted_amount = buyer_reported
    settlement.buyer_verified_received_amount = buyer_verified
    settlement.buyer_remittance_status = payment_status(buyer_due, buyer_reported, buyer_verified)
    settlement.farmer_payment_reported_amount = farmer_reported
    settlement.farmer_payment_verified_amount = farmer_verified
    settlement.farmer_payment_status = payment_status(farmer_due, farmer_reported, farmer_verified)
    settlement.buyer_exposure_amount = finance.money(max(buyer_due - buyer_verified, Decimal("0.00")))
    settlement.farmer_balance = finance.money(max(farmer_due - farmer_verified, Decimal("0.00")))
    settlement.loan_repayment_amount = buyer_verified
    if settlement.status != "disputed":
        settlement.status = (
            "paid"
            if settlement.buyer_remittance_status == "verified"
            and settlement.farmer_payment_status == "verified"
            else "approved"
        )
    settlement.payment_date = timezone.now() if settlement.status == "paid" else None
    settlement.save(update_fields=[
        "buyer_remitted_amount", "buyer_verified_received_amount", "buyer_remittance_status",
        "farmer_payment_reported_amount", "farmer_payment_verified_amount", "farmer_payment_status",
        "buyer_exposure_amount", "farmer_balance", "loan_repayment_amount", "status", "payment_date",
        "updated_date",
    ])
    if settlement.harvest_id:
        ENTITIES["Harvest"].objects.filter(pk=_uuid_or_none(settlement.harvest_id)).update(
            settlement_status="settled" if settlement.status == "paid" else "delivered",
        )


def apply_guards(model_name, user, instance, data, creating):
    """Hardening on top of the ported rules - see agri/policies.py."""
    if model_name == "Harvest" and data.get("settlement_status") in {"settled", "closed"}:
        raise ValidationError({"settlement_status": "Harvest completion is derived from verified delivery reconciliation."})
    if model_name == "Settlement" and not creating and instance.offtake_contract_id:
        delivery_facts = {
            "harvest_id", "offtake_contract_id", "buyer_user_id", "farmer_user_id", "delivery_quantity",
            "unit", "crop_grade", "delivery_date", "price_per_unit", "delivery_evidence_url", "gross_sale_amount",
            "amount", "buyer_withholding_amount",
        }
        altered_facts = {
            name for name in delivery_facts.intersection(data)
            if not _same(data[name], getattr(instance, name, None))
        }
        if altered_facts:
            raise ValidationError({
                name: "Recorded delivery facts are immutable; use the delivery dispute workflow for corrections."
                for name in sorted(altered_facts)
            })
        server_managed = {
            "buyer_remitted_amount", "buyer_verified_received_amount", "buyer_remittance_status",
            "farmer_payment_due_amount", "farmer_payment_reported_amount", "farmer_payment_verified_amount",
            "farmer_payment_status", "buyer_exposure_amount", "loan_repayment_amount", "farmer_balance",
            "payment_date", "payment_reference",
        }
        attempted = server_managed.intersection(data)
        if attempted:
            raise ValidationError({
                name: "This value is updated only by verified reconciliation claims."
                for name in sorted(attempted)
            })
        if data.get("status") == "paid":
            raise ValidationError({"status": "Settlement completion is derived from verified reconciliation claims."})
    if model_name == "SettlementReconciliation" and not creating:
        if set(data) - {"status", "reviewer_notes"}:
            raise ValidationError({"detail": "A remittance claim can only be verified or rejected by an administrator."})
    if policies.is_admin(user):
        return data
    guards = policies.GUARDS.get(model_name, {})
    model = ENTITIES[model_name]
    for name, allowed in guards.items():
        if name not in data:
            continue
        if creating:
            if not allowed(user, None, data[name]):
                data[name] = model._meta.get_field(name).get_default()
        elif not _same(data[name], getattr(instance, name)) and not allowed(user, instance, data[name]):
            raise PermissionDenied(f"You are not allowed to change '{name}'.")
    if not creating and model_name in policies.UPDATE_ONLY:
        extra = [n for n in data if n not in policies.UPDATE_ONLY[model_name] and not _same(data[n], getattr(instance, n, None))]
        if extra:
            raise PermissionDenied(f"You may only update: {', '.join(sorted(policies.UPDATE_ONLY[model_name]))}.")
    return data


def create_checks(model_name, user, data):
    """Per-entity invariants that can't be expressed as a simple rule."""
    if model_name == "VendorEmployee":
        raise PermissionDenied("Create employee invitations through the vendor employee invitation workflow.")
    if model_name == "VendorProfile" and not policies.is_admin(user):
        vendor_user_id = policies.vendor_account_id(user, "team")
        if not vendor_user_id:
            raise PermissionDenied("Only a vendor or an approved manager can set up this vendor profile.")
        if ENTITIES["VendorProfile"].objects.filter(created_by_id=_uuid_or_none(vendor_user_id)).exists():
            raise ValidationError({"business_name": "This vendor account already has a profile."})
    if model_name == "KYCVerification" and data.get("user_type") == "vendor" and not policies.is_admin(user):
        vendor_user_id = policies.vendor_account_id(user, "team")
        if not vendor_user_id:
            raise PermissionDenied("Only a vendor or an approved manager can submit vendor verification documents.")
        profile = ENTITIES["VendorProfile"].objects.filter(
            created_by_id=_uuid_or_none(vendor_user_id),
        ).first()
        if profile:
            data["applicant_name"] = profile.business_name
    if model_name == "AuditLog":
        data["actor_email"] = user.email  # never trust the client for who did it
    if model_name == "FarmerProfile":
        data["verification_status"] = "not_started"
    if model_name == "FieldVerification":
        data["status"] = "assigned"
    if model_name == "LoanSettings":
        _validate_loan_settings(data)
    if model_name == "Conversation":
        first_id = str(user.pk)
        other_id = str(data.get("user2_id") or "")
        if str(data.get("user1_id") or "") != first_id:
            raise PermissionDenied("Start a conversation as the signed-in user.")
        if not other_id or other_id == first_id:
            raise ValidationError({"user2_id": "Choose another active user to message."})
        other = get_user_model().objects.filter(pk=_uuid_or_none(other_id), is_active=True).first()
        if other is None:
            raise ValidationError({"user2_id": "That account could not be found."})
        data["user1_id"] = first_id
        data["user1_name"] = user.full_name or user.email
        data["user2_id"] = str(other.pk)
        data["user2_name"] = other.full_name or other.email
    if model_name == "Message":
        conversation = ENTITIES["Conversation"].objects.filter(
            pk=_uuid_or_none(data.get("conversation_id")),
        ).first()
        if conversation is None or str(user.pk) not in {
            str(conversation.user1_id), str(conversation.user2_id),
        }:
            raise PermissionDenied("You can only message someone in your conversation.")
        recipient_id = (
            conversation.user2_id if str(user.pk) == str(conversation.user1_id)
            else conversation.user1_id
        )
        data["sender_id"] = str(user.pk)
        data["sender_name"] = user.full_name or user.email
        data["sender_role"] = user.user_type
        data["recipient_id"] = str(recipient_id)
        data["read"] = False
    if model_name == "PartnerProfile":
        if not policies.is_admin(user):
            if user.user_type not in policies.PARTNER_TYPES or data.get("partner_type") != user.user_type:
                raise PermissionDenied("Partner profiles must match the partner role assigned to this account.")
            if ENTITIES["PartnerProfile"].objects.filter(created_by=user).exists():
                raise ValidationError({"partner_type": "A partner profile already exists for this account."})
            data["status"] = "pending_review"
    if model_name == "ConsentRecord":
        if data.get("consent_type") not in {
            "credit_bureau", "insurance", "field_monitoring", "logistics",
            "cooperative", "mobile_money", "sms_notifications",
        }:
            raise ValidationError({"consent_type": "Select a valid data-sharing consent purpose."})
        data["consenting_user_id"] = str(user.pk)
    if model_name == "FarmVisit" and not policies.is_admin(user):
        if user.user_type != "field_officer" or not FieldOfficerProfile.objects.filter(
            created_by_id=user.pk, status="active"
        ).exists():
            raise PermissionDenied("Only an active field officer can record a farm visit.")
        assignment = ENTITIES["FieldVerification"].objects.filter(
            officer_user_id=str(user.pk), farmer_user_id=str(data.get("farmer_user_id")),
        ).exists()
        if not assignment:
            raise PermissionDenied("Farm visits may only be recorded for an assigned farmer.")
        try:
            latitude, longitude = Decimal(str(data.get("latitude"))), Decimal(str(data.get("longitude")))
        except (InvalidOperation, TypeError):
            raise ValidationError({"latitude": "Valid GPS coordinates are required for a field visit."})
        if not Decimal("-90") <= latitude <= Decimal("90") or not Decimal("-180") <= longitude <= Decimal("180"):
            raise ValidationError({"latitude": "GPS coordinates are outside valid latitude/longitude ranges."})
        if not isinstance(data.get("photos"), list) or not data["photos"]:
            raise ValidationError({"photos": "At least one visit photo is required."})
        data["officer_user_id"] = str(user.pk)
    if model_name == "Complaint":
        if not data.get("message", "").strip():
            raise ValidationError({"message": "Describe the complaint so the independent complaints team can review it."})
        data["complainant_user_id"] = str(user.pk)
        data["status"] = "open"
        data["assigned_to"] = ""
        data["resolution"] = ""
        data["resolved_at"] = None
    if model_name == "LoanCase":
        financing = ENTITIES["FinancingRequest"].objects.filter(
            pk=_uuid_or_none(data.get("financing_request_id")),
        ).first()
        if financing is None:
            raise ValidationError({"financing_request_id": "Select the related financing application."})
        if not policies.is_admin(user) and str(financing.created_by_id) != str(user.pk):
            raise PermissionDenied("A farmer may only open a case for their own financing.")
        data["farmer_user_id"] = str(financing.created_by_id)
        data["buyer_user_id"] = OfftakeContract.objects.filter(
            pk=_uuid_or_none(financing.offtake_contract_id),
        ).values_list("buyer_user_id", flat=True).first() or ""
        data["status"] = "open"
    if model_name == "FinancingRequest":
        order = Order.objects.filter(pk=_uuid_or_none(data.get("order_id"))).first()
        if order is None or order.created_by_id is None:
            raise ValidationError({"order_id": "Financing must be linked to an existing farmer-owned order."})
        if not policies.is_admin(user) and order.created_by_id != user.pk:
            raise PermissionDenied("You may only request financing for your own order.")
        farmer_user_id = order.created_by_id
        contract = _require_active_offtake_contract(data, farmer_user_id)
        if str(contract.farmer_user_id) != str(order.created_by_id):
            raise ValidationError({"offtake_contract_id": "The selected buyer contract and order must belong to the same farmer."})
        settings = finance.active_loan_settings()
        credit_limit = _contract_financing_limit(contract, settings)
        requested_amount = finance.money(data.get("requested_amount"))
        if requested_amount <= 0:
            raise ValidationError({"requested_amount": "Requested financing must be greater than zero."})
        if order.total is None or requested_amount > finance.money(order.total):
            raise ValidationError({"requested_amount": "Requested financing cannot exceed the order total."})
        if requested_amount > credit_limit:
            raise ValidationError({"requested_amount": f"Requested financing exceeds the contract-backed limit of KES {credit_limit}."})
        data["credit_limit"] = credit_limit
        data["advance_percentage"] = settings.advance_percentage
        data["contract_price"] = contract.price_per_unit
    elif model_name == "OfftakeContract" and policies.is_admin(user) and data.get("status") == "active":
        raise PermissionDenied("An offtake contract must be activated by its named buyer.")
    elif model_name == "Agreement":
        financing = ENTITIES["FinancingRequest"].objects.filter(
            pk=_uuid_or_none(data.get("financing_request_id")),
            status="approved",
        ).first()
        if not policies.is_admin(user):
            if (
                not policies.is_active_loan_officer(user)
                or financing is None
                or financing.created_by_id is None
                or str(data.get("farmer_user_id") or "") != str(financing.created_by_id)
                or str(data.get("offtake_contract_id") or "") != financing.offtake_contract_id
            ):
                raise PermissionDenied("Only an active loan officer can prepare an agreement for an approved application.")
            if Agreement.objects.filter(financing_request_id=str(financing.pk)).exists():
                raise ValidationError({"financing_request_id": "An agreement already exists for this financing request."})
        if financing:
            _require_active_offtake_contract(
                {"offtake_contract_id": financing.offtake_contract_id},
                financing.created_by_id,
            )
            terms = finance.repayment_terms(
                financing.approved_amount,
                financing.monthly_interest_rate,
                financing.tenor_months,
            )
            data.update({
                "farmer_user_id": str(financing.created_by_id),
                "offtake_contract_id": financing.offtake_contract_id,
                "financing_request_id": str(financing.pk),
                "financing_amount": financing.approved_amount,
                "total_cost": financing.total_cost or terms["total_cost"],
                "repayment_schedule": financing.repayment_schedule or terms["schedule"],
                "monthly_interest_rate": financing.monthly_interest_rate,
                "buyer_withholding_percentage": financing.buyer_withholding_percentage,
            })
            schedule_lines = "\n".join(
                f"Installment {row['installment']}: due {row['due_date']}, amount KES {row['amount']} "
                f"(principal {row['principal']}; interest {row['interest']})"
                for row in data["repayment_schedule"]
            )
            data["content"] = (
                f"{data.get('content', '').strip()}\n\n"
                f"LOAN COST DISCLOSURE\n"
                f"Principal: KES {data['financing_amount']}\n"
                f"Total projected repayment: KES {data['total_cost']}\n"
                f"Simple monthly interest rate: {data['monthly_interest_rate']}% on outstanding principal (non-compounding)\n"
                f"Buyer sale-proceeds withholding: {data['buyer_withholding_percentage']}% of gross sale proceeds, "
                f"applied to the outstanding loan balance subject to configured caps.\n"
                f"Repayment schedule:\n{schedule_lines}\n"
                "This schedule is a projection based on the approved principal. Actual interest is posted monthly "
                "on released principal and can vary with tranche dates and repayments."
            ).strip()
        else:
            _require_active_offtake_contract(data, data.get("farmer_user_id"))
    elif model_name == "Voucher":
        agreement = Agreement.objects.filter(
            pk=_uuid_or_none(data.get("agreement_id")),
            status="signed",
        ).first()
        if agreement is None or agreement.farmer_user_id != str(data.get("farmer_user_id") or ""):
            raise PermissionDenied("A voucher requires the farmer's signed financing agreement.")
        _require_active_offtake_contract(
            {"offtake_contract_id": agreement.offtake_contract_id},
            agreement.farmer_user_id,
        )
        contract = OfftakeContract.objects.filter(pk=_uuid_or_none(agreement.offtake_contract_id)).first()
        if not finance.contract_release_ready(contract):
            raise ValidationError({"offtake_contract_id": "Financing cannot be released until the farmer, buyer, and loan officer sign and the buyer accepts the guarantee."})
    elif model_name == "Settlement" and data.get("offtake_contract_id"):
        contract = OfftakeContract.objects.filter(
            pk=_uuid_or_none(data.get("offtake_contract_id")),
            status="active",
        ).first()
        if (
            contract is None
            or str(contract.buyer_user_id) != str(user.pk)
            or str(data.get("buyer_user_id") or user.pk) != str(user.pk)
            or not finance.contract_release_ready(contract)
        ):
            raise PermissionDenied("Only the contracted buyer can record a delivery against a signed, guaranteed offtake contract.")
        data["buyer_user_id"] = str(user.pk)
        data["farmer_user_id"] = contract.farmer_user_id
        data["offtake_contract_id"] = str(contract.pk)
        quantity = Decimal(str(data.get("delivery_quantity") or 0))
        if not data.get("crop_grade"):
            raise ValidationError({"crop_grade": "Record the crop grade before confirming delivery."})
        if not data.get("delivery_date"):
            raise ValidationError({"delivery_date": "Record the date the crop was received."})
        harvest = ENTITIES["Harvest"].objects.filter(
            pk=_uuid_or_none(data.get("harvest_id")),
            buyer_user_id=str(user.pk),
            offtake_contract_id=str(contract.pk),
            settlement_status__in=["harvest_ready", "harvest_recorded"],
        ).first()
        if harvest is None:
            raise ValidationError({"harvest_id": "Select an undelivered harvest that belongs to this buyer and contract."})
        delivery_unit = harvest.unit or contract.unit
        if not delivery_unit:
            raise ValidationError({"unit": "Set the crop weight unit on the harvest or contract before receiving delivery."})
        if ENTITIES["Settlement"].objects.filter(harvest_id=str(harvest.pk)).exists():
            raise ValidationError({"harvest_id": "A delivery settlement already exists for this harvest."})
        previously_delivered = sum(
            (Decimal(str(item.delivery_quantity or 0)) for item in ENTITIES["Settlement"].objects.filter(
                offtake_contract_id=str(contract.pk),
            )),
            Decimal("0"),
        )
        if quantity > Decimal(str(harvest.expected_quantity or contract.quantity or 0)) or (
            contract.quantity is not None and previously_delivered + quantity > Decimal(str(contract.quantity))
        ):
            raise ValidationError({"delivery_quantity": "Delivered quantity cannot exceed the recorded harvest or remaining contract quantity."})
        gross = finance.money(
            quantity * Decimal(str(contract.price_per_unit or 0))
        )
        if quantity <= 0 or gross <= 0:
            raise ValidationError({"delivery_quantity": "Enter a positive delivered quantity and gross sale amount."})
        if not str(data.get("delivery_evidence_url") or "").startswith("private:"):
            raise ValidationError({"delivery_evidence_url": "Upload a signed weigh ticket or warehouse receipt."})
        settings = finance.active_loan_settings()
        financing = ENTITIES["FinancingRequest"].objects.filter(
            offtake_contract_id=str(contract.pk),
            created_by_id=_uuid_or_none(contract.farmer_user_id),
            status="approved",
        ).first()
        if financing:
            finance.accrue_monthly_interest(financing, timezone.localdate())
        principal, interest = finance.loan_balances(financing.pk) if financing else (Decimal("0.00"), Decimal("0.00"))
        reserved_recovery = sum(
            (
                max(
                    finance.money(item.buyer_withholding_amount or 0)
                    - finance.money(item.buyer_verified_received_amount or 0),
                    Decimal("0.00"),
                )
                for item in ENTITIES["Settlement"].objects.filter(offtake_contract_id=str(contract.pk))
            ),
            Decimal("0.00"),
        )
        available_loan_balance = max(principal + interest - reserved_recovery, Decimal("0.00"))
        prior_guaranteed = sum(
            (finance.money(item.buyer_withholding_amount) for item in ENTITIES["Settlement"].objects.filter(
                offtake_contract_id=str(contract.pk),
            )),
            Decimal("0.00"),
        )
        guarantee_remaining = max(
            finance.money((contract.buyer_guarantee_amount or 0) - prior_guaranteed),
            Decimal("0.00"),
        )
        withholding = finance.money(
            gross * Decimal(str(financing.buyer_withholding_percentage if financing else
                                settings.buyer_withholding_percentage or 0)) / Decimal("100")
        )
        withholding = min(withholding, available_loan_balance, guarantee_remaining)
        if settings.maximum_withholding_amount is not None:
            withholding = min(withholding, finance.money(settings.maximum_withholding_amount))
        data.update({
            "gross_sale_amount": gross,
            "amount": gross,
            "unit": delivery_unit,
            "price_per_unit": finance.money(contract.price_per_unit),
            "buyer_withholding_amount": withholding,
            "buyer_remitted_amount": Decimal("0.00"),
            "buyer_verified_received_amount": Decimal("0.00"),
            "buyer_remittance_status": "due" if withholding > 0 else "verified",
            "farmer_payment_due_amount": finance.money(gross - withholding),
            "farmer_payment_reported_amount": Decimal("0.00"),
            "farmer_payment_verified_amount": Decimal("0.00"),
            "farmer_payment_status": "verified" if gross == withholding else "due",
            "buyer_exposure_amount": withholding,
            "loan_repayment_amount": Decimal("0.00"),
            "farmer_balance": finance.money(gross - withholding),
            "claim_date": data.get("claim_date") or timezone.now(),
            "status": "pending_review",
        })
    elif model_name == "Settlement" and data.get("voucher_id"):
        vendor_user_id = policies.vendor_account_id(user, "settlements")
        voucher = ENTITIES["Voucher"].objects.filter(
            pk=_uuid_or_none(data.get("voucher_id")),
            status="redeemed",
        ).first()
        redemption = ENTITIES["Redemption"].objects.filter(
            voucher_id=str(voucher.pk) if voucher else "",
            vendor_user_id=vendor_user_id,
        ).first()
        if not vendor_user_id or voucher is None or voucher.vendor_user_id != vendor_user_id or redemption is None:
            raise PermissionDenied("Only the assigned vendor or manager can create a settlement for its redeemed voucher.")
        if ENTITIES["Settlement"].objects.filter(voucher_id=str(voucher.pk)).exists():
            raise ValidationError({"voucher_id": "A settlement claim already exists for this voucher."})
        if finance.money(data.get("amount") or 0) != finance.money(voucher.total_value or 0):
            raise ValidationError({"amount": "The settlement amount must match the redeemed voucher value."})
        data["vendor_user_id"] = vendor_user_id
        data["vendor_name"] = voucher.vendor_name
        data["status"] = "pending_review"
    elif model_name == "Settlement" and policies.vendor_employee_for_user(user):
        if not policies.vendor_account_id(user, "settlements"):
            raise PermissionDenied("Your vendor employee role does not allow settlement management.")
        raise ValidationError({"voucher_id": "Vendor employee settlements must be linked to a redeemed voucher."})
    elif model_name == "SettlementReconciliation":
        settlement = ENTITIES["Settlement"].objects.select_for_update().filter(
            pk=_uuid_or_none(data.get("settlement_id")),
        ).first()
        if settlement is None or settlement.status != "approved":
            raise ValidationError({"settlement_id": "Select a delivery settlement approved by an administrator."})
        if str(settlement.buyer_user_id) != str(user.pk):
            raise PermissionDenied("Only the contracted buyer can submit payment evidence.")
        payment_type = data.get("payment_type")
        if payment_type not in {"buyer_withholding", "farmer_payment"}:
            raise ValidationError({"payment_type": "Choose buyer withholding or farmer payment."})
        due = finance.money(
            settlement.buyer_withholding_amount if payment_type == "buyer_withholding"
            else settlement.farmer_payment_due_amount
        )
        already_reported = _reconciliation_total(
            settlement, payment_type, ["pending_verification", "verified"],
        )
        try:
            amount = finance.money(data.get("amount"))
        except (TypeError, ValueError):
            raise ValidationError({"amount": "Enter a valid payment amount."})
        if amount <= 0 or amount > due - already_reported:
            raise ValidationError({"amount": "Payment claim must be positive and cannot exceed the remaining amount due."})
        if not str(data.get("external_reference") or "").strip():
            raise ValidationError({"external_reference": "Enter the bank or mobile-money transaction reference."})
        if ENTITIES["SettlementReconciliation"].objects.filter(
            buyer_user_id=str(user.pk),
            external_reference__iexact=str(data.get("external_reference") or "").strip(),
        ).exists():
            raise ValidationError({"external_reference": "This transaction reference was already used for a reconciliation claim."})
        if not str(data.get("evidence_url") or "").startswith("private:"):
            raise ValidationError({"evidence_url": "Upload transaction evidence for independent verification."})
        financing = ENTITIES["FinancingRequest"].objects.filter(
            offtake_contract_id=settlement.offtake_contract_id,
            created_by_id=_uuid_or_none(settlement.farmer_user_id),
            status="approved",
        ).first()
        data.update({
            "settlement_id": str(settlement.pk),
            "financing_request_id": str(financing.pk) if financing else "",
            "farmer_user_id": settlement.farmer_user_id,
            "buyer_user_id": settlement.buyer_user_id,
            "status": "pending_verification",
            "verified_by_id": "",
            "verified_at": None,
        })
    elif model_name == "Harvest" and data.get("settlement_status") in {"settled", "closed"}:
        raise ValidationError({"settlement_status": "Harvest completion is derived from verified delivery reconciliation."})
    elif model_name == "LoanLedgerEntry":
        raise PermissionDenied("Loan ledger entries are generated by approved financial operations and cannot be created directly.")
    elif model_name == "LoanDisbursement":
        _validate_disbursement(data)
    elif model_name == "Harvest":
        if not data.get("farming_start_date") or not data.get("expected_harvest_date") or not data.get("crop_duration_days"):
            raise ValidationError({
                "farming_start_date": "Enter the farming start date, crop duration, and expected harvest date."
            })
    if policies.is_admin(user):
        return
    if model_name == "Settlement" and policies.vendor_employee_for_user(user):
        if not policies.vendor_account_id(user, "settlements"):
            raise PermissionDenied("Your vendor employee role does not allow settlement management.")
    if model_name == "Product":
        vendor_user_id = policies.vendor_account_id(user, "products")
        if not vendor_user_id or data.get("vendor_user_id") not in {"", vendor_user_id}:
            raise PermissionDenied("Your vendor employee role does not allow product management.")
        data["vendor_user_id"] = vendor_user_id
        vendor_profile = ENTITIES["VendorProfile"].objects.filter(
            created_by_id=_uuid_or_none(vendor_user_id),
        ).first()
        if vendor_profile:
            data["vendor_name"] = vendor_profile.business_name
    elif model_name == "Redemption":
        vendor_user_id = policies.vendor_account_id(user, "redemptions")
        voucher = ENTITIES["Voucher"].objects.filter(pk=_uuid_or_none(data.get("voucher_id"))).first()
        if not vendor_user_id or voucher is None or voucher.vendor_user_id != vendor_user_id:
            raise PermissionDenied("Your vendor employee role does not allow voucher redemption.")
        data["vendor_user_id"] = vendor_user_id
    elif model_name == "Voucher":
        # A farmer mints their own voucher once an agreement is signed - make sure it matches the order.
        order = Order.objects.filter(pk=_uuid_or_none(data.get("order_id")), created_by=user).first()
        agreement = Agreement.objects.filter(pk=_uuid_or_none(data.get("agreement_id")), farmer_user_id=str(user.pk),
                                             status="signed").first()
        if order is None or agreement is None or str(agreement.order_id) != str(order.pk):
            raise PermissionDenied("A voucher requires one of your orders and its signed agreement.")
        if order.vendor_user_id != str(data.get("vendor_user_id")) or (data.get("total_value") or 0) > (order.total or 0):
            raise PermissionDenied("Voucher doesn't match the order.")


def _run_fraud_checks(user, model_name, instance):
    from .models import FraudAlert

    alerts = []
    if model_name == "FarmerProfile":
        identity_match = ENTITIES["FarmerProfile"].objects.filter(
            national_id=instance.national_id,
        ).exclude(pk=instance.pk).exclude(national_id="").first()
        if identity_match:
            alerts.append(("duplicate_identity", 90, {"profile_id": str(identity_match.pk)}))
        same_farm = ENTITIES["FarmerProfile"].objects.filter(
            farm_name__iexact=instance.farm_name,
            farm_location__iexact=instance.farm_location,
        ).exclude(pk=instance.pk).exclude(farm_name="").exclude(farm_location="").first()
        if same_farm:
            alerts.append(("duplicate_farm", 65, {"profile_id": str(same_farm.pk)}))
    elif model_name == "FinancingRequest":
        duplicates = ENTITIES["FinancingRequest"].objects.filter(
            created_by_id=instance.created_by_id,
            status__in=["requested", "under_review", "stage1_approved", "approved"],
        ).exclude(pk=instance.pk)
        if duplicates.exists():
            alerts.append(("suspicious_application", 75, {
                "application_ids": [str(item) for item in duplicates.values_list("id", flat=True)]
            }))
        contract = OfftakeContract.objects.filter(pk=_uuid_or_none(instance.offtake_contract_id)).first()
        if contract and contract.buyer_user_id and ENTITIES["OfftakeContract"].objects.filter(
            buyer_user_id=contract.buyer_user_id, farmer_user_id=contract.farmer_user_id, status="active",
        ).exclude(pk=contract.pk).exists():
            alerts.append(("buyer_collusion", 60, {"offtake_contract_id": str(contract.pk)}))
    for alert_type, risk_score, details in alerts:
        ENTITIES["FraudAlert"].objects.create(
            created_by=user,
            target_user_id=str(instance.created_by_id or ""),
            financing_request_id=str(instance.pk) if model_name == "FinancingRequest" else "",
            alert_type=alert_type,
            risk_score=risk_score,
            details=details,
        )


def _uuid_or_none(value):
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _require_active_offtake_contract(data, farmer_user_id=None):
    """Require financing commitments and releases to be backed by an active, buyer-owned contract."""
    contract = OfftakeContract.objects.filter(
        pk=_uuid_or_none(data.get("offtake_contract_id")),
        status="active",
    ).first()
    buyer_id = _uuid_or_none(contract.buyer_user_id) if contract else None
    buyer = get_user_model().objects.filter(pk=buyer_id, user_type="buyer", is_active=True).first()
    buyer_profile_is_active = buyer and BuyerProfile.objects.filter(
        created_by_id=buyer.pk,
        status="active",
    ).exists()
    if (
        contract is None
        or not contract.buyer_user_id
        or (farmer_user_id and str(contract.farmer_user_id) != str(farmer_user_id))
        or buyer is None
        or not buyer_profile_is_active
    ):
        raise ValidationError({
            "offtake_contract_id": "Financing requires an active offtake contract with an active buyer for this farmer."
        })
    return contract


def _contract_financing_limit(contract, settings):
    contract_value = finance.offtake_contract_value(contract)
    if contract_value <= 0:
        raise ValidationError({"offtake_contract_id": "The buyer contract needs a positive quantity and price before financing can be requested."})
    credit_limit = finance.money(
        contract_value * Decimal(str(settings.advance_percentage or 0)) / Decimal("100")
    )
    if settings.maximum_financing_amount is not None:
        credit_limit = min(credit_limit, finance.money(settings.maximum_financing_amount))
    return credit_limit


def _validate_disbursement(data):
    financing = ENTITIES["FinancingRequest"].objects.filter(
        pk=_uuid_or_none(data.get("financing_request_id")),
        status="approved",
    ).select_for_update().first()
    facility = FundingFacility.objects.filter(
        pk=_uuid_or_none(data.get("facility_id")),
        status="active",
    ).select_for_update().first()
    try:
        amount = finance.money(data.get("amount"))
    except (TypeError, ValueError):
        raise ValidationError({"amount": "Enter a valid tranche amount."})
    if amount <= 0:
        raise ValidationError({"amount": "Tranche amount must be greater than zero."})
    reference = str(data.get("reference") or "").strip()
    if not reference:
        raise ValidationError({"reference": "Enter a unique payment reference for this payout."})
    if financing is None:
        raise ValidationError({"financing_request_id": "Only approved financing can be released."})
    if facility is None:
        raise ValidationError({"facility_id": "Select an active funding facility."})
    if LoanDisbursement.objects.filter(
        facility_id=str(facility.pk),
        reference__iexact=reference,
        status__in=["pending_confirmation", "released"],
    ).exists():
        raise ValidationError({"reference": "This payment reference is already in use for this facility."})
    contract = OfftakeContract.objects.filter(pk=_uuid_or_none(financing.offtake_contract_id)).first()
    if not finance.contract_release_ready(contract):
        raise ValidationError({"offtake_contract_id": "Release is blocked until the farmer, buyer, and loan officer sign and the buyer accepts the guarantee."})
    agreement = Agreement.objects.filter(
        financing_request_id=str(financing.pk),
        status__in=["signed", "active"],
    ).first()
    if agreement is None or not agreement.disclosure_acknowledged_at:
        raise ValidationError({"financing_request_id": "Release is blocked until the farmer signs the disclosed financing agreement."})
    reserved_for_loan = sum(
        (finance.money(item.amount) for item in LoanDisbursement.objects.filter(
            financing_request_id=str(financing.pk), status__in=["pending_confirmation", "released"]
        )),
        Decimal("0.00"),
    )
    tranche_num = LoanDisbursement.objects.filter(financing_request_id=str(financing.pk)).count() + 1
    if reserved_for_loan + amount > finance.money(financing.approved_amount):
        raise ValidationError({"amount": "Tranche exceeds the undisbursed approved amount."})
    reserved_for_facility = sum(
        (finance.money(item.amount) for item in LoanDisbursement.objects.filter(
            facility_id=str(facility.pk), status="pending_confirmation"
        )),
        Decimal("0.00"),
    )
    facility_remaining = finance.money(
        (facility.facility_limit or 0) - (facility.committed_amount or 0) - reserved_for_facility
    )
    if amount > facility_remaining:
        raise ValidationError({"amount": "Tranche exceeds the facility's remaining available limit."})
    data["amount"] = amount
    data["reference"] = reference
    data["tranche_number"] = tranche_num
    data["released_at"] = None
    data["status"] = "pending_confirmation"
    return financing, facility


def _validate_loan_settings(data):
    rate = Decimal(str(data.get("monthly_interest_rate", 0)))
    withholding = Decimal(str(data.get("buyer_withholding_percentage", 0)))
    advance = Decimal(str(data.get("advance_percentage", 0)))
    reserve = Decimal(str(data.get("reserve_percentage", 0)))
    if rate < 0:
        raise ValidationError({"monthly_interest_rate": "Interest rate cannot be negative."})
    if not Decimal("0") <= withholding <= Decimal("100"):
        raise ValidationError({"buyer_withholding_percentage": "Withholding percentage must be between 0 and 100."})
    if not Decimal("0") < advance <= Decimal("100"):
        raise ValidationError({"advance_percentage": "Contract advance percentage must be greater than 0 and no more than 100."})
    if not Decimal("0") <= reserve <= Decimal("100"):
        raise ValidationError({"reserve_percentage": "Reserve percentage must be between 0 and 100."})
    for field_name in ("maximum_financing_amount", "maximum_withholding_amount"):
        value = data.get(field_name)
        if value is not None and finance.money(value) <= 0:
            raise ValidationError({field_name: "A configured cap must be greater than zero."})
    tenor = int(data.get("default_tenor_months") or 0)
    if tenor <= 0:
        raise ValidationError({"default_tenor_months": "Default tenor must be at least one month."})


def update_checks(model_name, user, instance, data):
    if model_name == "VendorEmployee":
        if policies.is_admin(user):
            raise PermissionDenied("Vendor employee approval is controlled by the vendor, not the system administrator.")
        if not policies.is_vendor_team_manager(user, instance.vendor_user_id):
            raise PermissionDenied("Only this vendor or an approved vendor manager can manage its team.")
        if set(data) - {"status", "role"}:
            raise ValidationError({"detail": "Employee identity and vendor ownership are immutable."})
        if "role" in data and data["role"] not in {"assistant", "manager"}:
            raise ValidationError({"role": "Choose a supported employee role."})
        if data.get("status") == "active":
            employee = get_user_model().objects.filter(
                pk=_uuid_or_none(instance.employee_user_id),
                email__iexact=instance.employee_email,
                is_active=True,
            ).first()
            if employee is None or instance.status not in {"invited", "suspended"}:
                raise ValidationError({"status": "The invited employee must register with this email before vendor approval."})
        if data.get("status") == "invited" and instance.status != "invited":
            raise ValidationError({"status": "An approved or suspended employee cannot be returned to the invitation state."})
        if data.get("status") == "suspended" and instance.status not in {"active", "suspended"}:
            raise ValidationError({"status": "Only an approved employee can be suspended."})
    if model_name == "SettlementReconciliation":
        new_status = data.get("status")
        if instance.status != "pending_verification" or new_status not in {"verified", "rejected"}:
            raise ValidationError({"status": "Only a pending remittance claim may be verified or rejected."})
        if new_status == "verified" and str(instance.created_by_id) == str(user.pk):
            raise PermissionDenied("A different administrator must verify the remittance evidence.")
        settlement = ENTITIES["Settlement"].objects.select_for_update().filter(
            pk=_uuid_or_none(instance.settlement_id),
        ).first()
        if new_status == "verified" and (settlement is None or settlement.status != "approved"):
            raise ValidationError({"settlement_id": "Resolve any delivery dispute before verifying payment."})
        if new_status == "rejected" and not str(data.get("reviewer_notes") or "").strip():
            raise ValidationError({"reviewer_notes": "Explain why the remittance evidence was rejected."})
        data["verified_by_id"] = str(user.pk) if new_status == "verified" else ""
        data["verified_at"] = timezone.now() if new_status == "verified" else None
    if model_name == "Harvest" and data.get("settlement_status") in {"settled", "closed"}:
        raise ValidationError({"settlement_status": "Harvest completion is derived from verified delivery reconciliation."})
    if model_name == "Settlement" and instance.offtake_contract_id and "status" in data:
        new_status = data["status"]
        if instance.status == "paid" and new_status != "paid":
            raise ValidationError({"status": "A reconciled sale settlement cannot be reopened."})
        if new_status == "approved" and instance.status not in {"pending_review", "disputed"}:
            raise ValidationError({"status": "Only a pending or disputed delivery review may be approved."})
        if new_status == "disputed" and instance.status not in {"pending_review", "approved"}:
            raise ValidationError({"status": "Only an unresolved delivery may be disputed."})
        if new_status not in {"approved", "disputed", "paid", "pending_review"}:
            raise ValidationError({"status": "Invalid delivery review status."})
    if model_name == "FarmerProfile" and "verification_status" in data:
        expected_report_status = {
            "verified": "approved",
            "rejected": "rejected",
        }.get(data["verification_status"])
        if expected_report_status and not ENTITIES["FieldVerification"].objects.filter(
            farmer_user_id=str(instance.created_by_id),
            status=expected_report_status,
        ).exists():
            raise ValidationError({
                "verification_status": "Farmer verification status can only follow the administrator's decision on a submitted field report."
            })
    if model_name == "FieldVerification":
        new_status = data.get("status", instance.status)
        if policies.is_admin(user):
            if new_status in {"approved", "rejected"}:
                if instance.status != "pending_admin_review":
                    raise ValidationError({"status": "Only a submitted field report can be approved or rejected."})
                if new_status == "rejected" and not str(
                    data.get("rejection_reason", instance.rejection_reason) or ""
                ).strip():
                    raise ValidationError({"rejection_reason": "Explain why the findings were rejected."})
            elif new_status != instance.status:
                raise ValidationError({"status": "Administrators may only approve or reject submitted field reports."})
        else:
            if instance.status in {"pending_admin_review", "approved", "rejected"}:
                raise PermissionDenied("Submitted field reports are locked until an administrator reviews them.")
            if new_status not in {"assigned", "in_progress", "pending_admin_review"}:
                raise PermissionDenied("Field officers may submit findings for admin review, but cannot approve them.")
            if new_status == "pending_admin_review":
                report = {
                    "land_verification_notes": data.get("land_verification_notes", instance.land_verification_notes),
                    "document_verification_notes": data.get("document_verification_notes", instance.document_verification_notes),
                    "land_size_verified": data.get("land_size_verified", instance.land_size_verified),
                    "crops_verified": data.get("crops_verified", instance.crops_verified),
                    "field_visit_photos": data.get("field_visit_photos", instance.field_visit_photos),
                }
                if (
                    not str(report["land_verification_notes"] or "").strip()
                    or not str(report["document_verification_notes"] or "").strip()
                    or finance.money(report["land_size_verified"] or 0) <= 0
                    or not isinstance(report["crops_verified"], list)
                    or not any(str(crop).strip() for crop in report["crops_verified"])
                    or not isinstance(report["field_visit_photos"], list)
                    or not report["field_visit_photos"]
                    or not any(
                        isinstance(photo, str) and photo.startswith("private:")
                        for photo in report["field_visit_photos"]
                    )
                ):
                    raise ValidationError({
                        "status": "Upload at least one private field photo and complete the field notes, document notes, verified land size, and verified crops before submitting findings."
                    })
    if model_name in {"LoanDisbursement", "LoanLedgerEntry", "AuditLog", "ConsentRecord"}:
        if model_name != "LoanDisbursement":
            raise PermissionDenied(f"{model_name} records are append-only.")
    if model_name == "LoanDisbursement":
        changed_fields = {
            name for name, value in data.items()
            if not _same(value, getattr(instance, name, None))
        }
        if instance.status != "pending_confirmation" and changed_fields:
            raise PermissionDenied("Confirmed payout records are immutable.")
        if "status" not in data or data["status"] == instance.status:
            if changed_fields:
                raise ValidationError({"status": "Payout records may only be changed by a valid status transition."})
        elif instance.status != "pending_confirmation" or data["status"] not in {"released", "failed"}:
            raise ValidationError({"status": "Only a pending payout can be confirmed as released or marked failed."})
        elif data["status"] == "failed":
            if changed_fields - {"status", "notes"}:
                raise ValidationError({"status": "A failed payout may only store its failure reason."})
            if not str(data.get("notes", instance.notes) or "").strip():
                raise ValidationError({"notes": "Record why the payout failed."})
            data["released_at"] = None
        elif data["status"] == "released":
            if changed_fields - {"status"}:
                raise ValidationError({"status": "Only the payout status may change when confirming payment."})
            financing = ENTITIES["FinancingRequest"].objects.select_for_update().filter(
                pk=_uuid_or_none(instance.financing_request_id),
                status="approved",
            ).first()
            facility = FundingFacility.objects.select_for_update().filter(
                pk=_uuid_or_none(instance.facility_id),
                status="active",
            ).first()
            if financing is None or facility is None:
                raise ValidationError({"status": "The approved loan and active funding facility must still be available."})
            contract = OfftakeContract.objects.filter(pk=_uuid_or_none(financing.offtake_contract_id)).first()
            if not finance.contract_release_ready(contract):
                raise ValidationError({"status": "Payment confirmation is blocked until the buyer-backed contract remains valid."})
            agreement = Agreement.objects.filter(
                financing_request_id=str(financing.pk),
                status__in=["signed", "active"],
            ).exclude(disclosure_acknowledged_at=None).exists()
            if not agreement:
                raise ValidationError({"status": "Payment confirmation requires the signed loan disclosure."})
            reference = str(instance.reference or "").strip()
            if not reference:
                raise ValidationError({"reference": "A payment reference is required before confirming a payout."})
            duplicate_reference = LoanDisbursement.objects.filter(
                facility_id=str(facility.pk),
                reference__iexact=reference,
                status__in=["pending_confirmation", "released"],
            ).exclude(pk=instance.pk).exists()
            if duplicate_reference:
                raise ValidationError({"reference": "This payment reference is already in use for this facility."})
            pending_loan_total = sum(
                (finance.money(item.amount) for item in LoanDisbursement.objects.filter(
                    financing_request_id=str(financing.pk), status="pending_confirmation",
                ).exclude(pk=instance.pk)),
                Decimal("0.00"),
            )
            released_loan_total = sum(
                (finance.money(item.amount) for item in LoanDisbursement.objects.filter(
                    financing_request_id=str(financing.pk), status="released",
                )),
                Decimal("0.00"),
            )
            if released_loan_total + pending_loan_total + finance.money(instance.amount) > finance.money(financing.approved_amount):
                raise ValidationError({"status": "Confirmed payouts cannot exceed the approved loan amount."})
            pending_facility_total = sum(
                (finance.money(item.amount) for item in LoanDisbursement.objects.filter(
                    facility_id=str(facility.pk), status="pending_confirmation",
                ).exclude(pk=instance.pk)),
                Decimal("0.00"),
            )
            available = finance.money(
                (facility.facility_limit or 0) - (facility.committed_amount or 0) - pending_facility_total
            )
            if finance.money(instance.amount) > available:
                raise ValidationError({"status": "Confirmed payouts cannot exceed the facility's available limit."})
            data["released_at"] = timezone.now()
    if model_name == "Agreement" and data.get("status") == "signed":
        if (
            data.get("disclosure_acknowledged_at") is None
            or instance.total_cost is None
            or not instance.repayment_schedule
            or instance.monthly_interest_rate is None
            or instance.buyer_withholding_percentage is None
        ):
            raise ValidationError({"disclosure_acknowledged_at": "Review and acknowledge the complete loan cost, repayment schedule, monthly interest, and buyer withholding before signing."})
        data["signed_at"] = timezone.now()
        data["disclosure_acknowledged_at"] = timezone.now()
    if model_name == "Harvest":
        lifecycle_fields = {"farming_start_date", "crop_duration_days", "expected_harvest_date"}
        if lifecycle_fields & data.keys():
            start_date = data.get("farming_start_date", instance.farming_start_date)
            duration = data.get("crop_duration_days", instance.crop_duration_days)
            expected = data.get("expected_harvest_date", instance.expected_harvest_date)
            if not start_date or not duration or not expected:
                raise ValidationError({"farming_start_date": "The crop lifecycle dates and duration are required."})
            if expected < start_date:
                raise ValidationError({"expected_harvest_date": "Expected harvest cannot be before farming starts."})
    if model_name == "Settlement" and "status" in data:
        if data["status"] == "disputed" and instance.status not in {"pending_review", "approved"}:
            raise ValidationError({"status": "Only an unresolved settlement may be disputed."})
        if data["status"] == "pending_review" and instance.status != "pending_review":
            raise ValidationError({"status": "A reviewed settlement cannot be reset to pending."})
    if model_name == "LoanCase" and data.get("status") == "approved":
        if instance.status not in {"open", "under_review"}:
            raise ValidationError({"status": "Only an open case under review may be approved."})
        data["decided_by"] = user.email
        data["decided_at"] = timezone.now()
        financing = ENTITIES["FinancingRequest"].objects.filter(
            pk=_uuid_or_none(instance.financing_request_id),
        ).first()
        if financing is None:
            raise ValidationError({"financing_request_id": "The financing request for this case no longer exists."})
        finance.accrue_monthly_interest(financing, timezone.localdate())
        case_status_field = {
            "crop_failure": "crop_failure_status",
            "buyer_default": "buyer_default_status",
            "side_selling": "side_selling_status",
            "restructuring": "restructuring_status",
        }.get(instance.case_type)
        if case_status_field:
            setattr(financing, case_status_field, {
                "crop_failure": "verified",
                "buyer_default": "reported",
                "side_selling": "confirmed",
                "restructuring": "approved",
            }[instance.case_type])
        if instance.case_type == "write_off":
            if not policies.is_admin(user) and not policies.is_partner_role(user, "compliance"):
                raise PermissionDenied("Only administrators or active compliance partners can approve a write-off.")
            principal, interest = finance.loan_balances(financing.pk)
            if principal or interest:
                finance.append_ledger_entry(
                    financing_request=financing,
                    entry_type="write_off",
                    amount=principal + interest,
                    principal_delta=-principal,
                    interest_delta=-interest,
                    notes=data.get("decision_notes") or "Approved write-off.",
                    metadata={"loan_case_id": str(instance.pk)},
                )
            financing.loss_status = "written_off"
            financing.save(update_fields=["loss_status", "updated_date"])
        elif instance.case_type == "restructuring":
            if not policies.is_admin(user) and not policies.is_partner_role(user, "collections", "compliance"):
                raise PermissionDenied("Only administrators, active collections, or compliance partners can approve a restructuring.")
            evidence = data.get("evidence", instance.evidence)
            evidence = evidence if isinstance(evidence, dict) else {}
            schedule = evidence.get("repayment_schedule")
            new_total = evidence.get("total_cost")
            if not isinstance(schedule, list) or not schedule or new_total is None:
                raise ValidationError({"evidence": "A restructuring proposal must include total_cost and a repayment_schedule."})
            try:
                new_total = finance.money(new_total)
            except (TypeError, ValueError):
                raise ValidationError({"evidence": "The proposed total_cost must be a valid amount."})
            principal, _ = finance.loan_balances(financing.pk)
            if new_total < principal or any(not isinstance(row, dict) or "amount" not in row for row in schedule):
                raise ValidationError({"evidence": "The restructured total cannot be below principal and each schedule row needs an amount."})
            try:
                scheduled_total = sum((finance.money(row["amount"]) for row in schedule), Decimal("0.00"))
            except (TypeError, ValueError):
                raise ValidationError({"evidence": "Every repayment schedule amount must be a valid monetary value."})
            if scheduled_total != new_total:
                raise ValidationError({"evidence": "The repayment schedule must add up to the proposed total_cost."})
            prior_total = finance.money(financing.total_cost or 0)
            financing.total_cost = new_total
            financing.repayment_schedule = schedule
            financing.restructuring_status = "approved"
            financing.save(update_fields=["total_cost", "repayment_schedule", "restructuring_status", "updated_date"])
            finance.append_ledger_entry(
                financing_request=financing,
                entry_type="restructure",
                amount=new_total - prior_total,
                notes=data.get("decision_notes") or "Approved restructured repayment terms.",
                metadata={"loan_case_id": str(instance.pk), "total_cost": str(new_total)},
            )
        if case_status_field and instance.case_type != "restructuring":
            financing.save(update_fields=[case_status_field, "updated_date"])
    if model_name == "LoanCase" and data.get("status") in {"rejected", "resolved", "under_review"}:
        transitions = {
            "under_review": {"open"},
            "rejected": {"open", "under_review"},
            "resolved": {"approved"},
        }
        if instance.status not in transitions[data["status"]]:
            raise ValidationError({"status": f"Cannot change a {instance.status} case to {data['status']}."})
        if data["status"] in {"rejected", "resolved"}:
            data["decided_by"] = user.email
            data["decided_at"] = timezone.now()
    if model_name == "OfftakeContract" and data.get("status") == "active":
        if str(instance.buyer_user_id) != str(user.pk):
            raise PermissionDenied("Only the named buyer can activate an offtake contract.")
        data["total_value"] = finance.offtake_contract_value(instance)
        if instance.buyer_signed_at is None:
            data["buyer_signed_at"] = timezone.now()
        elif instance.status != "active":
            raise ValidationError({"status": "A signed offtake contract cannot be reactivated."})
    if model_name == "OfftakeContract" and data.get("loan_officer_signed_at") is not None:
        data["loan_officer_user_id"] = str(user.pk)
    if model_name == "OfftakeContract" and data.get("buyer_guarantee_accepted_at") is not None:
        if str(instance.buyer_user_id) != str(user.pk):
            raise PermissionDenied("Only the named buyer may accept the guarantee.")
        if not (
            instance.status == "active"
            and instance.farmer_signed_at
            and instance.buyer_signed_at
            and instance.loan_officer_signed_at
            and instance.loan_officer_user_id
        ):
            raise ValidationError({"buyer_guarantee_accepted_at": "The guarantee can only be accepted after all three parties sign the active contract."})
        data["buyer_guarantee_accepted_at"] = timezone.now()
        settings = finance.active_loan_settings()
        data["buyer_guarantee_amount"] = finance.buyer_guarantee_amount(instance, settings)
    if model_name == "FinancingRequest" and data.get("status") == "approved":
        settings = finance.active_loan_settings()
        amount = finance.money(data.get("approved_amount", instance.approved_amount))
        if amount <= 0:
            raise ValidationError({"approved_amount": "Approved amount must be greater than zero."})
        requested_amount = finance.money(instance.requested_amount)
        if amount > requested_amount:
            raise ValidationError({"approved_amount": "Approved amount cannot exceed the original request."})
        contract = _require_active_offtake_contract(
            {"offtake_contract_id": instance.offtake_contract_id},
            instance.created_by_id,
        )
        credit_limit = _contract_financing_limit(contract, settings)
        data["credit_limit"] = credit_limit
        data["advance_percentage"] = settings.advance_percentage
        data["contract_price"] = contract.price_per_unit
        if amount > credit_limit:
            raise ValidationError({"approved_amount": "Approved amount exceeds the contract-backed financing limit."})
        tenor = instance.tenor_months or settings.default_tenor_months
        terms = finance.repayment_terms(amount, settings.monthly_interest_rate, tenor)
        data.update({
            "approved_amount": amount,
            "interest_rate": settings.monthly_interest_rate,
            "monthly_interest_rate": settings.monthly_interest_rate,
            "buyer_withholding_percentage": settings.buyer_withholding_percentage,
            "tenor_months": tenor,
            "total_cost": terms["total_cost"],
            "repayment_schedule": terms["schedule"],
        })
    if model_name == "FinancingRequest" and policies.is_active_loan_officer(user):
        current_status = instance.status
        next_status = data.get("status")
        allowed_previous = {
            "under_review": {"requested"},
            "stage1_approved": {"requested", "under_review"},
            "approved": {"stage1_approved", "returned"},
            "rejected": {"requested", "under_review", "stage1_approved", "returned"},
            "returned": {"requested", "under_review", "stage1_approved"},
        }
        if next_status in allowed_previous and current_status not in allowed_previous[next_status]:
            raise ValidationError({"status": f"Cannot change an application from '{current_status}' to '{next_status}'."})
    if model_name == "FinancingRequest" and data.get("status") in ("stage1_approved", "approved"):
        _require_active_offtake_contract(
            {"offtake_contract_id": data.get("offtake_contract_id", instance.offtake_contract_id)},
            instance.created_by_id,
        )
        if policies.is_active_loan_officer(user):
            if data.get("status") == "stage1_approved":
                data["stage1_approved_by"] = user.email
                data["stage1_approved_at"] = timezone.now()
            elif data.get("status") == "approved":
                data["approved_by"] = user.email
                data["approved_at"] = timezone.now()
    if model_name == "LoanSettings" and data.get("is_active"):
        ENTITIES["LoanSettings"].objects.exclude(pk=instance.pk).filter(is_active=True).update(is_active=False)
    if model_name == "LoanSettings":
        _validate_loan_settings({**{
            field: getattr(instance, field)
            for field in (
                "monthly_interest_rate", "buyer_withholding_percentage", "advance_percentage", "reserve_percentage",
                "maximum_financing_amount", "maximum_withholding_amount", "default_tenor_months",
            )
        }, **data})
    if model_name == "Complaint" and data.get("status") == "resolved":
        data["resolved_at"] = timezone.now()
    if model_name == "FraudAlert" and data.get("status") in {"cleared", "confirmed"}:
        data["reviewed_by"] = user.email
        data["reviewed_at"] = timezone.now()
    if model_name == "FundingFacility":
        if "committed_amount" in data:
            raise ValidationError({"committed_amount": "Committed facility amounts are calculated from immutable disbursements."})
        new_limit = finance.money(data.get("facility_limit", instance.facility_limit))
        if new_limit < finance.money(instance.committed_amount):
            raise ValidationError({"facility_limit": "A facility limit cannot be reduced below already committed funds."})
    if model_name == "Settlement" and data.get("status") == "approved" and instance.status in {"pending_review", "disputed"}:
        data["approval_date"] = timezone.now()


def _audit_write(user, action, model_name, instance):
    if model_name != "AuditLog":
        ENTITIES["AuditLog"].objects.create(
            created_by=user,
            actor_email=user.email,
            action=action,
            entity_type=model_name,
            entity_id=str(instance.pk),
        )


def _notify_user(user_id, title, message, *, kind="system", link="/notifications"):
    user = get_user_model().objects.filter(pk=_uuid_or_none(user_id), is_active=True).first()
    if user is None:
        return
    ENTITIES["Notification"].objects.create(
        created_by=user,
        user_id=str(user.pk),
        title=title,
        message=message,
        type=kind,
        link=link,
        read=False,
    )


def _notify_active_role(role, title, message, *, kind="system", link="/notifications"):
    if role == "admin":
        recipients = get_user_model().objects.filter(
            role="admin", is_active=True,
        ).values_list("id", flat=True)
        for user_id in set(recipients):
            _notify_user(user_id, title, message, kind=kind, link=link)
        return
    profile_entity = {
        "loan_officer": "LoanOfficerProfile",
        "field_officer": "FieldOfficerProfile",
    }.get(role)
    if profile_entity:
        recipients = ENTITIES[profile_entity].objects.filter(
            status="active",
        ).values_list("created_by_id", flat=True)
    elif role in policies.PARTNER_TYPES:
        recipients = ENTITIES["PartnerProfile"].objects.filter(
            partner_type=role, status="active",
        ).values_list("created_by_id", flat=True)
    else:
        recipients = get_user_model().objects.filter(
            user_type=role, is_active=True,
        ).values_list("id", flat=True)
    for user_id in set(recipients):
        _notify_user(user_id, title, message, kind=kind, link=link)


def _notify_created(user, model_name, instance):
    if model_name == "Message":
        conversation = ENTITIES["Conversation"].objects.get(pk=_uuid_or_none(instance.conversation_id))
        _notify_user(
            instance.recipient_id,
            f"New message from {instance.sender_name}",
            instance.content[:180],
            link=f"/messages?conversation_id={conversation.pk}",
        )
        conversation.last_message = instance.content[:1000]
        conversation.last_message_date = instance.created_date
        conversation.last_sender_id = instance.sender_id
        conversation.save(update_fields=["last_message", "last_message_date", "last_sender_id", "updated_date"])
        message_payload = {
            "type": "message.created",
            "message": SERIALIZERS["Message"](
                instance,
                context={"request": SimpleNamespace(user=user)},
            ).data,
        }
        participant_ids = {str(instance.sender_id), str(instance.recipient_id)}
        transaction.on_commit(lambda: _broadcast_message(participant_ids, message_payload))
    elif model_name == "Order":
        _notify_user(
            instance.vendor_user_id, "New order received",
            f"{instance.farmer_name or 'A farmer'} submitted an order.",
            kind="order", link="/vendor/orders",
        )
    elif model_name == "FinancingRequest":
        _notify_active_role(
            "loan_officer", "New financing application",
            f"A farmer requested KES {instance.requested_amount}.",
            kind="financing", link="/loanofficer/applications",
        )
    elif model_name == "OfftakeContract":
        _notify_user(
            instance.buyer_user_id, "Buyer contract needs your action",
            f"Review and sign the offtake contract for {instance.crop}.",
            kind="financing", link="/buyer/contracts",
        )
    elif model_name == "Agreement":
        _notify_user(
            instance.farmer_user_id, "Loan agreement ready to sign",
            "Review the loan cost and repayment schedule, then acknowledge and sign.",
            kind="financing",
            link=f"/orders/{instance.order_id}" if instance.order_id else "/farmer/my-loan",
        )
    elif model_name == "Settlement":
        if instance.farmer_user_id:
            _notify_user(
                instance.farmer_user_id, "Crop delivery recorded",
                "Your buyer recorded a crop delivery. Check its grade and settlement details.",
                kind="settlement", link="/farmer/my-loan",
            )
        _notify_active_role(
            "admin", "Delivery needs review",
            "A buyer recorded a delivery that may need settlement reconciliation.",
            kind="settlement", link="/admin/oversight",
        )
    elif model_name == "LoanCase":
        _notify_user(
            instance.farmer_user_id, "Your loan case was submitted",
            f"Your {instance.case_type.replace('_', ' ')} case is waiting for review.",
            kind="financing", link="/farmer/my-loan",
        )
        for role in ("collections", "compliance"):
            _notify_active_role(
                role, "Loan case needs review",
                f"A {instance.case_type.replace('_', ' ')} case was opened.",
                kind="financing", link="/admin/oversight",
            )
    elif model_name == "FarmVisit":
        _notify_user(
            instance.farmer_user_id, "A field visit was recorded",
            "A field officer has recorded a visit to your farm.",
            kind="harvest", link="/harvest",
        )
        if instance.side_selling_flag:
            _notify_active_role(
                "compliance", "Possible side-selling flagged",
                "A field visit flagged possible side-selling for review.",
                kind="financing", link="/admin/oversight",
            )
            _notify_active_role(
                "collections", "Possible side-selling flagged",
                "A field visit flagged possible side-selling for review.",
                kind="financing", link="/admin/oversight",
            )
    elif model_name == "FieldVerification":
        _notify_user(
            instance.farmer_user_id, "Field officer assigned",
            "A field officer has been assigned to verify your farm.",
            kind="kyc", link="/farmer/profile",
        )
        _notify_user(
            instance.officer_user_id, "Farm verification assigned",
            "A farmer verification has been assigned to you.",
            kind="kyc", link="/fieldofficer/assignments",
        )
    elif model_name == "Complaint":
        for role in ("compliance", "support_desk"):
            _notify_active_role(
                role, "New complaint needs attention",
                "A complaint was submitted for independent review.",
                link="/partner",
            )
    elif model_name == "PartnerProfile":
        _notify_active_role(
            "admin", "Partner account needs review",
            f"A {instance.partner_type.replace('_', ' ')} partner requested access.",
            link="/admin/oversight",
        )
    elif model_name == "KYCVerification":
        _notify_active_role(
            "admin", "KYC verification needs review",
            f"A {instance.user_type} submitted identity documents for review.",
            kind="kyc", link="/admin/approvals",
        )


def _broadcast_message(participant_ids, payload):
    channel_layer = get_channel_layer()
    for user_id in participant_ids:
        async_to_sync(channel_layer.group_send)(
            f"user_{user_id.replace('-', '')}",
            {"type": "message.created", "payload": payload},
        )


def _notify_updated(user, model_name, instance, changes, previous):
    if model_name == "VendorEmployee" and (
        changes.get("status") == "active" and previous.get("status") != "active"
    ):
        _notify_user(
            instance.employee_user_id,
            "Vendor access approved",
            f"{instance.vendor_name or 'The vendor'} approved your {instance.role} account. You can now access the vendor workspace.",
            kind="account",
            link="/vendor/dashboard",
        )
    elif model_name == "LoanDisbursement" and (
        changes.get("status") == "released" and previous.get("status") != "released"
    ):
        financing = ENTITIES["FinancingRequest"].objects.filter(
            pk=_uuid_or_none(instance.financing_request_id),
        ).first()
        if financing:
            _notify_user(
                financing.created_by_id, "Loan tranche payment confirmed",
                f"KES {instance.amount} was confirmed as paid toward your loan.",
                kind="financing", link="/farmer/my-loan",
            )
    elif model_name == "FinancingRequest" and "status" in changes:
        status_value = changes["status"]
        if status_value in {"approved", "rejected", "returned"} and status_value != previous.get("status"):
            message = {
                "approved": "Your financing application has been approved. Review and sign the loan disclosure.",
                "rejected": "Your financing application was not approved. Review the application for details.",
                "returned": "Your financing application needs more information.",
            }[status_value]
            order_id = instance.order_id
            _notify_user(
                instance.created_by_id,
                f"Financing application {status_value}",
                message,
                kind="financing",
                link=f"/orders/{order_id}" if order_id else "/farmer/my-loan",
            )
    elif model_name == "OfftakeContract":
        if "status" in changes and changes["status"] == "active" and previous.get("status") != "active":
            _notify_user(
                instance.farmer_user_id, "Buyer contract is active",
                "Your buyer has activated the offtake contract. You can now request contract-backed financing.",
                kind="financing", link="/farmer/contracts",
            )
        for signature_field, recipient_field, title, msg in (
            ("farmer_signed_at", "buyer_user_id", "Farmer signed the buyer contract", "The farmer has signed the offtake contract."),
            ("buyer_signed_at", "farmer_user_id", "Buyer signed the offtake contract", "The buyer has signed the offtake contract."),
            ("loan_officer_signed_at", "farmer_user_id", "Loan officer countersigned the contract", "The loan officer has countersigned the offtake contract."),
            ("buyer_guarantee_accepted_at", "farmer_user_id", "Buyer accepted the guarantee", "The buyer accepted the guarantee. Financing can proceed after all required signatures."),
        ):
            if signature_field in changes and changes[signature_field] and not previous.get(signature_field):
                _notify_user(
                    getattr(instance, recipient_field), title, msg,
                    kind="financing", link="/farmer/contracts",
                )
    elif model_name == "Agreement" and (
        "status" in changes and changes["status"] == "signed"
        and previous.get("status") != "signed"
    ):
        _notify_active_role(
            "loan_officer", "Farmer signed the loan disclosure",
            "The signed agreement is ready for the remaining release checks.",
            kind="financing", link="/loanofficer/portfolio",
        )
    elif model_name == "LoanCase" and "status" in changes:
        if changes["status"] in {"approved", "rejected", "resolved"}:
            _notify_user(
                instance.farmer_user_id,
                f"Your {instance.case_type.replace('_', ' ')} case was {changes['status']}",
                instance.decision_notes or "Open your loan details to review the latest case update.",
                kind="financing", link="/farmer/my-loan",
            )
    elif model_name == "Complaint" and "status" in changes:
        if changes["status"] in {"under_review", "resolved", "closed"}:
            _notify_user(
                instance.complainant_user_id,
                f"Complaint {changes['status'].replace('_', ' ')}",
                instance.resolution or "Your complaint status has been updated.",
                link="/complaints",
            )
    elif model_name == "FieldVerification" and "status" in changes:
        if changes["status"] == "pending_admin_review" and previous.get("status") != "pending_admin_review":
            _notify_active_role(
                "admin", "Field findings need approval",
                f"{instance.officer_name or 'A field officer'} submitted verification findings for {instance.farmer_name or 'a farmer'}.",
                kind="kyc", link="/admin/approvals",
            )
            _notify_user(
                instance.farmer_user_id, "Field findings submitted for review",
                "Your field verification findings are with the administrator for review.",
                kind="kyc", link="/farmer/profile",
            )
        elif changes["status"] in {"approved", "rejected"} and changes["status"] != previous.get("status"):
            _notify_user(
                instance.farmer_user_id,
                f"Field findings {changes['status']}",
                instance.rejection_reason or "The administrator reviewed the field officer's findings.",
                kind="kyc", link="/farmer/profile",
            )
    elif model_name == "KYCVerification" and "status" in changes:
        if changes["status"] in {"verified", "rejected", "resubmission_required"} and changes["status"] != previous.get("status"):
            _notify_user(
                instance.created_by_id,
                f"KYC {changes['status'].replace('_', ' ')}",
                instance.rejection_reason or "Your identity verification has been reviewed.",
                kind="kyc", link="/farmer/profile",
            )
    elif model_name == "Settlement" and (
        "status" in changes or "buyer_remitted_amount" in changes
    ):
        vendor_id = getattr(instance, "vendor_user_id", "")
        if not vendor_id and instance.vendor_name:
            vendor_id = ENTITIES["VendorProfile"].objects.filter(
                business_name__iexact=instance.vendor_name,
            ).values_list("created_by_id", flat=True).first()
        if "buyer_remitted_amount" in changes and instance.farmer_user_id:
            remitted_delta = finance.money(
                changes["buyer_remitted_amount"] or 0
            ) - finance.money(previous.get("buyer_remitted_amount") or 0)
            if remitted_delta > 0:
                _notify_user(
                    instance.farmer_user_id,
                    "Buyer remittance recorded",
                    f"KES {remitted_delta} was remitted toward your loan.",
                    kind="settlement", link="/farmer/my-loan",
                )
        if changes.get("status") == "disputed" and previous.get("status") != "disputed":
            _notify_active_role(
                "compliance", "Delivery settlement disputed",
                "A settlement dispute needs independent review.",
                kind="settlement", link="/admin/oversight",
            )
            _notify_active_role(
                "support_desk", "Delivery settlement disputed",
                "A settlement dispute needs independent review.",
                kind="settlement", link="/partner",
            )
        elif changes.get("status") == "approved" and previous.get("status") != "approved":
            _notify_user(
                vendor_id,
                "Settlement approved",
                f"Your settlement claim of KES {instance.amount} was approved.",
                kind="settlement", link="/vendor/settlements",
            )
        elif changes.get("status") == "paid" and previous.get("status") != "paid":
            _notify_user(
                vendor_id,
                "Settlement payment completed",
                f"Your settlement was paid. Reference: {instance.payment_reference or 'not provided'}.",
                kind="settlement", link="/vendor/settlements",
            )
    elif model_name == "PartnerProfile" and (
        "status" in changes and changes["status"] == "active"
        and previous.get("status") != "active"
    ):
        _notify_user(
            instance.created_by_id, "Partner access approved",
            "Your partner account is active and your workspace is ready.",
            link="/partner",
        )
def _save_new(request, model_name, payload):
    model = _model(model_name)
    user = request.user
    if model_name == "Settlement" and payload.get("offtake_contract_id") and "amount" not in payload:
        payload = {**payload, "amount": 0}
    serializer = SERIALIZERS[model_name](data=payload, context={"request": request})
    serializer.is_valid(raise_exception=True)
    data = dict(serializer.validated_data)
    if model_name == "Message":
        data["sender_id"] = str(user.pk)
    if not policies.can_create(model_name, user, {**{k: v for k, v in payload.items()}, **data}):
        raise PermissionDenied("You are not allowed to create this record.")
    create_checks(model_name, user, data)
    data = apply_guards(model_name, user, None, data, creating=True)
    record_creator = user
    if model_name in {"VendorProfile", "VendorEmployee"}:
        vendor_user_id = policies.vendor_account_id(user, "team")
        if vendor_user_id:
            record_creator = get_user_model().objects.filter(pk=_uuid_or_none(vendor_user_id)).first() or user
    elif model_name == "KYCVerification" and data.get("user_type") == "vendor":
        vendor_user_id = policies.vendor_account_id(user, "team")
        if vendor_user_id:
            record_creator = get_user_model().objects.filter(pk=_uuid_or_none(vendor_user_id)).first() or user
    instance = model.objects.create(created_by=record_creator, **data)
    if model_name == "LoanSettings" and instance.is_active:
        ENTITIES["LoanSettings"].objects.exclude(pk=instance.pk).filter(is_active=True).update(is_active=False)
    if model_name == "SettlementReconciliation":
        settlement = ENTITIES["Settlement"].objects.select_for_update().get(
            pk=_uuid_or_none(instance.settlement_id),
        )
        _refresh_settlement_reconciliation(settlement)
        _notify_active_role(
            "admin",
            "Sale proceeds need independent verification",
            f"The buyer submitted evidence for {instance.payment_type.replace('_', ' ')}.",
            kind="settlement",
            link="/admin/oversight",
        )
    if model_name == "Settlement" and instance.harvest_id:
        harvest = ENTITIES["Harvest"].objects.get(pk=_uuid_or_none(instance.harvest_id))
        harvest.settlement_status = "delivered"
        harvest.delivery_quantity = instance.delivery_quantity
        harvest.delivery_date = instance.delivery_date.date() if instance.delivery_date else timezone.localdate()
        harvest.crop_grade = instance.crop_grade
        harvest.save(update_fields=[
            "settlement_status", "delivery_quantity", "delivery_date", "crop_grade", "updated_date",
        ])
    if model_name == "FarmVisit" and instance.side_selling_flag:
        financing_id = instance.financing_request_id or ENTITIES["FinancingRequest"].objects.filter(
            created_by_id=_uuid_or_none(instance.farmer_user_id),
            status="approved",
        ).order_by("-created_date").values_list("id", flat=True).first()
    else:
        financing_id = ""
    if model_name == "FarmVisit" and instance.side_selling_flag and financing_id:
        ENTITIES["LoanCase"].objects.create(
            created_by=user,
            financing_request_id=str(financing_id),
            farmer_user_id=instance.farmer_user_id,
            buyer_user_id=OfftakeContract.objects.filter(
                pk=_uuid_or_none(ENTITIES["FinancingRequest"].objects.filter(
                    pk=_uuid_or_none(financing_id),
                ).values_list("offtake_contract_id", flat=True).first()),
            ).values_list("buyer_user_id", flat=True).first() or "",
            case_type="side_selling",
            status="open",
            evidence={"farm_visit_id": str(instance.pk), "notes": instance.notes, "photos": instance.photos},
        )
    _notify_created(user, model_name, instance)
    _audit_write(user, "CREATE", model_name, instance)
    _run_fraud_checks(user, model_name, instance)
    return instance


def _update(request, model_name, pk, payload):
    model = _model(model_name)
    user = request.user
    instance = policies.scope(model, user, "read").select_for_update().filter(pk=pk).first()
    if instance is None:
        raise NotFound("Record not found.")
    if not policies.scope(model, user, "update").filter(pk=pk).exists():
        raise PermissionDenied("You are not allowed to update this record.")
    payload = {k: v for k, v in payload.items() if k not in SYSTEM_FIELDS and k not in ("created_by_id",)}
    serializer = SERIALIZERS[model_name](instance, data=payload, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    data = apply_guards(model_name, user, instance, dict(serializer.validated_data), creating=False)
    update_checks(model_name, user, instance, data)
    previous = {name: getattr(instance, name, None) for name in data}
    for name, value in data.items():
        setattr(instance, name, value)
    instance.save()
    if (
        model_name == "FieldVerification"
        and instance.status in {"approved", "rejected"}
        and previous.get("status") == "pending_admin_review"
    ):
        farmer_profile = ENTITIES["FarmerProfile"].objects.select_for_update().filter(
            created_by_id=_uuid_or_none(instance.farmer_user_id),
        ).first()
        if farmer_profile:
            farmer_profile.verification_status = "verified" if instance.status == "approved" else "rejected"
            farmer_profile.save(update_fields=["verification_status", "updated_date"])
        ENTITIES["AuditLog"].objects.create(
            created_by=user,
            actor_email=user.email,
            action=f"FIELD_FINDINGS_{instance.status.upper()}",
            entity_type="FieldVerification",
            entity_id=str(instance.pk),
            notes=instance.rejection_reason if instance.status == "rejected" else "Admin approved field officer findings.",
        )
    if (
        model_name == "LoanDisbursement"
        and previous.get("status") == "pending_confirmation"
        and instance.status == "released"
    ):
        financing = ENTITIES["FinancingRequest"].objects.select_for_update().get(
            pk=instance.financing_request_id,
        )
        facility = FundingFacility.objects.select_for_update().get(pk=instance.facility_id)
        facility.committed_amount = finance.money((facility.committed_amount or 0) + instance.amount)
        facility.save(update_fields=["committed_amount", "updated_date"])
        finance.append_ledger_entry(
            financing_request=financing,
            entry_type="disbursement",
            amount=instance.amount,
            principal_delta=instance.amount,
            facility_id=facility.pk,
            reference=instance.reference,
            notes=instance.notes,
            metadata={"tranche_id": str(instance.pk), "tranche_number": instance.tranche_number},
            effective_date=instance.released_at,
        )
    if (
        model_name == "SettlementReconciliation"
        and previous.get("status") == "pending_verification"
        and instance.status in {"verified", "rejected"}
    ):
        settlement = ENTITIES["Settlement"].objects.select_for_update().get(
            pk=_uuid_or_none(instance.settlement_id),
        )
        if instance.status == "verified" and instance.payment_type == "buyer_withholding":
            financing = ENTITIES["FinancingRequest"].objects.select_for_update().filter(
                pk=_uuid_or_none(instance.financing_request_id),
                status="approved",
            ).first()
            if financing is None:
                raise ValidationError({"settlement_id": "No approved financing exists for this buyer withholding."})
            finance.accrue_monthly_interest(financing, timezone.localdate())
            principal, interest = finance.loan_balances(financing.pk)
            amount = finance.money(instance.amount)
            if amount > principal + interest:
                raise ValidationError({
                    "amount": "Verified withholding exceeds the current loan balance; reconcile the excess with the farmer before approval."
                })
            interest_paid = min(amount, interest)
            principal_paid = min(amount - interest_paid, principal)
            finance.append_ledger_entry(
                financing_request=financing,
                entry_type="buyer_withholding",
                amount=amount,
                principal_delta=-principal_paid,
                interest_delta=-interest_paid,
                settlement_id=settlement.pk,
                reference=instance.external_reference,
                notes="Buyer withholding independently verified by an administrator.",
                metadata={"reconciliation_id": str(instance.pk)},
                effective_date=timezone.now(),
            )
        _refresh_settlement_reconciliation(settlement)
        _notify_user(
            settlement.farmer_user_id,
            "Sale proceeds reconciliation updated",
            f"Your {instance.payment_type.replace('_', ' ')} claim was {instance.status}.",
            kind="settlement",
            link="/farmer/my-loan",
        )
    _notify_updated(user, model_name, instance, data, previous)
    _audit_write(user, "UPDATE", model_name, instance)
    return instance


def _out(request, model_name, obj_or_list, many=False):
    return SERIALIZERS[model_name](obj_or_list, many=many, context={"request": request}).data


def _read_qs(request, model):
    return policies.scope(model, request.user, "read").select_related("created_by")


def _payload(request):
    body = request.data
    if not isinstance(body, dict):
        raise ValidationError({"detail": "Expected a JSON object."})
    return body


def _items(request):
    items = _payload(request).get("items")
    if not isinstance(items, list) or not items or len(items) > MAX_BULK or not all(isinstance(i, dict) for i in items):
        raise ValidationError({"items": f"Provide between 1 and {MAX_BULK} objects."})
    return items


# --- views ---------------------------------------------------------------------------------------------
class EntityList(APIView):
    def get(self, request, name):
        model = _model(name)
        p = request.query_params
        qs = apply_query(model, _read_qs(request, model), json_param(p.get("q")), p.get("sort"), p.get("limit"), p.get("skip"))
        return Response(_out(request, name, qs, many=True))

    def post(self, request, name):
        with transaction.atomic():
            instance = _save_new(request, name, _payload(request))
        return Response(_out(request, name, instance), status=status.HTTP_201_CREATED)


class MessageRecipients(APIView):
    def get(self, request):
        query = str(request.query_params.get("q") or "").strip()[:100]
        users = get_user_model().objects.filter(is_active=True).exclude(pk=request.user.pk)
        if query:
            users = users.filter(
                Q(full_name__icontains=query)
                | Q(email__icontains=query)
                | Q(user_type__icontains=query)
                | Q(role__icontains=query)
            )
        results = [
            {
                "id": str(user.pk),
                "full_name": user.full_name,
                "email": user.email,
                "role": user.role,
                "user_type": user.user_type or None,
            }
            for user in users.order_by("full_name", "email")[:50]
        ]
        return Response(results)


class StartConversation(APIView):
    def post(self, request):
        payload = _payload(request)
        recipient_id = _uuid_or_none(payload.get("recipient_id"))
        email = str(payload.get("email") or "").strip()
        recipients = get_user_model().objects.filter(is_active=True).exclude(pk=request.user.pk)
        if recipient_id:
            recipient = recipients.filter(pk=recipient_id).first()
        elif email:
            recipient = recipients.filter(email__iexact=email).first()
        else:
            raise ValidationError({"recipient_id": "Choose an active user to message."})
        if recipient is None:
            raise ValidationError({"recipient_id": "No active account matched that user."})
        user_id = str(request.user.pk)
        recipient_id = str(recipient.pk)
        with transaction.atomic():
            conversation = ENTITIES["Conversation"].objects.filter(
                Q(user1_id=user_id, user2_id=recipient_id)
                | Q(user1_id=recipient_id, user2_id=user_id)
            ).first()
            if conversation is None:
                conversation = ENTITIES["Conversation"].objects.create(
                    created_by=request.user,
                    user1_id=user_id,
                    user1_name=request.user.full_name or request.user.email,
                    user2_id=recipient_id,
                    user2_name=recipient.full_name or recipient.email,
                )
        return Response(_out(request, "Conversation", conversation), status=status.HTTP_200_OK)


class AccrueLoanInterest(APIView):
    def post(self, request, pk):
        if not policies.is_admin(request.user) and not policies.is_partner_role(request.user, "collections"):
            raise PermissionDenied("Only administrators or active collections partners may run interest accrual.")
        with transaction.atomic():
            financing = ENTITIES["FinancingRequest"].objects.select_for_update().filter(
                pk=pk, status="approved",
            ).first()
            if financing is None:
                raise NotFound("Approved financing request not found.")
            entries = finance.accrue_monthly_interest(financing, timezone.localdate())
            if entries:
                ENTITIES["AuditLog"].objects.create(
                    created_by=request.user,
                    actor_email=request.user.email,
                    action="MONTHLY_INTEREST_ACCRUAL",
                    entity_type="FinancingRequest",
                    entity_id=str(financing.pk),
                    notes=f"Posted {len(entries)} monthly interest accrual entries.",
                )
        principal, interest = finance.loan_balances(financing.pk)
        return Response({
            "created_entries": len(entries),
            "principal_balance": str(principal),
            "interest_balance": str(interest),
        })


class InterestPortfolio(APIView):
    def get(self, request):
        if not (
            policies.is_admin(request.user)
            or policies.is_active_loan_officer(request.user)
            or policies.is_partner_role(request.user, "collections")
            or request.user.user_type == "farmer"
        ):
            raise PermissionDenied("Loan interest information is not available to this account.")
        return Response(self._portfolio(request.user))

    def post(self, request):
        if not (
            policies.is_admin(request.user)
            or policies.is_partner_role(request.user, "collections")
        ):
            raise PermissionDenied("Only administrators or active collections partners may run interest accrual.")
        finance.accrue_portfolio_interest(actor=request.user, through_date=timezone.localdate())
        return Response(self._portfolio(request.user))

    @staticmethod
    def _portfolio(user):
        from collections import defaultdict

        loans = list(
            ENTITIES["FinancingRequest"].objects.filter(status="approved")
            .filter(Q(created_by=user) if user.user_type == "farmer" and not policies.is_admin(user) else Q())
            .select_related("created_by")
            .order_by("created_date")
        )
        loan_ids = [str(loan.pk) for loan in loans]
        movements = list(
            LoanLedgerEntry.objects.filter(financing_request_id__in=loan_ids)
            .order_by("effective_date", "created_date")
            .values(
                "financing_request_id", "entry_type", "amount", "principal_delta",
                "interest_delta", "effective_date",
            )
        )
        owners = {str(loan.created_by_id): loan.created_by for loan in loans if loan.created_by_id}
        profiles = {
            str(profile.created_by_id): profile
            for profile in FarmerProfile.objects.filter(created_by_id__in=owners)
        }
        movement_by_loan = defaultdict(list)
        for movement in movements:
            movement_by_loan[movement["financing_request_id"]].append(movement)

        as_of = timezone.localdate()
        month_key = as_of.strftime("%Y-%m")
        loan_rows = []
        individual_rows = {}
        for loan in loans:
            principal = Decimal("0.00")
            interest = Decimal("0.00")
            monthly_history = defaultdict(lambda: Decimal("0.00"))
            last_accrual = None
            for movement in movement_by_loan[str(loan.pk)]:
                principal += Decimal(str(movement["principal_delta"] or 0))
                interest += Decimal(str(movement["interest_delta"] or 0))
                effective_date = movement["effective_date"]
                if movement["entry_type"] == "interest_accrual" and effective_date:
                    period = effective_date.strftime("%Y-%m")
                    monthly_history[period] += Decimal(str(movement["amount"] or 0))
                    last_accrual = effective_date
            principal = finance.money(max(principal, Decimal("0.00")))
            interest = finance.money(max(interest, Decimal("0.00")))
            total_owed = finance.money(principal + interest)
            if total_owed <= 0:
                continue

            owner_id = str(loan.created_by_id or "")
            profile = profiles.get(owner_id)
            owner = owners.get(owner_id)
            farmer_name = (
                (profile.full_name if profile else "")
                or (owner.full_name if owner else "")
                or loan.farmer_name
                or "Farmer"
            )
            borrower_key = owner_id or f"unassigned:{loan.pk}"
            current_month_interest = finance.money(monthly_history.get(month_key, Decimal("0.00")))
            row = {
                "financing_request_id": str(loan.pk),
                "borrower_user_id": owner_id,
                "farmer_name": farmer_name,
                "approved_amount": str(finance.money(loan.approved_amount)),
                "monthly_interest_rate": str(loan.monthly_interest_rate or 0),
                "principal_balance": str(principal),
                "interest_balance": str(interest),
                "total_owed": str(total_owed),
                "monthly_interest": str(current_month_interest),
                "last_accrual_date": last_accrual.isoformat() if last_accrual else None,
                "monthly_history": [
                    {"month": period, "amount": str(finance.money(amount))}
                    for period, amount in sorted(monthly_history.items(), reverse=True)
                ],
            }
            loan_rows.append(row)
            individual = individual_rows.setdefault(borrower_key, {
                "borrower_user_id": owner_id,
                "farmer_name": farmer_name,
                "loans_count": 0,
                "principal_balance": Decimal("0.00"),
                "interest_balance": Decimal("0.00"),
                "total_owed": Decimal("0.00"),
                "monthly_interest": Decimal("0.00"),
            })
            individual["loans_count"] += 1
            individual["principal_balance"] += principal
            individual["interest_balance"] += interest
            individual["total_owed"] += total_owed
            individual["monthly_interest"] += current_month_interest

        individuals = []
        for individual in individual_rows.values():
            for key in ("principal_balance", "interest_balance", "total_owed", "monthly_interest"):
                individual[key] = str(finance.money(individual[key]))
            individuals.append(individual)
        individuals.sort(key=lambda item: Decimal(item["total_owed"]), reverse=True)
        loan_rows.sort(key=lambda item: Decimal(item["total_owed"]), reverse=True)
        return {
            "as_of": as_of.isoformat(),
            "month": month_key,
            "summary": {
                "individuals": len(individuals),
                "principal_balance": str(sum((Decimal(row["principal_balance"]) for row in individuals), Decimal("0.00"))),
                "interest_balance": str(sum((Decimal(row["interest_balance"]) for row in individuals), Decimal("0.00"))),
                "total_owed": str(sum((Decimal(row["total_owed"]) for row in individuals), Decimal("0.00"))),
                "monthly_interest": str(sum((Decimal(row["monthly_interest"]) for row in individuals), Decimal("0.00"))),
            },
            "individuals": individuals,
            "loans": loan_rows,
        }


class EntityQuery(APIView):
    def post(self, request, name):
        model = _model(name)
        b = _payload(request)
        qs = apply_query(model, _read_qs(request, model), b.get("q"), b.get("sort"), b.get("limit"), b.get("skip"))
        return Response(_out(request, name, qs, many=True))


class EntityDetail(APIView):
    def get(self, request, name, pk):
        model = _model(name)
        instance = _read_qs(request, model).filter(pk=pk).first()
        if instance is None:
            raise NotFound("Record not found.")
        return Response(_out(request, name, instance))

    def patch(self, request, name, pk):
        with transaction.atomic():
            instance = _update(request, name, pk, _payload(request))
        return Response(_out(request, name, instance))

    put = patch

    def delete(self, request, name, pk):
        if name in {"LoanDisbursement", "LoanLedgerEntry", "AuditLog", "ConsentRecord"}:
            raise PermissionDenied(f"{name} records are append-only.")
        model = _model(name)
        instance = policies.scope(model, request.user, "read").filter(pk=pk).first()
        if instance is None:
            raise NotFound("Record not found.")
        with transaction.atomic():
            if not policies.scope(model, request.user, "delete").filter(pk=pk).exists():
                raise PermissionDenied("You are not allowed to delete this record.")
            _audit_write(request.user, "DELETE", name, instance)
            instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EntityBulkCreate(APIView):
    def post(self, request, name):
        with transaction.atomic():
            created = [_save_new(request, name, item) for item in _items(request)]
        return Response(_out(request, name, created, many=True), status=status.HTTP_201_CREATED)


class EntityBulkUpdate(APIView):
    def post(self, request, name):
        items = _items(request)
        with transaction.atomic():
            updated = []
            for item in items:
                if "id" not in item:
                    raise ValidationError({"items": "Every item needs an id."})
                updated.append(_update(request, name, item["id"], {k: v for k, v in item.items() if k != "id"}))
        return Response(_out(request, name, updated, many=True))


class EntityDeleteMany(APIView):
    def post(self, request, name):
        if name in {"LoanDisbursement", "LoanLedgerEntry", "AuditLog", "ConsentRecord"}:
            raise PermissionDenied(f"{name} records are append-only.")
        model = _model(name)
        query = _payload(request).get("q") or {}
        try:
            q = build_q(model, query)
        except NoMatch:
            return Response({"deleted": 0})
        # only what the user may both see and delete; the rule filters are applied by `scope`
        with transaction.atomic():
            queryset = policies.scope(model, request.user, "delete").filter(q)
            targets = list(queryset)
            for instance in targets:
                _audit_write(request.user, "DELETE", name, instance)
            deleted, _ = queryset.delete()
        return Response({"deleted": deleted})


def json_param(raw):
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        raise ValidationError({"q": "q must be valid JSON."})
