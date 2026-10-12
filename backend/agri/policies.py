"""Access control, ported from the `rls` blocks of the old Base44 entity files.

Rules (a list per action means "any of these may act"):
    ANY            any signed-in user
    ADMIN          users with role == "admin"
    OWNER          the user who created the record      (Base44: created_by_id == user.id)
    field("x")     record.x == the user's id            (Base44: data.x == user.id)
    custom(fn)     fn(user) -> Q, for rules that need a query (read/update/delete only)

On top of the ported rules there are a few hardening layers the Base44 platform did not give you:
GUARDS (status/approval fields only admins, or specific transitions, may set), UPDATE_ONLY (non-admins
may only touch listed fields on some entities) and HIDDEN (fields redacted for non-owners).
"""
from uuid import UUID

from django.db.models import Q

ANY = "any"
ADMIN = "admin"
OWNER = "owner"


class field:  # noqa: N801 - reads like a rule constructor
    def __init__(self, name):
        self.name = name


class custom:  # noqa: N801
    def __init__(self, fn):
        self.fn = fn


def _uuids(values):
    out = []
    for v in values:
        try:
            out.append(UUID(str(v)))
        except ValueError:
            pass
    return out


def _assigned_farmers(user):
    from .models import FieldVerification

    ids = FieldVerification.objects.filter(officer_user_id=str(user.pk)).values_list("farmer_user_id", flat=True)
    return _uuids(ids)


def _farmer_financing_ids(user):
    from .models import FinancingRequest

    return list(FinancingRequest.objects.filter(created_by_id=user.pk).values_list("id", flat=True))


# Field officers may read/update the farmer profiles they've been assigned to verify.
assigned_officer = custom(lambda user: Q(created_by_id__in=_assigned_farmers(user)))
active_listing = custom(lambda user: Q(status="active"))  # buyers publish an "active" listing farmers can browse
farmer_loan_records = custom(lambda user: Q(financing_request_id__in=[
    str(item_id) for item_id in _farmer_financing_ids(user)
]))


def is_active_loan_officer(user):
    if not user or not user.is_authenticated or user.user_type != "loan_officer":
        return False
    from .models import LoanOfficerProfile

    return LoanOfficerProfile.objects.filter(created_by_id=user.pk, status="active").exists()


loan_officer = custom(lambda user: Q() if is_active_loan_officer(user) else Q(pk__in=[]))

PARTNER_TYPES = {
    "insurer", "credit_bureau", "agronomist", "warehouse_logistics", "cooperative",
    "mobile_money", "compliance", "collections", "support_desk",
}


def is_partner_role(user, *roles):
    if not user or not user.is_authenticated or user.user_type not in roles:
        return False
    from .models import PartnerProfile

    return PartnerProfile.objects.filter(created_by_id=user.pk, status="active").exists()


def is_complaints_staff(user):
    return is_admin(user) or is_partner_role(user, "compliance", "support_desk")


def _consented_users(consent_type):
    from django.utils import timezone

    from .models import ConsentRecord

    active = set()
    seen = set()
    for record in ConsentRecord.objects.filter(consent_type=consent_type).order_by(
        "consenting_user_id", "-created_date"
    ):
        user_id = record.consenting_user_id
        if user_id in seen:
            continue
        seen.add(user_id)
        if record.granted and (record.expires_at is None or record.expires_at > timezone.now()):
            active.add(user_id)
    return active


def consented_field(user_type, consent_type, field_name):
    return custom(
        lambda user: Q(**{f"{field_name}__in": _consented_users(consent_type)})
        if is_partner_role(user, user_type) else Q(pk__in=[])
    )


def consented_financing(user_type, consent_type):
    return custom(
        lambda user: Q(created_by_id__in=_consented_users(consent_type))
        if is_partner_role(user, user_type) else Q(pk__in=[])
    )


def consented_loans(user_type, consent_type):
    def query(user):
        from .models import FinancingRequest

        if not is_partner_role(user, user_type):
            return Q(pk__in=[])
        loan_ids = FinancingRequest.objects.filter(
            created_by_id__in=_consented_users(consent_type)
        ).values_list("id", flat=True)
        return Q(financing_request_id__in=[str(loan_id) for loan_id in loan_ids])

    return custom(query)


def is_workflow_staff(user):
    return is_admin(user) or is_active_loan_officer(user) or is_partner_role(
        user, "compliance", "collections", "support_desk"
    )


workflow_staff = custom(lambda user: Q() if is_workflow_staff(user) else Q(pk__in=[]))
active_loan_settings = custom(lambda user: Q(is_active=True))


def participant(name):
    return custom(lambda user: Q(**{name: str(user.pk)}))


def vendor_employee_for_user(user, statuses=("active",)):
    if not user or not user.is_authenticated:
        return None
    from .models import VendorEmployee

    return VendorEmployee.objects.filter(
        employee_user_id=str(user.pk),
        employee_email__iexact=user.email,
        status__in=statuses,
    ).first()


def vendor_account_id(user, feature):
    if not user or not user.is_authenticated:
        return ""
    employee = vendor_employee_for_user(user)
    if employee:
        if employee.role == "manager" or (
            employee.role == "assistant" and feature in {"products", "orders"}
        ):
            return employee.vendor_user_id
        return ""
    return str(user.pk) if user.user_type == "vendor" else ""


def vendor_staff(feature):
    return custom(
        lambda user: Q(vendor_user_id=account_id)
        if (account_id := vendor_account_id(user, feature))
        else Q(pk__in=[])
    )


def vendor_profile_access(user):
    account_id = vendor_account_id(user, "products")
    return Q(created_by_id=account_id) if account_id else Q(pk__in=[])


def vendor_kyc_access(user):
    account_id = vendor_account_id(user, "team")
    return Q(created_by_id=account_id, user_type="vendor") if account_id else Q(pk__in=[])


def vendor_team_access(user):
    employee = vendor_employee_for_user(user)
    if employee and employee.role == "manager":
        account_id = employee.vendor_user_id
    elif user and user.is_authenticated and user.user_type == "vendor":
        account_id = str(user.pk)
    else:
        account_id = ""
    query = Q(vendor_user_id=account_id) if account_id else Q(pk__in=[])
    if user and user.is_authenticated:
        query |= Q(employee_user_id=str(user.pk))
    return query


def vendor_team_manager_access(user):
    employee = vendor_employee_for_user(user)
    if employee and employee.role == "manager":
        account_id = employee.vendor_user_id
    elif user and user.is_authenticated and user.user_type == "vendor":
        account_id = str(user.pk)
    else:
        account_id = ""
    return Q(vendor_user_id=account_id) if account_id else Q(pk__in=[])


def is_vendor_team_manager(user, vendor_user_id):
    if not user or not user.is_authenticated:
        return False
    if user.user_type == "vendor" and str(user.pk) == str(vendor_user_id):
        return True
    employee = vendor_employee_for_user(user)
    return bool(
        employee
        and employee.role == "manager"
        and employee.vendor_user_id == str(vendor_user_id)
    )


class Policy:
    def __init__(self, read=(ANY,), create=(ANY,), update=(), delete=()):
        self.read, self.create, self.update, self.delete = list(read), list(create), list(update), list(delete)


_OWNER_ADMIN = [OWNER, ADMIN]
_ADMIN = [ADMIN]


def _profile(read_extra=()):
    return Policy(read=[OWNER, ADMIN, *read_extra], create=[OWNER], update=[OWNER, ADMIN], delete=[OWNER, ADMIN])


POLICIES = {
    "Agreement": Policy(
        read=[field("farmer_user_id"), ADMIN],
        create=[ADMIN, loan_officer],
        update=[field("farmer_user_id"), ADMIN],
        delete=_ADMIN,
    ),
    "AuditLog": Policy(read=_ADMIN, create=[OWNER], update=_ADMIN, delete=_ADMIN),
    "Complaint": Policy(read=[OWNER, custom(lambda user: Q() if is_complaints_staff(user) else Q(pk__in=[]))],
                        create=[ANY], update=[custom(lambda user: Q() if is_complaints_staff(user) else Q(pk__in=[]))],
                        delete=_ADMIN),
    "ConsentRecord": Policy(read=[participant("consenting_user_id"), ADMIN],
                            create=[participant("consenting_user_id")], update=(), delete=()),
    "BuyerProfile": _profile(read_extra=[active_listing]),
    "Category": Policy(read=[ANY], create=_ADMIN, update=_ADMIN, delete=_ADMIN),
    "Conversation": Policy(
        read=[field("user1_id"), field("user2_id")], create=[field("user1_id"), field("user2_id")],
        update=_ADMIN, delete=_ADMIN),
    "FarmerProfile": Policy(read=[OWNER, ADMIN, assigned_officer,
                                 consented_field("cooperative", "cooperative", "created_by_id")],
                            create=[OWNER], update=[OWNER, ADMIN, assigned_officer],
                            delete=_OWNER_ADMIN),
    "FieldOfficerProfile": _profile(),
    "LoanOfficerProfile": _profile(),
    "PartnerProfile": _profile(),
    "FieldVerification": Policy(
        read=[field("farmer_user_id"), field("officer_user_id"), ADMIN], create=_ADMIN,
        update=[field("officer_user_id"), ADMIN], delete=_ADMIN),
    "FarmVisit": Policy(
        read=[participant("farmer_user_id"), participant("officer_user_id"), workflow_staff,
              consented_field("agronomist", "field_monitoring", "farmer_user_id")],
        create=[OWNER], update=[participant("officer_user_id"), workflow_staff], delete=_ADMIN),
    "FraudAlert": Policy(read=[workflow_staff], create=_ADMIN, update=[workflow_staff], delete=_ADMIN),
    "FinancingRequest": Policy(
        read=[OWNER, loan_officer, ADMIN, consented_financing("credit_bureau", "credit_bureau")],
        create=[OWNER], update=[loan_officer, ADMIN], delete=_ADMIN),
    "FundingFacility": Policy(read=[loan_officer, ADMIN], create=_ADMIN, update=_ADMIN, delete=_ADMIN),
    "Harvest": Policy(read=[OWNER, field("buyer_user_id"), ADMIN,
                            consented_field("agronomist", "field_monitoring", "created_by_id")],
                      create=[OWNER], update=[OWNER, field("buyer_user_id"), ADMIN],
                      delete=_ADMIN),
    "KYCVerification": Policy(
        read=[OWNER, ADMIN, custom(vendor_kyc_access)],
        create=[OWNER],
        update=[OWNER, custom(vendor_kyc_access), ADMIN],
        delete=[OWNER, ADMIN],
    ),
    "LoanCase": Policy(
        read=[participant("farmer_user_id"), participant("buyer_user_id"), workflow_staff,
              custom(lambda user: Q(case_type="crop_failure", farmer_user_id__in=_consented_users("insurance"))
                     if is_partner_role(user, "insurer") else Q(pk__in=[]))],
        create=[OWNER], update=[workflow_staff], delete=_ADMIN),
    "LoanDisbursement": Policy(
        read=[farmer_loan_records, loan_officer, workflow_staff, ADMIN,
              consented_loans("mobile_money", "mobile_money")], create=_ADMIN, update=_ADMIN, delete=()),
    "LoanLedgerEntry": Policy(
        read=[farmer_loan_records, loan_officer, workflow_staff, ADMIN,
              consented_loans("credit_bureau", "credit_bureau"),
              consented_loans("mobile_money", "mobile_money")], create=_ADMIN, update=(), delete=()),
    "LoanProduct": Policy(read=[ANY], create=_ADMIN, update=_ADMIN, delete=_ADMIN),
    "LoanSettings": Policy(read=[active_loan_settings, ADMIN], create=_ADMIN, update=_ADMIN, delete=_ADMIN),
    "Message": Policy(read=[field("sender_id"), field("recipient_id")], create=[field("sender_id")],
                      update=[field("recipient_id"), ADMIN], delete=_ADMIN),
    # Notifications are system-generated; users can only read and dismiss their own.
    "Notification": Policy(read=[field("user_id"), ADMIN], create=_ADMIN, update=[field("user_id"), ADMIN],
                           delete=[field("user_id"), ADMIN]),
    "OfftakeContract": Policy(
        read=[field("farmer_user_id"), field("buyer_user_id"), loan_officer, ADMIN],
        create=[field("farmer_user_id"), field("buyer_user_id"), ADMIN],
        update=[field("farmer_user_id"), field("buyer_user_id"), loan_officer, ADMIN], delete=_ADMIN),
    "Order": Policy(read=[OWNER, vendor_staff("orders"), ADMIN], create=[OWNER], update=[OWNER, vendor_staff("orders"), ADMIN],
                    delete=_ADMIN),
    "Product": Policy(read=[ANY], create=_OWNER_ADMIN, update=[OWNER, vendor_staff("products"), ADMIN],
                      delete=[OWNER, vendor_staff("products"), ADMIN]),
    "Redemption": Policy(read=[OWNER, field("farmer_user_id"), ADMIN], create=[OWNER], update=_ADMIN, delete=_ADMIN),
    "Settlement": Policy(read=[OWNER, vendor_staff("settlements"), field("buyer_user_id"), field("farmer_user_id"), ADMIN,
                               consented_field("warehouse_logistics", "logistics", "farmer_user_id")], create=[OWNER],
                         update=[vendor_staff("settlements"), field("buyer_user_id"), ADMIN], delete=_ADMIN),
    "SettlementReconciliation": Policy(
        read=[field("buyer_user_id"), field("farmer_user_id"), ADMIN],
        create=[OWNER], update=_ADMIN, delete=(),
    ),
    "VendorEmployee": Policy(read=[custom(vendor_team_access), ADMIN], create=(),
                             update=[custom(vendor_team_manager_access), ADMIN],
                             delete=[custom(vendor_team_manager_access)]),
    "VendorProfile": Policy(
        read=[OWNER, ADMIN, custom(vendor_profile_access)],
        create=[OWNER],
        update=[OWNER, vendor_staff("team"), ADMIN],
        delete=[OWNER, ADMIN],
    ),
    "Voucher": Policy(read=[field("farmer_user_id"), vendor_staff("redemptions"), ADMIN], create=[field("farmer_user_id"), ADMIN],
                      update=[vendor_staff("redemptions"), ADMIN], delete=_ADMIN),
}

# Fields that must be present when creating (the old `required` lists).
REQUIRED = {
    "Agreement": ["agreement_number", "farmer_user_id"],
    "AuditLog": ["action", "entity_type"],
    "BuyerProfile": ["business_name"],
    "Category": ["name"],
    "Conversation": ["user1_id", "user2_id"],
    "FarmerProfile": ["full_name"],
    "FieldOfficerProfile": ["full_name"],
    "LoanOfficerProfile": ["full_name"],
    "PartnerProfile": ["partner_type"],
    "FieldVerification": ["farmer_user_id", "officer_user_id"],
    "FarmVisit": ["farmer_user_id", "officer_user_id", "visit_date"],
    "FinancingRequest": ["order_id", "offtake_contract_id", "requested_amount"],
    "FundingFacility": ["facility_name", "facility_limit"],
    "LoanCase": ["financing_request_id", "case_type"],
    "LoanDisbursement": ["financing_request_id", "facility_id", "amount", "reference"],
    "LoanLedgerEntry": ["financing_request_id", "entry_type", "amount"],
    "Harvest": ["crop"],
    "KYCVerification": ["user_type", "document_url"],
    "LoanProduct": ["institution_name", "interest_rate", "advance_percentage"],
    "Message": ["conversation_id", "sender_id", "recipient_id", "content"],
    "Notification": ["user_id", "title", "message"],
    "OfftakeContract": ["contract_number", "farmer_user_id", "buyer_user_id", "crop"],
    "Order": ["vendor_user_id", "items", "total"],
    "Product": ["name", "price", "vendor_user_id"],
    "Redemption": ["voucher_id"],
    # voucher_id was required in Base44, but the buyer-delivery flow creates settlements from an offtake
    # contract with no voucher, so only the amount is mandatory here.
    "Settlement": ["amount"],
    "SettlementReconciliation": [
        "settlement_id", "payment_type", "amount", "external_reference", "evidence_url",
    ],
    "VendorEmployee": ["vendor_user_id", "employee_email", "employee_name"],
    "VendorProfile": ["business_name"],
    "Voucher": ["voucher_code", "farmer_user_id", "vendor_user_id"],
}

# --- hardening layers ----------------------------------------------------------------------------------
admin_only = lambda user, instance, value: False  # noqa: E731


def only(*allowed):
    return lambda user, instance, value: value in allowed


def _farmer_signs_offtake(user, instance, value):
    return (
        instance is not None
        and instance.farmer_user_id == str(user.pk)
        and instance.status == "active"
        and instance.buyer_signed_at is not None
        and instance.farmer_signed_at is None
        and value is not None
    )


def _buyer_signs_offtake(user, instance, value):
    return (
        instance is not None
        and instance.buyer_user_id == str(user.pk)
        and instance.buyer_signed_at is None
        and value is not None
    )


def _loan_officer_signs_offtake(user, instance, value):
    return (
        is_active_loan_officer(user)
        and instance is not None
        and instance.status == "active"
        and instance.buyer_signed_at is not None
        and instance.farmer_signed_at is not None
        and instance.loan_officer_signed_at is None
        and value is not None
        and (not instance.loan_officer_user_id or instance.loan_officer_user_id == str(user.pk))
    )


def _loan_officer_sets_own_id(user, instance, value):
    return (
        is_active_loan_officer(user)
        and instance is not None
        and value == str(user.pk)
        and (not instance.loan_officer_user_id or instance.loan_officer_user_id == str(user.pk))
    )


def _buyer_accepts_guarantee(user, instance, value):
    return (
        instance is not None
        and instance.buyer_user_id == str(user.pk)
        and instance.buyer_signed_at is not None
        and instance.farmer_signed_at is not None
        and instance.loan_officer_signed_at is not None
        and instance.buyer_guarantee_accepted_at is None
        and value is not None
    )


def _buyer_activates_offtake_contract(user, instance, value):
    if instance is None:
        return value != "active"
    return str(instance.buyer_user_id) == str(user.pk)


def _farmer_signs_disclosed_agreement(user, instance, value):
    return (
        instance is not None
        and instance.farmer_user_id == str(user.pk)
        and value == "signed"
        and instance.status == "pending_signature"
    )


def _agreement_status_transition(user, instance, value):
    if value == "pending_signature":
        return is_active_loan_officer(user) and (
            instance is None or instance.status == "generated"
        )
    return _farmer_signs_disclosed_agreement(user, instance, value)


def _farmer_acknowledges_disclosure(user, instance, value):
    return (
        instance is not None
        and instance.farmer_user_id == str(user.pk)
        and instance.disclosure_acknowledged_at is None
        and value is not None
    )


_SUBMIT_KYC = {"kyc_status": only("pending")}
_PROFILE_REVIEW = {"status": admin_only, **_SUBMIT_KYC}

# field -> predicate(user, instance_or_None, new_value). Admins bypass every guard.
# On create a refused value is silently reset to the field default; on update it's a 403.
GUARDS = {
    "FarmerProfile": {"account_status": admin_only, "verification_status": admin_only, **_SUBMIT_KYC},
    "VendorProfile": _PROFILE_REVIEW,
    "BuyerProfile": _PROFILE_REVIEW,
    "FieldOfficerProfile": _PROFILE_REVIEW,
    "LoanOfficerProfile": _PROFILE_REVIEW,
    "PartnerProfile": _PROFILE_REVIEW,
    "KYCVerification": {"status": only("pending"), "verified_date": admin_only, "reviewed_by": admin_only,
                        "rejection_reason": admin_only},
    "FinancingRequest": {
        "status": lambda user, instance, value: policies_is_admin_or_loan_officer_status(user, value),
        "approved_amount": lambda user, instance, value: is_active_loan_officer(user),
        "stage1_approved_by": lambda user, instance, value: is_active_loan_officer(user),
        "stage1_approved_at": lambda user, instance, value: is_active_loan_officer(user),
        "stage1_notes": lambda user, instance, value: is_active_loan_officer(user),
        "approved_by": lambda user, instance, value: is_active_loan_officer(user),
        "approved_at": lambda user, instance, value: is_active_loan_officer(user),
        "rejection_reason": lambda user, instance, value: is_active_loan_officer(user),
        "field_visit_evidence": lambda user, instance, value: is_active_loan_officer(user),
        "agreed_percentage": lambda user, instance, value: is_active_loan_officer(user),
        "harvest_terms": lambda user, instance, value: is_active_loan_officer(user),
    },
    "Agreement": {
        "status": _agreement_status_transition,
        "disclosure_acknowledged_at": _farmer_acknowledges_disclosure,
    },
    "OfftakeContract": {
        "status": _buyer_activates_offtake_contract,
        "farmer_signed_at": _farmer_signs_offtake,
        "buyer_signed_at": _buyer_signs_offtake,
        "loan_officer_user_id": _loan_officer_sets_own_id,
        "loan_officer_signed_at": _loan_officer_signs_offtake,
        "buyer_guarantee_accepted_at": _buyer_accepts_guarantee,
        "buyer_guarantee_amount": lambda user, instance, value: False,
    },
    "Settlement": {"status": only("pending_review", "disputed"), "approval_date": admin_only, "payment_date": admin_only,
                   "payment_reference": admin_only, "loan_repayment_amount": admin_only, "farmer_balance": admin_only},
    "Voucher": {"status": only("active", "presented", "verified", "redeemed", "expired")},
    "LoanDisbursement": {"status": admin_only},
    "LoanLedgerEntry": {"entry_type": admin_only},
    "LoanSettings": {"is_active": admin_only},
    "FundingFacility": {"status": admin_only, "committed_amount": lambda user, instance, value: False},
    "LoanCase": {
        "status": lambda user, instance, value: is_workflow_staff(user),
        "decision_notes": lambda user, instance, value: is_workflow_staff(user),
        "decided_by": lambda user, instance, value: is_workflow_staff(user),
        "decided_at": lambda user, instance, value: is_workflow_staff(user),
    },
    "FraudAlert": {"status": lambda user, instance, value: is_workflow_staff(user)},
    "Complaint": {
        "status": lambda user, instance, value: is_workflow_staff(user),
        "assigned_to": lambda user, instance, value: is_workflow_staff(user),
        "resolution": lambda user, instance, value: is_workflow_staff(user),
        "resolved_at": lambda user, instance, value: is_workflow_staff(user),
    },
    "FarmVisit": {"status": lambda user, instance, value: user.user_type == "field_officer"},
}

# Non-admins may only modify these fields when updating (everything else is read-only for them).
UPDATE_ONLY = {
    "Agreement": {"status", "signed_at", "disclosure_acknowledged_at"},
    "Voucher": {"status"},
    "Message": {"read"},
    "Notification": {"read"},
    "FinancingRequest": {
        "status", "approved_amount", "stage1_approved_by", "stage1_approved_at", "stage1_notes",
        "approved_by", "approved_at", "rejection_reason", "field_visit_evidence", "agreed_percentage", "harvest_terms",
    },
    "OfftakeContract": {
        "status", "signed_at", "farmer_signed_at", "buyer_signed_at",
        "loan_officer_user_id", "loan_officer_signed_at", "buyer_guarantee_accepted_at", "buyer_guarantee_amount",
    },
    "FarmVisit": {
        "farmer_user_id", "officer_user_id", "financing_request_id", "harvest_id",
        "visit_date", "latitude", "longitude", "notes", "photos", "side_selling_flag", "status",
    },
    "Settlement": {"status"},
    "LoanCase": {
        "status", "amount", "evidence", "decision_notes", "decided_by", "decided_at",
    },
    "FraudAlert": {"status"},
    "Complaint": {"status", "assigned_to", "resolution", "resolved_at"},
}

# Fields hidden from users who are neither the owner nor an admin.
HIDDEN = {"BuyerProfile": {"id_number"}, "FarmerProfile": {"national_id"}}


def policies_is_admin_or_loan_officer_status(user, value):
    return is_admin(user) or (
        is_active_loan_officer(user)
        and value in {"under_review", "stage1_approved", "approved", "rejected", "returned"}
    )


def is_admin(user):
    return bool(user and user.is_authenticated and getattr(user, "role", None) == "admin")


def _q_for_rule(rule, user):
    if rule == ANY:
        return Q()
    if rule == ADMIN:
        return Q() if is_admin(user) else None
    if rule == OWNER:
        return Q(created_by_id=user.pk)
    if isinstance(rule, field):
        return Q(**{rule.name: str(user.pk)})
    if isinstance(rule, custom):
        return rule.fn(user)
    return None


def scope(model, user, action):
    """Queryset of the records `user` may perform `action` (read/update/delete) on."""
    combined, allow_all = None, False
    for rule in getattr(POLICIES[model.__name__], action):
        q = _q_for_rule(rule, user)
        if q is None:
            continue
        if not q:  # empty Q == unrestricted
            allow_all = True
            break
        combined = q if combined is None else combined | q
    if allow_all:
        return model.objects.all()
    if combined is None:
        return model.objects.none()
    return model.objects.filter(combined)


def can_create(model_name, user, data):
    for rule in POLICIES[model_name].create:
        if rule in (ANY, OWNER) or (rule == ADMIN and is_admin(user)):
            return True
        if rule is loan_officer and is_active_loan_officer(user):
            return True
        if isinstance(rule, field) and str(data.get(rule.name) or "") == str(user.pk):
            return True
    return False


def is_owner_or_admin(user, instance):
    return is_admin(user) or (instance.created_by_id is not None and instance.created_by_id == user.pk)
