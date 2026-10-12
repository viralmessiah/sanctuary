"""Domain models. They mirror the former Base44 entities one-to-one (same names, same field names) so the
React frontend keeps working unchanged. Cross-entity references (`*_user_id`, `*_id`) are stored as plain
strings exactly like the old API, which is what the frontend filters and compares on."""
import uuid

from django.conf import settings
from django.db import models


# --- tiny field helpers keep the model definitions readable -------------------------------------------
def S(max_length=255, default="", **kw):  # short string
    return models.CharField(max_length=max_length, blank=True, default=default, **kw)


def ID():  # reference to another record / user (string id)
    return models.CharField(max_length=64, blank=True, default="", db_index=True)


def URL():
    return models.CharField(max_length=1000, blank=True, default="")


def T():  # long text
    return models.TextField(blank=True, default="")


def N(default=None):  # plain number (quantities, percentages, rates)
    return models.FloatField(null=True, blank=True, default=default)


def M():  # money
    return models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)


def DT():
    return models.DateTimeField(null=True, blank=True)


def D():
    return models.DateField(null=True, blank=True)


def J(default=list):
    return models.JSONField(default=default, blank=True)


def B(default=False):
    return models.BooleanField(default=default)


def E(*choices, default=""):
    return models.CharField(max_length=32, blank=True, default=default, choices=[(c, c) for c in choices])


KYC_STATUS = ("not_started", "pending", "under_review", "verified", "rejected")
PROFILE_STATUS = ("pending_review", "active", "suspended")
CROP_GRADE = ("grade_a", "grade_b", "grade_c", "rejected")


class BaseEntity(models.Model):
    """Adds the bookkeeping fields every Base44 entity had: id, created_date, updated_date, created_by."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="+", editable=False)
    created_date = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_date = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["-created_date"]

    def __str__(self):
        return f"{self.__class__.__name__}({self.pk})"


# --- profiles ------------------------------------------------------------------------------------------
class FarmerProfile(BaseEntity):
    full_name = S()
    phone = S(64)
    national_id = S(64)
    region = S()
    farm_name = S()
    farm_location = S()
    acreage = N()
    crops = J()
    avg_yield_per_season = N()
    production_cycle = S()
    profile_image_url = URL()
    account_status = E("pending", "approved", "suspended", default="pending")
    verification_status = E("not_started", "assigned", "verified", "rejected", default="not_started")
    profile_status = E("profile_incomplete", "profile_complete", default="profile_incomplete")
    kyc_status = E(*KYC_STATUS, default="not_started")


class VendorProfile(BaseEntity):
    business_name = S()
    phone = S(64)
    email = S()
    address = S()
    store_location = S()
    categories = J()
    payout_details = T()
    profile_image_url = URL()
    id_number = S(64)
    kyc_status = E(*KYC_STATUS, default="not_started")
    status = E(*PROFILE_STATUS, default="pending_review")


class BuyerProfile(BaseEntity):
    business_name = S()
    phone = S(64)
    email = S()
    address = S()
    crops_bought = J()
    regions = J()
    total_qty_needed = N()
    min_qty_per_farmer = N()
    price_per_unit = M()
    profile_image_url = URL()
    id_number = S(64)
    kyc_status = E(*KYC_STATUS, default="not_started")
    status = E(*PROFILE_STATUS, default="pending_review")


class FieldOfficerProfile(BaseEntity):
    full_name = S()
    phone = S(64)
    email = S()
    region = S()
    profile_image_url = URL()
    id_number = S(64)
    kyc_status = E(*KYC_STATUS, default="not_started")
    status = E(*PROFILE_STATUS, default="pending_review")


class LoanOfficerProfile(BaseEntity):
    full_name = S()
    phone = S(64)
    email = S()
    status = E(*PROFILE_STATUS, default="pending_review")


class PartnerProfile(BaseEntity):
    organization_name = S()
    partner_type = E(
        "insurer", "credit_bureau", "agronomist", "warehouse_logistics", "cooperative",
        "mobile_money", "compliance", "collections", "support_desk",
    )
    phone = S(64)
    contact_email = S()
    status = E(*PROFILE_STATUS, default="pending_review")


class KYCVerification(BaseEntity):
    user_type = E("farmer", "vendor", "buyer", "field_officer")
    applicant_name = S()
    document_url = URL()  # may hold "private:<file id>" (see files.py)
    document_type = S(64)
    status = E("pending", "under_review", "verified", "rejected", "resubmission_required", default="pending")
    submitted_date = DT()
    verified_date = DT()
    rejection_reason = T()
    reviewed_by = S()


class FieldVerification(BaseEntity):
    farmer_user_id = ID()
    farmer_name = S()
    officer_user_id = ID()
    officer_name = S()
    status = E(
        "assigned", "in_progress", "pending_admin_review", "approved", "rejected",
        default="assigned",
    )
    assigned_date = DT()
    completed_date = DT()
    land_verification_notes = T()
    document_verification_notes = T()
    field_visit_photos = J()
    land_size_verified = N()
    crops_verified = J()
    rejection_reason = T()


# --- marketplace ---------------------------------------------------------------------------------------
class Category(BaseEntity):
    name = S()
    description = T()
    parent_category = S()
    status = E("active", "inactive", default="active")

    class Meta(BaseEntity.Meta):
        verbose_name_plural = "categories"


class Product(BaseEntity):
    vendor_user_id = ID()
    vendor_name = S()
    category_id = ID()
    category_name = S()
    name = S()
    sku = S(64)
    description = T()
    brand = S()
    unit = S(64)
    package_size = S(64)
    price = M()
    stock_quantity = N(default=0)
    min_order_qty = N(default=1)
    max_order_qty = N()
    image_url = URL()
    status = E("active", "out_of_stock", "inactive", default="active")


class Order(BaseEntity):
    farmer_name = S()
    vendor_user_id = ID()
    vendor_name = S()
    items = J()  # [{product_id, product_name, quantity, unit_price, total}]
    subtotal = M()
    total = M()
    status = E("submitted", "financing_pending", "financing_approved", "financing_rejected", "agreement_pending",
               "agreement_signed", "voucher_active", "fulfillment_pending", "fulfilled", "completed", "cancelled",
               default="submitted")
    financing_request_id = ID()


class VendorEmployee(BaseEntity):
    vendor_user_id = ID()
    vendor_name = S()
    employee_name = S()
    employee_email = S()
    employee_user_id = ID()
    role = E("assistant", "manager", default="assistant")
    status = E("invited", "active", "suspended", default="invited")


# --- financing, agreements, vouchers, settlements ------------------------------------------------------
class LoanProduct(BaseEntity):
    institution_name = S()
    interest_rate = N()
    advance_percentage = N()
    tenor_months = N()
    status = E("active", "inactive", default="active")


class FinancingRequest(BaseEntity):
    order_id = ID()
    offtake_contract_id = ID()
    farmer_name = S()
    requested_amount = M()
    approved_amount = M()
    expected_yield = N()
    contract_price = M()
    advance_percentage = N()
    credit_limit = M()
    interest_rate = N()
    tenor_months = N()
    loan_product_id = ID()
    status = E("requested", "under_review", "stage1_approved", "approved", "rejected", "returned", default="requested")
    stage1_approved_by = S()
    stage1_approved_at = DT()
    stage1_notes = T()
    field_visit_evidence = T()
    approved_by = S()
    approved_at = DT()
    rejection_reason = T()
    harvest_terms = T()
    agreed_percentage = N()
    total_cost = M()
    repayment_schedule = J()
    buyer_withholding_percentage = N()
    monthly_interest_rate = N()
    disclosure_acknowledged_at = DT()
    crop_failure_status = E("none", "reported", "verified", "resolved", default="none")
    buyer_default_status = E("none", "reported", "resolved", default="none")
    side_selling_status = E("none", "flagged", "confirmed", "cleared", default="none")
    restructuring_status = E("none", "proposed", "approved", "rejected", default="none")
    loss_status = E("none", "proposed_write_off", "written_off", default="none")


class Agreement(BaseEntity):
    agreement_number = S(64)
    farmer_user_id = ID()
    farmer_name = S()
    financing_request_id = ID()
    offtake_contract_id = ID()
    order_id = ID()
    financing_amount = M()
    harvest_terms = T()
    agreed_percentage = N()
    total_cost = M()
    repayment_schedule = J()
    monthly_interest_rate = N()
    buyer_withholding_percentage = N()
    disclosure_acknowledged_at = DT()
    content = T()
    status = E("generated", "pending_signature", "signed", "active", "completed", "terminated", default="generated")
    signed_at = DT()


class OfftakeContract(BaseEntity):
    contract_number = S(64)
    farmer_user_id = ID()
    farmer_name = S()
    buyer_user_id = ID()
    buyer_name = S()
    crop = S()
    quantity = N()
    unit = S(64)
    price_per_unit = M()
    total_value = M()
    delivery_schedule = D()
    delivery_location = S()
    initiated_by = E("farmer", "buyer")
    status = E("draft", "pending_signature", "active", "fulfilled", "closed", "terminated", default="draft")
    signed_at = DT()
    farmer_signed_at = DT()
    buyer_signed_at = DT()
    loan_officer_user_id = ID()
    loan_officer_signed_at = DT()
    buyer_guarantee_accepted_at = DT()
    buyer_guarantee_amount = M()
    content = T()


class Voucher(BaseEntity):
    voucher_code = S(64, db_index=True)
    order_id = ID()
    agreement_id = ID()
    farmer_user_id = ID()
    farmer_name = S()
    vendor_user_id = ID()
    vendor_name = S()
    total_value = M()
    issue_date = DT()
    expiry_date = DT()
    status = E("active", "presented", "verified", "redeemed", "settled", "expired", "cancelled", default="active")


class Redemption(BaseEntity):
    voucher_id = ID()
    voucher_code = S(64)
    farmer_user_id = ID()
    farmer_name = S()
    vendor_user_id = ID()
    redeemed_at = DT()
    verification_result = E("approved", "rejected")
    notes = T()


class Settlement(BaseEntity):
    vendor_user_id = ID()
    vendor_name = S()
    voucher_id = ID()
    harvest_id = ID()
    order_id = ID()
    offtake_contract_id = ID()
    buyer_user_id = ID()
    buyer_name = S()
    farmer_user_id = ID()
    farmer_name = S()
    amount = M()
    crop_grade = E(*CROP_GRADE)
    delivery_quantity = N()
    unit = S(64)
    price_per_unit = M()
    delivery_evidence_url = URL()
    delivery_date = DT()
    loan_repayment_amount = M()
    farmer_balance = M()
    gross_sale_amount = M()
    buyer_withholding_amount = M()
    buyer_remitted_amount = M()
    buyer_verified_received_amount = M()
    buyer_remittance_status = E(
        "due", "pending_verification", "partially_verified", "verified", default="due",
    )
    farmer_payment_due_amount = M()
    farmer_payment_reported_amount = M()
    farmer_payment_verified_amount = M()
    farmer_payment_status = E(
        "due", "pending_verification", "partially_verified", "verified", default="due",
    )
    buyer_exposure_amount = M()
    grading_notes = T()
    reconciliation_notes = T()
    status = E("pending_review", "approved", "paid", "disputed", default="pending_review")
    claim_date = DT()
    approval_date = DT()
    payment_date = DT()
    payment_reference = S()


class SettlementReconciliation(BaseEntity):
    settlement_id = ID()
    financing_request_id = ID()
    farmer_user_id = ID()
    buyer_user_id = ID()
    payment_type = E("buyer_withholding", "farmer_payment")
    amount = M()
    external_reference = S(128)
    evidence_url = URL()
    status = E("pending_verification", "verified", "rejected", default="pending_verification")
    verified_by_id = ID()
    verified_at = DT()
    reviewer_notes = T()


# --- harvest -------------------------------------------------------------------------------------------
class Harvest(BaseEntity):
    agreement_id = ID()
    offtake_contract_id = ID()
    crop = S()
    expected_quantity = N()
    actual_quantity = N()
    unit = S(64)
    expected_harvest_date = D()
    farming_start_date = D()
    crop_duration_days = models.PositiveIntegerField(null=True, blank=True)
    actual_harvest_date = D()
    valuation = M()
    agreed_share_amount = M()
    crop_stage = E("land_preparation", "planting", "growing", "flowering", "maturation", "harvest_ready", "harvested",
                   default="planting")
    yield_estimate = N()
    risk_alert = E("none", "no_update", "poor_crop", "pest_infestation", "weather_risk", default="none")
    last_update_date = DT()
    field_verification_photos = J()
    buyer_user_id = ID()
    buyer_name = S()
    crop_grade = E(*CROP_GRADE)
    delivery_quantity = N()
    delivery_date = D()
    settlement_status = E("planned", "growing", "field_verified", "harvest_ready", "harvest_recorded", "valued",
                          "delivered", "graded", "settled", "closed", default="planned")


# --- messaging & notifications -------------------------------------------------------------------------
class Conversation(BaseEntity):
    user1_id = ID()
    user1_name = S()
    user2_id = ID()
    user2_name = S()
    last_message = T()
    last_message_date = DT()
    last_sender_id = ID()


class Message(BaseEntity):
    conversation_id = ID()
    sender_id = ID()
    sender_name = S()
    sender_role = S(64)
    recipient_id = ID()
    content = T()
    read = B()


class Notification(BaseEntity):
    user_id = ID()
    title = S()
    message = T()
    type = E("order", "financing", "voucher", "settlement", "harvest", "kyc", "system")
    link = S(500)
    read = B()


class AuditLog(BaseEntity):
    actor_email = S()
    action = S()
    entity_type = S()
    entity_id = S(64)
    notes = T()


class LoanSettings(BaseEntity):
    monthly_interest_rate = N(default=3.5)
    buyer_withholding_percentage = N(default=20)
    advance_percentage = N(default=70)
    maximum_financing_amount = M()
    maximum_withholding_amount = M()
    default_tenor_months = models.PositiveSmallIntegerField(default=6)
    reserve_percentage = N(default=5)
    is_active = B(default=True)


class FundingFacility(BaseEntity):
    facility_name = S()
    provider_name = S()
    facility_limit = M()
    committed_amount = M()
    status = E("active", "suspended", "closed", default="active")


class LoanDisbursement(BaseEntity):
    financing_request_id = ID()
    facility_id = ID()
    tranche_number = models.PositiveSmallIntegerField(default=1)
    amount = M()
    status = E("pending_confirmation", "released", "failed", "reversed", default="pending_confirmation")
    released_at = DT()
    reference = S(128)
    notes = T()


class LoanLedgerEntry(BaseEntity):
    financing_request_id = ID()
    facility_id = ID()
    settlement_id = ID()
    entry_type = E(
        "disbursement", "interest_accrual", "repayment", "buyer_withholding",
        "restructure", "write_off", "adjustment",
    )
    amount = M()
    principal_delta = M()
    interest_delta = M()
    principal_balance = M()
    interest_balance = M()
    effective_date = DT()
    external_reference = S(128)
    notes = T()
    metadata = J()


class FarmVisit(BaseEntity):
    farmer_user_id = ID()
    harvest_id = ID()
    financing_request_id = ID()
    officer_user_id = ID()
    visit_date = DT()
    latitude = N()
    longitude = N()
    notes = T()
    photos = J()
    side_selling_flag = B()
    status = E("recorded", "reviewed", "disputed", default="recorded")


class LoanCase(BaseEntity):
    financing_request_id = ID()
    farmer_user_id = ID()
    buyer_user_id = ID()
    case_type = E(
        "crop_failure", "buyer_default", "side_selling", "delivery_dispute",
        "restructuring", "write_off",
    )
    status = E("open", "under_review", "approved", "rejected", "resolved", default="open")
    amount = M()
    evidence = J()
    decision_notes = T()
    decided_by = S()
    decided_at = DT()


class Complaint(BaseEntity):
    complainant_user_id = ID()
    related_user_id = ID()
    financing_request_id = ID()
    category = E("service", "harassment", "fraud", "dispute", "privacy", "other")
    message = T()
    status = E("open", "under_review", "resolved", "closed", default="open")
    assigned_to = S()
    resolution = T()
    resolved_at = DT()


class FraudAlert(BaseEntity):
    target_user_id = ID()
    financing_request_id = ID()
    alert_type = E("duplicate_identity", "duplicate_farm", "buyer_collusion", "suspicious_application")
    risk_score = models.PositiveSmallIntegerField(default=50)
    details = J()
    status = E("open", "under_review", "cleared", "confirmed", default="open")
    reviewed_by = S()
    reviewed_at = DT()


class ConsentRecord(BaseEntity):
    consenting_user_id = ID()
    consent_type = E(
        "credit_bureau", "insurance", "field_monitoring", "logistics",
        "cooperative", "mobile_money", "sms_notifications",
    )
    granted = B(default=True)
    text_version = S(64, default="v1")
    scope = J()
    expires_at = DT()


# --- file storage --------------------------------------------------------------------------------------
class StoredFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    path = models.CharField(max_length=500)  # relative to settings.UPLOAD_ROOT
    is_private = models.BooleanField(default=False)
    created_date = models.DateTimeField(auto_now_add=True)


ENTITY_MODELS = [
    Agreement, AuditLog, BuyerProfile, Category, Conversation, FarmerProfile, FieldOfficerProfile, FieldVerification,
    Complaint, ConsentRecord, FarmVisit, FinancingRequest, FraudAlert, FundingFacility, Harvest, KYCVerification, LoanCase, LoanDisbursement,
    LoanLedgerEntry, LoanOfficerProfile, LoanProduct, LoanSettings, Message, Notification, OfftakeContract, Order,
    PartnerProfile, Product, Redemption, Settlement, SettlementReconciliation, VendorEmployee, VendorProfile, Voucher,
]
ENTITIES = {m.__name__: m for m in ENTITY_MODELS}
