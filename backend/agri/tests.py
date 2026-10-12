import io
import re
from datetime import date

from django.core import mail
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuthToken, User
from agri import finance
from agri.models import SettlementReconciliation, StoredFile

PW = "S3cure-pass-word"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def make_user(email, user_type="", role="user", **extra):
    u = User.objects.create_user(email, PW, user_type=user_type, role=role, **extra)
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {AuthToken.issue(u)}")
    return u, c


class EntityApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin, self.admin_c = make_user("admin@example.com", role="admin")
        self.farmer, self.farmer_c = make_user("farmer@example.com", "farmer")
        self.farmer2, self.farmer2_c = make_user("farmer2@example.com", "farmer")
        self.vendor, self.vendor_c = make_user("vendor@example.com", "vendor")
        self.officer, self.officer_c = make_user("officer@example.com", "field_officer")
        self.buyer, self.buyer_c = make_user("buyer@example.com", "buyer")
        self.order = self.post(self.farmer_c, "Order", {
            "vendor_user_id": str(self.vendor.pk),
            "vendor_name": "Farm Supplies",
            "items": [{"product_id": "seed-1", "product_name": "Seed", "quantity": 1, "unit_price": 1000, "total": 1000}],
            "subtotal": 1000,
            "total": 1000,
        }).data

    def post(self, client, entity, data, **kw):
        return client.post(f"/api/entities/{entity}/", data, format="json", **kw)

    def query(self, client, entity, q=None, sort="-created_date", limit=100):
        res = client.post(f"/api/entities/{entity}/query/", {"q": q or {}, "sort": sort, "limit": limit}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def private_evidence(self, owner, name):
        stored = StoredFile.objects.create(
            owner=owner,
            original_name=name,
            content_type="application/pdf",
            size=1,
            path=f"private/{name}",
            is_private=True,
        )
        return f"private:{stored.pk}"

    def active_offtake_contract(self, farmer, farmer_client, **contract_fields):
        profile = self.post(self.buyer_c, "BuyerProfile", {"business_name": "Buyer"}).data
        self.admin_c.patch(f"/api/entities/BuyerProfile/{profile['id']}/", {"status": "active"}, format="json")
        contract_data = {
            "contract_number": f"OFC-{farmer.pk}",
            "farmer_user_id": str(farmer.pk),
            "buyer_user_id": str(self.buyer.pk),
            "crop": "maize",
            "quantity": 100,
            "price_per_unit": 10,
            "total_value": 1000,
            "status": "active",
        }
        contract_data.update(contract_fields)
        contract = self.post(farmer_client, "OfftakeContract", contract_data).data
        return self.buyer_c.patch(
            f"/api/entities/OfftakeContract/{contract['id']}/",
            {"status": "active"},
            format="json",
        ).data

    def fully_signed_offtake_contract(self, farmer, farmer_client, buyer, buyer_client, **contract_fields):
        contract = self.active_offtake_contract(farmer, farmer_client, **contract_fields)
        loan_officer, loan_officer_client = make_user(
            f"contract-lo-{farmer.pk}@example.com", "loan_officer"
        )
        profile = self.post(loan_officer_client, "LoanOfficerProfile", {
            "full_name": "Loan Officer",
        }).data
        self.admin_c.patch(
            f"/api/entities/LoanOfficerProfile/{profile['id']}/",
            {"status": "active"},
            format="json",
        )
        self.assertEqual(
            farmer_client.patch(
                f"/api/entities/OfftakeContract/{contract['id']}/",
                {"farmer_signed_at": "2026-10-08T07:00:00Z"},
                format="json",
            ).status_code,
            200,
        )
        self.assertEqual(
            loan_officer_client.patch(
                f"/api/entities/OfftakeContract/{contract['id']}/",
                {"loan_officer_signed_at": "2026-10-08T08:00:00Z"},
                format="json",
            ).status_code,
            200,
        )
        self.assertEqual(
            buyer_client.patch(
                f"/api/entities/OfftakeContract/{contract['id']}/",
                {"buyer_guarantee_accepted_at": "2026-10-08T09:00:00Z"},
                format="json",
            ).status_code,
            200,
        )
        return contract

    def confirm_payout(self, disbursement):
        return self.admin_c.patch(
            f"/api/entities/LoanDisbursement/{disbursement['id']}/",
            {"status": "released"},
            format="json",
        )

    # ---- auth & scoping -----------------------------------------------------------------------
    def test_requires_auth(self):
        self.assertEqual(APIClient().get("/api/entities/Product/").status_code, 401)

    def test_record_owner_scoping_and_admin_override(self):
        self.post(self.farmer_c, "FarmerProfile", {"full_name": "Alice"})
        self.post(self.farmer2_c, "FarmerProfile", {"full_name": "Bob"})
        self.assertEqual([p["full_name"] for p in self.query(self.farmer_c, "FarmerProfile")], ["Alice"])
        self.assertEqual(len(self.query(self.admin_c, "FarmerProfile")), 2)
        created = self.query(self.admin_c, "FarmerProfile", {"created_by_id": str(self.farmer.id)})
        self.assertEqual(created[0]["full_name"], "Alice")
        self.assertEqual(created[0]["created_by"], "farmer@example.com")
        self.assertEqual(created[0]["created_by_id"], str(self.farmer.id))

    def test_other_users_record_is_404_not_403_and_cannot_be_modified(self):
        rec = self.post(self.farmer_c, "FarmerProfile", {"full_name": "Alice"}).data
        self.assertEqual(self.farmer2_c.get(f"/api/entities/FarmerProfile/{rec['id']}/").status_code, 404)
        self.assertEqual(self.farmer2_c.patch(f"/api/entities/FarmerProfile/{rec['id']}/", {"full_name": "X"}, format="json").status_code, 404)
        self.assertEqual(self.farmer2_c.delete(f"/api/entities/FarmerProfile/{rec['id']}/").status_code, 404)

    def test_required_fields_and_unknown_entity(self):
        self.assertEqual(self.post(self.farmer_c, "FarmerProfile", {"phone": "1"}).status_code, 400)
        self.assertEqual(self.farmer_c.get("/api/entities/Nope/").status_code, 404)

    # ---- query language -----------------------------------------------------------------------
    def test_filter_operators_sort_limit(self):
        for n, price in (("a", 5), ("b", 10), ("c", 20)):
            self.post(self.vendor_c, "Product", {"name": n, "price": price, "vendor_user_id": str(self.vendor.id)})
        names = lambda q, **kw: [p["name"] for p in self.query(self.farmer_c, "Product", q, **kw)]  # noqa: E731
        self.assertEqual(names({"price": {"$gte": 10}}, sort="price"), ["b", "c"])
        self.assertEqual(names({"name": {"$in": ["a", "c"]}}, sort="-price"), ["c", "a"])
        self.assertEqual(names({"name": {"$ne": "a"}}, sort="name"), ["b", "c"])
        self.assertEqual(names({"$or": [{"name": "a"}, {"name": "b"}]}, sort="name"), ["a", "b"])
        self.assertEqual(names({}, sort="price", limit=2), ["a", "b"])
        self.assertEqual(self.post(self.vendor_c, "Product", {"name": "d", "price": 1.5, "vendor_user_id": str(self.vendor.id)}).data["price"], 1.5)

    def test_query_cannot_reach_through_relations_or_unknown_fields(self):
        for bad in ({"created_by__password": "x"}, {"created_by__email__startswith": "a"}, {"nope": 1}, {"items": 1},
                    {"name": {"$regex": ".*"}}):
            res = self.farmer_c.post("/api/entities/Order/query/", {"q": bad}, format="json")
            self.assertEqual(res.status_code, 400, bad)
        res = self.farmer_c.post("/api/entities/Order/query/", {"sort": "created_by__password"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_malformed_uuid_filter_returns_empty(self):
        self.assertEqual(self.query(self.farmer_c, "Order", {"id": "not-a-uuid"}), [])
        self.assertEqual(self.query(self.farmer_c, "Order", {"created_by_id": "zzz"}), [])

    def test_empty_strings_and_nulls_are_tolerated(self):
        res = self.post(self.farmer_c, "Harvest", {
            "crop": "maize",
            "farming_start_date": "2026-01-01",
            "crop_duration_days": 120,
            "expected_harvest_date": "2026-05-01",
            "expected_quantity": "",
            "unit": None,
        })
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["expected_harvest_date"], "2026-05-01")

    def test_crop_cycle_requires_start_duration_and_harvest_date(self):
        response = self.post(self.farmer_c, "Harvest", {"crop": "maize"})
        self.assertEqual(response.status_code, 400)
        complete = self.post(self.farmer_c, "Harvest", {
            "crop": "maize",
            "farming_start_date": "2026-06-01",
            "crop_duration_days": 90,
            "expected_harvest_date": "2026-08-30",
        })
        self.assertEqual(complete.status_code, 201, complete.data)

    def test_bad_enum_rejected(self):
        res = self.post(self.farmer_c, "Harvest", {"crop": "maize", "crop_stage": "nonsense"})
        self.assertEqual(res.status_code, 400)

    # ---- hardening guards ---------------------------------------------------------------------
    def test_farmer_cannot_self_approve(self):
        rec = self.post(self.farmer_c, "FarmerProfile", {"full_name": "A", "account_status": "approved", "verification_status": "verified"}).data
        self.assertEqual((rec["account_status"], rec["verification_status"]), ("pending", "not_started"))
        res = self.farmer_c.patch(f"/api/entities/FarmerProfile/{rec['id']}/", {"account_status": "approved"}, format="json")
        self.assertEqual(res.status_code, 403)
        ok = self.farmer_c.patch(f"/api/entities/FarmerProfile/{rec['id']}/", {"kyc_status": "pending", "full_name": "B"}, format="json")
        self.assertEqual(ok.status_code, 200)
        done = self.admin_c.patch(f"/api/entities/FarmerProfile/{rec['id']}/", {"account_status": "approved"}, format="json")
        self.assertEqual(done.data["account_status"], "approved")

    def test_vendor_cannot_self_activate(self):
        rec = self.post(self.vendor_c, "VendorProfile", {"business_name": "V", "status": "active"}).data
        self.assertEqual(rec["status"], "pending_review")

    def test_field_officer_verification_flow(self):
        fp = self.post(self.farmer_c, "FarmerProfile", {"full_name": "A"}).data
        self.assertEqual(self.query(self.officer_c, "FarmerProfile"), [])  # not assigned yet
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/FarmerProfile/{fp['id']}/",
            {"verification_status": "verified"},
            format="json",
        ).status_code, 400)
        self.assertEqual(self.post(self.officer_c, "FieldVerification", {"farmer_user_id": str(self.farmer.id), "officer_user_id": str(self.officer.id)}).status_code, 403)
        fv = self.post(self.admin_c, "FieldVerification", {"farmer_user_id": str(self.farmer.id), "officer_user_id": str(self.officer.id)}).data
        self.assertEqual(fv["status"], "assigned")
        self.assertEqual(len(self.query(self.officer_c, "FieldVerification")), 1)
        self.assertEqual(len(self.query(self.officer_c, "FarmerProfile", {"created_by_id": str(self.farmer.id)})), 1)
        incomplete = self.officer_c.patch(
            f"/api/entities/FieldVerification/{fv['id']}/",
            {"status": "pending_admin_review"},
            format="json",
        )
        self.assertEqual(incomplete.status_code, 400)
        report = {
            "land_verification_notes": "Farm boundary observed.",
            "document_verification_notes": "Farmer ID and land records inspected.",
            "land_size_verified": 4,
            "crops_verified": ["maize"],
            "field_visit_photos": [self.private_evidence(self.officer, "verified-farm.jpg")],
            "completed_date": "2026-10-10T09:00:00Z",
            "status": "pending_admin_review",
        }
        without_photo = {key: value for key, value in report.items() if key != "field_visit_photos"}
        self.assertEqual(
            self.officer_c.patch(
                f"/api/entities/FieldVerification/{fv['id']}/",
                without_photo,
                format="json",
            ).status_code,
            400,
        )
        public_only_report = {**without_photo, "field_visit_photos": ["https://example.test/public-farm.jpg"]}
        self.assertEqual(
            self.officer_c.patch(
                f"/api/entities/FieldVerification/{fv['id']}/",
                public_only_report,
                format="json",
            ).status_code,
            400,
        )
        submitted = self.officer_c.patch(
            f"/api/entities/FieldVerification/{fv['id']}/",
            report,
            format="json",
        )
        self.assertEqual(submitted.status_code, 200, submitted.data)
        self.assertEqual(submitted.data["status"], "pending_admin_review")
        self.assertEqual(
            self.query(self.farmer_c, "FarmerProfile", {"id": fp["id"]})[0]["verification_status"],
            "not_started",
        )
        self.assertEqual(self.officer_c.patch(
            f"/api/entities/FieldVerification/{fv['id']}/",
            {"status": "approved"},
            format="json",
        ).status_code, 403)
        self.assertEqual(self.officer_c.patch(
            f"/api/entities/FieldVerification/{fv['id']}/",
            {"land_size_verified": 5},
            format="json",
        ).status_code, 403)
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/FieldVerification/{fv['id']}/",
            {"status": "approved"},
            format="json",
        ).status_code, 200)
        archived = self.query(self.admin_c, "FieldVerification", {"id": fv["id"]})[0]
        self.assertEqual(archived["status"], "approved")
        self.assertEqual(archived["land_verification_notes"], "Farm boundary observed.")
        self.assertEqual(len(archived["field_visit_photos"]), 1)
        self.assertIn("/api/files/private/", archived["field_visit_photos"][0])
        self.assertEqual(self.officer_c.patch(
            f"/api/entities/FieldVerification/{fv['id']}/",
            {"land_verification_notes": "Changed after admin decision."},
            format="json",
        ).status_code, 403)
        self.assertEqual(
            self.query(self.farmer_c, "FarmerProfile", {"id": fp["id"]})[0]["verification_status"],
            "verified",
        )
        # An assigned officer still can't approve the farmer account itself.
        self.assertEqual(self.officer_c.patch(f"/api/entities/FarmerProfile/{fp['id']}/", {"account_status": "approved"}, format="json").status_code, 403)
        # the farmer can't verify themselves
        self.assertEqual(self.farmer_c.patch(f"/api/entities/FarmerProfile/{fp['id']}/", {"verification_status": "rejected"}, format="json").status_code, 403)

    def test_buyer_listing_visible_to_farmers_without_id_number(self):
        self.post(self.buyer_c, "BuyerProfile", {"business_name": "Co", "id_number": "999"})
        self.assertEqual(self.query(self.farmer_c, "BuyerProfile", {"status": "active"}), [])
        bp = self.query(self.buyer_c, "BuyerProfile")[0]
        self.admin_c.patch(f"/api/entities/BuyerProfile/{bp['id']}/", {"status": "active"}, format="json")
        seen = self.query(self.farmer_c, "BuyerProfile", {"status": "active"})
        self.assertEqual(len(seen), 1)
        self.assertNotIn("id_number", seen[0])
        self.assertEqual(self.query(self.buyer_c, "BuyerProfile")[0]["id_number"], "999")

    def test_admin_can_list_registered_buyers_and_officers(self):
        self.post(self.buyer_c, "BuyerProfile", {
            "business_name": "Harvest Buyers Ltd",
            "email": self.buyer.email,
        })
        field_officer, field_officer_c = make_user("registered-field@example.com", "field_officer")
        self.post(field_officer_c, "FieldOfficerProfile", {
            "full_name": "Registered Field Officer",
            "email": field_officer.email,
        })
        loan_officer, loan_officer_c = make_user("registered-loan@example.com", "loan_officer")
        self.post(loan_officer_c, "LoanOfficerProfile", {
            "full_name": "Registered Loan Officer",
            "email": loan_officer.email,
        })

        self.assertEqual(
            self.query(self.admin_c, "BuyerProfile")[0]["business_name"],
            "Harvest Buyers Ltd",
        )
        self.assertEqual(
            self.query(self.admin_c, "FieldOfficerProfile")[0]["full_name"],
            "Registered Field Officer",
        )
        self.assertEqual(
            self.query(self.admin_c, "LoanOfficerProfile")[0]["full_name"],
            "Registered Loan Officer",
        )

    def test_field_officer_kyc_submission_uses_its_correct_role(self):
        field_officer, field_officer_c = make_user("field-kyc@example.com", "field_officer")
        self.post(field_officer_c, "FieldOfficerProfile", {
            "full_name": "Field KYC Applicant",
            "email": field_officer.email,
        })
        response = self.post(field_officer_c, "KYCVerification", {
            "user_type": "field_officer",
            "applicant_name": "Field KYC Applicant",
            "document_url": "https://example.com/id-document",
            "document_type": "national_id",
            "status": "pending",
        })
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["user_type"], "field_officer")
        self.assertEqual(
            self.query(self.admin_c, "KYCVerification", {"created_by_id": str(field_officer.pk)})[0]["user_type"],
            "field_officer",
        )

    def test_financing_request_cannot_be_self_approved(self):
        contract = self.active_offtake_contract(self.farmer, self.farmer_c)
        fr = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"], "offtake_contract_id": contract["id"],
            "requested_amount": 100, "status": "approved", "approved_amount": 100,
        }).data
        self.assertEqual((fr["status"], fr["approved_amount"]), ("requested", None))
        self.assertEqual(self.farmer_c.patch(f"/api/entities/FinancingRequest/{fr['id']}/", {"status": "approved"}, format="json").status_code, 403)

    def test_financing_requires_active_buyer_contract_for_the_farmer(self):
        missing = self.post(self.farmer_c, "FinancingRequest", {"order_id": self.order["id"], "requested_amount": 100})
        self.assertEqual(missing.status_code, 400)
        nonexistent_order = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": "not-an-order", "offtake_contract_id": "not-a-contract", "requested_amount": 100,
        })
        self.assertEqual(nonexistent_order.status_code, 400)
        other_farmer_order = self.post(self.farmer2_c, "FinancingRequest", {
            "order_id": self.order["id"], "offtake_contract_id": "not-a-contract", "requested_amount": 100,
        })
        self.assertEqual(other_farmer_order.status_code, 403)

        pending = self.post(self.farmer_c, "OfftakeContract", {
            "contract_number": "OFC-PENDING",
            "farmer_user_id": str(self.farmer.pk),
            "buyer_user_id": str(self.buyer.pk),
            "crop": "maize",
            "status": "active",
        }).data
        self.assertEqual(pending["status"], "draft")
        self.assertEqual(
            self.farmer_c.patch(
                f"/api/entities/OfftakeContract/{pending['id']}/",
                {"status": "active"},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.admin_c.patch(
                f"/api/entities/OfftakeContract/{pending['id']}/",
                {"status": "active"},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.post(self.farmer_c, "FinancingRequest", {
                "order_id": self.order["id"], "offtake_contract_id": pending["id"], "requested_amount": 100,
            }).status_code,
            400,
        )

        active_contract = self.active_offtake_contract(self.farmer, self.farmer_c)
        allowed = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"], "offtake_contract_id": active_contract["id"], "requested_amount": 100,
        })
        self.assertEqual(allowed.status_code, 201, allowed.data)
        self.buyer_c.patch(
            f"/api/entities/OfftakeContract/{active_contract['id']}/",
            {"status": "terminated"},
            format="json",
        )
        self.assertEqual(
            self.admin_c.patch(
                f"/api/entities/FinancingRequest/{allowed.data['id']}/",
                {"status": "approved", "approved_amount": 100},
                format="json",
            ).status_code,
            400,
        )

        other_farmer_contract = self.active_offtake_contract(self.farmer2, self.farmer2_c)
        mismatched = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"], "offtake_contract_id": other_farmer_contract["id"], "requested_amount": 100,
        })
        self.assertEqual(mismatched.status_code, 400)

    def test_financing_limit_uses_configured_advance_rate_and_amount_cap(self):
        settings = self.query(self.admin_c, "LoanSettings")[0]
        contract = self.active_offtake_contract(self.farmer, self.farmer_c)
        zero_request = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 0,
        })
        self.assertEqual(zero_request.status_code, 400, zero_request.data)
        pending_at_old_limit = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 500,
        })
        self.assertEqual(pending_at_old_limit.status_code, 201, pending_at_old_limit.data)
        self.assertEqual(float(pending_at_old_limit.data["credit_limit"]), 700)

        update = self.admin_c.patch(
            f"/api/entities/LoanSettings/{settings['id']}/",
            {"advance_percentage": 50, "maximum_financing_amount": 400},
            format="json",
        )
        self.assertEqual(update.status_code, 200, update.data)
        invalid_advance = self.admin_c.patch(
            f"/api/entities/LoanSettings/{settings['id']}/",
            {"advance_percentage": 100.01},
            format="json",
        )
        self.assertEqual(invalid_advance.status_code, 400, invalid_advance.data)

        approved_over_new_limit = self.admin_c.patch(
            f"/api/entities/FinancingRequest/{pending_at_old_limit.data['id']}/",
            {"status": "approved", "approved_amount": 500},
            format="json",
        )
        self.assertEqual(approved_over_new_limit.status_code, 400, approved_over_new_limit.data)
        approved_at_new_limit = self.admin_c.patch(
            f"/api/entities/FinancingRequest/{pending_at_old_limit.data['id']}/",
            {"status": "approved", "approved_amount": 400},
            format="json",
        )
        self.assertEqual(approved_at_new_limit.status_code, 200, approved_at_new_limit.data)
        self.assertEqual(float(approved_at_new_limit.data["credit_limit"]), 400)
        self.assertEqual(approved_at_new_limit.data["advance_percentage"], 50)

        over_limit = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 401,
        })
        self.assertEqual(over_limit.status_code, 400, over_limit.data)

        accepted = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 400,
        })
        self.assertEqual(accepted.status_code, 201, accepted.data)
        self.assertEqual(float(accepted.data["credit_limit"]), 400)
        approved_over_limit = self.admin_c.patch(
            f"/api/entities/FinancingRequest/{accepted.data['id']}/",
            {"status": "approved", "approved_amount": 401},
            format="json",
        )
        self.assertEqual(approved_over_limit.status_code, 400, approved_over_limit.data)

    def test_buyer_guarantee_uses_calculated_contract_value_when_total_is_missing(self):
        contract = self.fully_signed_offtake_contract(
            self.farmer, self.farmer_c, self.buyer, self.buyer_c,
            quantity=50, price_per_unit=10, total_value=None,
        )
        from agri.models import OfftakeContract

        stored = OfftakeContract.objects.get(pk=contract["id"])
        self.assertEqual(stored.total_value, finance.money(500))
        self.assertEqual(stored.buyer_guarantee_amount, finance.money(100))
        self.assertTrue(finance.contract_release_ready(stored))

    def _approved_loan_with_signed_disclosures(self):
        contract = self.fully_signed_offtake_contract(
            self.farmer, self.farmer_c, self.buyer, self.buyer_c,
            quantity=50, price_per_unit=10, total_value=500,
        )
        loan_officer, loan_officer_c = make_user("funding-lo@example.com", "loan_officer")
        profile = self.post(loan_officer_c, "LoanOfficerProfile", {"full_name": "Funding Officer"}).data
        self.admin_c.patch(f"/api/entities/LoanOfficerProfile/{profile['id']}/", {"status": "active"}, format="json")
        request = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 100,
            "farmer_name": "Alice Farmer",
        }).data
        self.assertEqual(
            loan_officer_c.patch(
                f"/api/entities/FinancingRequest/{request['id']}/",
                {"status": "stage1_approved"},
                format="json",
            ).status_code,
            200,
        )
        approved = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{request['id']}/",
            {"status": "approved", "approved_amount": 100},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        agreement = self.post(loan_officer_c, "Agreement", {
            "agreement_number": "FUNDING-A1",
            "farmer_user_id": str(self.farmer.pk),
            "financing_request_id": request["id"],
            "offtake_contract_id": contract["id"],
            "order_id": self.order["id"],
            "status": "pending_signature",
        })
        self.assertEqual(agreement.status_code, 201, agreement.data)
        signed = self.farmer_c.patch(
            f"/api/entities/Agreement/{agreement.data['id']}/",
            {"status": "signed", "disclosure_acknowledged_at": "2026-10-08T09:00:00Z"},
            format="json",
        )
        self.assertEqual(signed.status_code, 200, signed.data)
        return request, contract

    def test_tranche_release_requires_all_gates_and_respects_facility_limit(self):
        request, _contract = self._approved_loan_with_signed_disclosures()
        facility = self.post(self.admin_c, "FundingFacility", {
            "facility_name": "Seasonal facility", "provider_name": "Fund",
            "facility_limit": 75, "committed_amount": 0, "status": "active",
        }).data
        blocked = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 100,
            "reference": "TOO-LARGE",
        })
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("amount", blocked.data["errors"])
        released = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 50,
            "reference": "TRANCHE-1",
        })
        self.assertEqual(released.status_code, 201, released.data)
        self.assertEqual(released.data["tranche_number"], 1)
        self.assertEqual(released.data["status"], "pending_confirmation")
        self.assertEqual(self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        }), [])
        confirmed = self.confirm_payout(released.data)
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.assertEqual(confirmed.data["status"], "released")
        facility_after_release = self.query(
            self.admin_c, "FundingFacility", {"id": facility["id"]}
        )[0]
        self.assertEqual(facility_after_release["committed_amount"], 50)
        ledger = self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        })
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["entry_type"], "disbursement")
        self.assertEqual(ledger[0]["principal_balance"], 50)
        self.assertEqual(self.confirm_payout(released.data).status_code, 200)
        self.assertEqual(len(self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        })), 1)
        self.assertEqual(self.admin_c.delete(
            f"/api/entities/LoanLedgerEntry/{ledger[0]['id']}/"
        ).status_code, 403)
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/LoanLedgerEntry/{ledger[0]['id']}/",
            {"notes": "tamper"},
            format="json",
        ).status_code, 403)
        self.assertEqual(self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 10,
            "reference": "TRANCHE-1",
        }).status_code, 400)
        pending = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 20,
            "reference": "TRANCHE-2",
        })
        self.assertEqual(pending.status_code, 201, pending.data)
        failed = self.admin_c.patch(
            f"/api/entities/LoanDisbursement/{pending.data['id']}/",
            {"status": "failed", "notes": "Provider rejected transfer."},
            format="json",
        )
        self.assertEqual(failed.status_code, 200, failed.data)
        self.assertEqual(failed.data["status"], "failed")
        self.assertEqual(len(self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        })), 1)
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/LoanDisbursement/{pending.data['id']}/",
            {"status": "released"},
            format="json",
        ).status_code, 403)
        self.assertEqual(self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 30,
            "reference": "TOO-MUCH",
        }).status_code, 400)

    def test_interest_schedule_is_reducing_simple_and_accrual_is_idempotent(self):
        terms = finance.repayment_terms(120, 3.5, 3, start_date=date(2026, 1, 1))
        self.assertEqual(terms["interest_total"], finance.money("8.40"))
        self.assertEqual(terms["total_cost"], finance.money("128.40"))
        self.assertEqual(
            [row["interest"] for row in terms["schedule"]],
            ["4.20", "2.80", "1.40"],
        )
        request, _contract = self._approved_loan_with_signed_disclosures()
        facility = self.post(self.admin_c, "FundingFacility", {
            "facility_name": "Interest facility", "provider_name": "Fund",
            "facility_limit": 100, "committed_amount": 0, "status": "active",
        }).data
        payout = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 50,
            "reference": "INTEREST-1",
        })
        self.assertEqual(payout.status_code, 201, payout.data)
        self.assertEqual(self.confirm_payout(payout.data).status_code, 200)
        from agri.models import FinancingRequest

        financing = FinancingRequest.objects.get(pk=request["id"])
        through = finance.add_months(date.today(), 2)
        created = finance.accrue_monthly_interest(financing, through)
        self.assertEqual(len(created), 2)
        self.assertEqual(finance.loan_balances(financing.pk), (finance.money(50), finance.money("3.50")))
        self.assertEqual(finance.accrue_monthly_interest(financing, through), [])

    def test_interest_portfolio_accrues_monthly_and_scopes_farmer_report(self):
        from datetime import datetime, time

        from django.utils import timezone

        from agri.models import LoanDisbursement

        profile = self.post(self.farmer_c, "FarmerProfile", {"full_name": "Alice Farmer"}).data
        request, _contract = self._approved_loan_with_signed_disclosures()
        facility = self.post(self.admin_c, "FundingFacility", {
            "facility_name": "Interest portfolio facility", "provider_name": "Fund",
            "facility_limit": 100, "committed_amount": 0, "status": "active",
        }).data
        payout = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 50,
            "reference": "PORTFOLIO-INTEREST",
        })
        self.assertEqual(payout.status_code, 201, payout.data)
        self.assertEqual(self.confirm_payout(payout.data).status_code, 200)
        release_date = finance.add_months(date.today(), -2)
        release_timestamp = timezone.make_aware(datetime.combine(release_date, time.min))
        LoanDisbursement.objects.filter(pk=payout.data["id"]).update(
            released_at=release_timestamp
        )
        from agri.models import LoanLedgerEntry

        LoanLedgerEntry.objects.filter(
            financing_request_id=request["id"], entry_type="disbursement",
        ).update(effective_date=release_timestamp)

        first = self.admin_c.post("/api/finance/interest-portfolio/", {}, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["summary"]["individuals"], 1)
        self.assertEqual(first.data["summary"]["principal_balance"], "50.00")
        self.assertEqual(first.data["summary"]["interest_balance"], "3.50")
        self.assertEqual(first.data["individuals"][0]["farmer_name"], "Alice Farmer")
        self.assertEqual(first.data["loans"][0]["monthly_history"][-1]["amount"], "1.75")

        repeated = self.admin_c.post("/api/finance/interest-portfolio/", {}, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(repeated.data["summary"]["interest_balance"], "3.50")
        farmer_report = self.farmer_c.get("/api/finance/interest-portfolio/")
        self.assertEqual(farmer_report.status_code, 200, farmer_report.data)
        self.assertEqual(farmer_report.data["summary"]["total_owed"], "53.50")
        self.assertEqual(
            self.farmer2_c.get("/api/finance/interest-portfolio/").data["loans"],
            [],
        )
        self.assertEqual(self.vendor_c.get("/api/finance/interest-portfolio/").status_code, 403)
        self.assertEqual(profile["full_name"], first.data["individuals"][0]["farmer_name"])

    @override_settings(USSD_GATEWAY_TOKEN="gateway-secret")
    def test_ussd_callback_requires_gateway_auth_and_routes_complaint_away_from_loan_officer(self):
        self.post(self.farmer_c, "FarmerProfile", {
            "full_name": "Alice", "phone": "+254 700 111 222",
        })
        gateway = APIClient()
        endpoint = "/api/integrations/ussd/"
        invalid = gateway.post(endpoint, {"phone_number": "254700111222", "text": ""}, format="json")
        self.assertEqual(invalid.status_code, 403)
        headers = {"HTTP_X_USSD_GATEWAY_TOKEN": "gateway-secret"}
        menu = gateway.post(endpoint, {"phone_number": "254700111222", "text": ""}, format="json", **headers)
        self.assertEqual(menu.status_code, 200)
        self.assertIn("1. My loan balance", menu.content.decode())
        complaint = gateway.post(
            endpoint,
            {"phone_number": "254700111222", "text": "2*My payment was not received"},
            format="json",
            **headers,
        )
        self.assertIn("independent support", complaint.content.decode())
        self.assertEqual(len(self.query(self.admin_c, "Complaint")), 1)
        loan_officer, loan_officer_c = make_user("complaints-lo@example.com", "loan_officer")
        profile = self.post(loan_officer_c, "LoanOfficerProfile", {"full_name": "LO"}).data
        self.admin_c.patch(f"/api/entities/LoanOfficerProfile/{profile['id']}/", {"status": "active"}, format="json")
        self.assertEqual(self.query(loan_officer_c, "Complaint"), [])
        support, support_c = make_user("support@example.com", "support_desk")
        partner = self.post(support_c, "PartnerProfile", {"partner_type": "support_desk"}).data
        self.admin_c.patch(f"/api/entities/PartnerProfile/{partner['id']}/", {"status": "active"}, format="json")
        self.assertEqual(len(self.query(support_c, "Complaint")), 1)

    def test_buyer_delivery_withholding_is_reconciled_once_to_loan_ledger(self):
        request, contract = self._approved_loan_with_signed_disclosures()
        facility = self.post(self.admin_c, "FundingFacility", {
            "facility_name": "Recovery facility", "provider_name": "Fund",
            "facility_limit": 100, "committed_amount": 0, "status": "active",
        }).data
        payout = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"], "facility_id": facility["id"], "amount": 50,
            "reference": "RECOVERY-1",
        })
        self.assertEqual(payout.status_code, 201, payout.data)
        self.assertEqual(self.confirm_payout(payout.data).status_code, 200)
        harvest = self.post(self.farmer_c, "Harvest", {
            "crop": "maize", "offtake_contract_id": contract["id"], "buyer_user_id": str(self.buyer.id),
            "expected_quantity": 50, "actual_quantity": 50, "unit": "kg", "expected_harvest_date": "2026-10-30",
            "farming_start_date": "2026-06-01", "crop_duration_days": 150,
            "settlement_status": "harvest_ready",
        })
        self.assertEqual(harvest.status_code, 201, harvest.data)
        delivery = self.post(self.buyer_c, "Settlement", {
            "harvest_id": harvest.data["id"], "offtake_contract_id": contract["id"],
            "delivery_quantity": 5, "crop_grade": "grade_a", "delivery_date": "2026-10-30",
            "delivery_evidence_url": self.private_evidence(self.buyer, "weigh-ticket.pdf"),
        })
        self.assertEqual(delivery.status_code, 201, delivery.data)
        self.assertEqual(delivery.data["gross_sale_amount"], 50)
        self.assertEqual(delivery.data["buyer_withholding_amount"], 10)
        self.assertEqual(delivery.data["price_per_unit"], 10)
        self.assertEqual(delivery.data["farmer_payment_due_amount"], 40)
        self.assertEqual(self.query(self.farmer_c, "Harvest", {"id": harvest.data["id"]})[0]["settlement_status"], "delivered")
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/Settlement/{delivery.data['id']}/",
            {"status": "approved"},
            format="json",
        ).status_code, 200)
        first_claim = self.post(self.buyer_c, "SettlementReconciliation", {
            "settlement_id": delivery.data["id"], "payment_type": "buyer_withholding",
            "amount": 5, "external_reference": "BUYER-PMT-1",
            "evidence_url": self.private_evidence(self.buyer, "buyer-payment-1.pdf"),
        })
        self.assertEqual(first_claim.status_code, 201, first_claim.data)
        claim_record = SettlementReconciliation.objects.get(pk=first_claim.data["id"])
        claim_record.created_by = self.admin
        claim_record.save(update_fields=["created_by"])
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/SettlementReconciliation/{first_claim.data['id']}/",
            {"status": "verified"},
            format="json",
        ).status_code, 403)
        claim_record.created_by = self.buyer
        claim_record.save(update_fields=["created_by"])
        pending = self.query(self.farmer_c, "Settlement", {"id": delivery.data["id"]})[0]
        self.assertEqual(pending["buyer_remitted_amount"], 5)
        self.assertEqual(pending["buyer_verified_received_amount"], 0)
        self.assertEqual(self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        })[-1]["principal_balance"], 50)
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/Settlement/{delivery.data['id']}/",
            {"status": "paid"},
            format="json",
        ).status_code, 400)
        verified_first = self.admin_c.patch(
            f"/api/entities/SettlementReconciliation/{first_claim.data['id']}/",
            {"status": "verified"},
            format="json",
        )
        self.assertEqual(verified_first.status_code, 200, verified_first.data)
        partial = self.query(self.farmer_c, "Settlement", {"id": delivery.data["id"]})[0]
        self.assertEqual(partial["buyer_verified_received_amount"], 5)
        self.assertEqual(partial["buyer_exposure_amount"], 5)

        second_claim = self.post(self.buyer_c, "SettlementReconciliation", {
            "settlement_id": delivery.data["id"], "payment_type": "buyer_withholding",
            "amount": 5, "external_reference": "BUYER-PMT-2",
            "evidence_url": self.private_evidence(self.buyer, "buyer-payment-2.pdf"),
        })
        self.assertEqual(second_claim.status_code, 201, second_claim.data)
        verified_second = self.admin_c.patch(
            f"/api/entities/SettlementReconciliation/{second_claim.data['id']}/",
            {"status": "verified"},
            format="json",
        )
        self.assertEqual(verified_second.status_code, 200, verified_second.data)
        loan_entries = self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        }, sort="created_date")
        self.assertEqual(loan_entries[-1]["entry_type"], "buyer_withholding")
        self.assertEqual(loan_entries[-1]["principal_balance"], 40)
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/SettlementReconciliation/{first_claim.data['id']}/",
            {"status": "verified"},
            format="json",
        ).status_code, 400)
        self.assertEqual(len(self.query(self.farmer_c, "LoanLedgerEntry", {
            "financing_request_id": request["id"],
        })), 3)

        farmer_payment = self.post(self.buyer_c, "SettlementReconciliation", {
            "settlement_id": delivery.data["id"], "payment_type": "farmer_payment",
            "amount": 40, "external_reference": "FARMER-PMT-1",
            "evidence_url": self.private_evidence(self.buyer, "farmer-payment.pdf"),
        })
        self.assertEqual(farmer_payment.status_code, 201, farmer_payment.data)
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/SettlementReconciliation/{farmer_payment.data['id']}/",
            {"status": "verified"},
            format="json",
        ).status_code, 200)
        complete = self.query(self.farmer_c, "Settlement", {"id": delivery.data["id"]})[0]
        self.assertEqual(complete["farmer_payment_verified_amount"], 40)
        self.assertEqual(complete["status"], "paid")
        self.assertEqual(self.query(self.farmer_c, "Harvest", {"id": harvest.data["id"]})[0]["settlement_status"], "settled")
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/Harvest/{harvest.data['id']}/",
            {"settlement_status": "settled"},
            format="json",
        ).status_code, 400)

    def test_assigned_field_officer_visit_requires_gps_photo_and_flags_side_selling(self):
        contract = self.active_offtake_contract(self.farmer, self.farmer_c)
        financing = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 100,
        }).data
        field_officer, officer_c = make_user("visit-officer@example.com", "field_officer")
        profile = self.post(officer_c, "FieldOfficerProfile", {"full_name": "Visit Officer"}).data
        self.admin_c.patch(
            f"/api/entities/FieldOfficerProfile/{profile['id']}/",
            {"status": "active"},
            format="json",
        )
        assignment = self.post(self.admin_c, "FieldVerification", {
            "farmer_user_id": str(self.farmer.pk),
            "officer_user_id": str(field_officer.pk),
        })
        self.assertEqual(assignment.status_code, 201, assignment.data)

        visit_data = {
            "farmer_user_id": str(self.farmer.pk),
            "officer_user_id": str(field_officer.pk),
            "financing_request_id": financing["id"],
            "visit_date": "2026-10-08T12:00:00Z",
            "latitude": -1.2864,
            "longitude": 36.8172,
            "photos": ["https://example.test/farm-visit.jpg"],
            "side_selling_flag": True,
        }
        missing_photo = officer_c.post(
            "/api/entities/FarmVisit/",
            {**visit_data, "photos": []},
            format="json",
        )
        self.assertEqual(missing_photo.status_code, 400)
        invalid_gps = officer_c.post(
            "/api/entities/FarmVisit/",
            {**visit_data, "latitude": 95},
            format="json",
        )
        self.assertEqual(invalid_gps.status_code, 400)
        recorded = officer_c.post("/api/entities/FarmVisit/", visit_data, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.data)
        cases = self.query(self.admin_c, "LoanCase", {
            "financing_request_id": financing["id"],
            "case_type": "side_selling",
        })
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["evidence"]["farm_visit_id"], recorded.data["id"])

    def test_restructuring_and_writeoff_cases_update_terms_and_ledger(self):
        request, _contract = self._approved_loan_with_signed_disclosures()
        facility = self.post(self.admin_c, "FundingFacility", {
            "facility_name": "Case facility", "provider_name": "Fund",
            "facility_limit": 100, "committed_amount": 0, "status": "active",
        }).data
        released = self.post(self.admin_c, "LoanDisbursement", {
            "financing_request_id": request["id"],
            "facility_id": facility["id"],
            "amount": 50,
            "reference": "CASE-1",
        })
        self.assertEqual(released.status_code, 201, released.data)
        self.assertEqual(self.confirm_payout(released.data).status_code, 200)

        restructuring = self.post(self.farmer_c, "LoanCase", {
            "financing_request_id": request["id"],
            "case_type": "restructuring",
            "evidence": {
                "total_cost": 60,
                "repayment_schedule": [{"installment": 1, "amount": "60.00"}],
            },
        })
        self.assertEqual(restructuring.status_code, 201, restructuring.data)
        approved = self.admin_c.patch(
            f"/api/entities/LoanCase/{restructuring.data['id']}/",
            {"status": "approved", "decision_notes": "Approved revised terms."},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)

        write_off = self.post(self.farmer_c, "LoanCase", {
            "financing_request_id": request["id"],
            "case_type": "write_off",
        })
        self.assertEqual(write_off.status_code, 201, write_off.data)
        written_off = self.admin_c.patch(
            f"/api/entities/LoanCase/{write_off.data['id']}/",
            {"status": "approved", "decision_notes": "Approved write-off."},
            format="json",
        )
        self.assertEqual(written_off.status_code, 200, written_off.data)
        from agri.models import FinancingRequest

        updated_financing = FinancingRequest.objects.get(pk=request["id"])
        self.assertEqual(float(updated_financing.total_cost), 60)
        self.assertEqual(updated_financing.loss_status, "written_off")
        self.assertEqual(finance.loan_balances(request["id"]), (finance.money(0), finance.money(0)))

    def test_active_loan_officer_can_review_underwrite_and_sign(self):
        contract = self.active_offtake_contract(self.farmer, self.farmer_c)
        self.assertEqual(
            self.farmer_c.patch(
                f"/api/entities/OfftakeContract/{contract['id']}/",
                {"farmer_signed_at": "2026-10-08T07:00:00Z"},
                format="json",
            ).status_code,
            200,
        )
        application = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 100,
            "farmer_name": "Alice Farmer",
        }).data
        loan_officer, loan_officer_c = make_user("lo@example.com", "loan_officer")
        profile = self.post(loan_officer_c, "LoanOfficerProfile", {
            "full_name": "Loan Officer",
            "email": loan_officer.email,
            "status": "active",
        }).data
        self.assertEqual(profile["status"], "pending_review")

        self.assertEqual(self.query(loan_officer_c, "FinancingRequest"), [])
        self.assertEqual(
            loan_officer_c.patch(
                f"/api/entities/FinancingRequest/{application['id']}/",
                {"status": "under_review"},
                format="json",
            ).status_code,
            404,
        )
        self.admin_c.patch(
            f"/api/entities/LoanOfficerProfile/{profile['id']}/",
            {"status": "active"},
            format="json",
        )
        self.assertEqual(len(self.query(loan_officer_c, "FinancingRequest")), 1)

        review = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{application['id']}/",
            {"status": "under_review"},
            format="json",
        )
        self.assertEqual(review.status_code, 200, review.data)
        stage1 = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{application['id']}/",
            {"status": "stage1_approved", "stage1_approved_by": "spoofed@example.com"},
            format="json",
        )
        self.assertEqual(stage1.status_code, 200, stage1.data)
        self.assertEqual(stage1.data["stage1_approved_by"], loan_officer.email)
        invalid_amount = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{application['id']}/",
            {"status": "approved", "approved_amount": 101},
            format="json",
        )
        self.assertEqual(invalid_amount.status_code, 400)
        approved = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{application['id']}/",
            {"status": "approved", "approved_amount": 80},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(approved.data["monthly_interest_rate"], 3.5)
        self.assertEqual(approved.data["buyer_withholding_percentage"], 20)
        self.assertEqual(float(approved.data["total_cost"]), 89.8)
        self.assertEqual(len(approved.data["repayment_schedule"]), 6)

        agreement = self.post(loan_officer_c, "Agreement", {
            "agreement_number": "AGR-LO-1",
            "farmer_user_id": str(self.farmer.pk),
            "farmer_name": "Alice Farmer",
            "financing_request_id": application["id"],
            "offtake_contract_id": contract["id"],
            "order_id": self.order["id"],
            "financing_amount": 80,
            "status": "pending_signature",
        })
        self.assertEqual(agreement.status_code, 201, agreement.data)
        duplicate_agreement = self.post(loan_officer_c, "Agreement", {
            "agreement_number": "AGR-LO-2",
            "farmer_user_id": str(self.farmer.pk),
            "financing_request_id": application["id"],
            "offtake_contract_id": contract["id"],
        })
        self.assertEqual(duplicate_agreement.status_code, 400)
        signed = loan_officer_c.patch(
            f"/api/entities/OfftakeContract/{contract['id']}/",
            {"loan_officer_signed_at": "2026-10-08T08:00:00Z"},
            format="json",
        )
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["loan_officer_user_id"], str(loan_officer.pk))
        self.assertIsNotNone(signed.data["loan_officer_signed_at"])
        self.assertEqual(
            self.farmer_c.patch(
                f"/api/entities/OfftakeContract/{contract['id']}/",
                {"loan_officer_signed_at": "2026-10-08T09:00:00Z"},
                format="json",
            ).status_code,
            403,
        )
        guarantee = self.buyer_c.patch(
            f"/api/entities/OfftakeContract/{contract['id']}/",
            {"buyer_guarantee_accepted_at": "2026-10-08T09:00:00Z"},
            format="json",
        )
        self.assertEqual(guarantee.status_code, 200, guarantee.data)
        self.assertIsNotNone(guarantee.data["buyer_guarantee_accepted_at"])

    def test_voucher_must_match_signed_agreement(self):
        order = self.post(self.farmer_c, "Order", {"vendor_user_id": str(self.vendor.id), "items": [{"product_id": "p"}], "total": 100}).data
        contract = self.fully_signed_offtake_contract(self.farmer, self.farmer_c, self.buyer, self.buyer_c)
        financing = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 100,
        }).data
        approved_financing = self.admin_c.patch(
            f"/api/entities/FinancingRequest/{financing['id']}/",
            {"status": "approved", "approved_amount": 80},
            format="json",
        )
        self.assertEqual(approved_financing.status_code, 200, approved_financing.data)
        voucher = {"voucher_code": "AGC-1", "order_id": order["id"], "farmer_user_id": str(self.farmer.id),
                   "vendor_user_id": str(self.vendor.id), "total_value": 100, "status": "active"}
        self.assertEqual(self.post(self.farmer_c, "Voucher", voucher).status_code, 403)  # no agreement yet
        agr = self.post(self.admin_c, "Agreement", {
            "agreement_number": "A1", "farmer_user_id": str(self.farmer.id), "order_id": order["id"],
            "offtake_contract_id": contract["id"], "financing_request_id": financing["id"],
            "status": "pending_signature",
        }).data
        voucher["agreement_id"] = agr["id"]
        self.assertEqual(self.post(self.farmer_c, "Voucher", voucher).status_code, 403)  # not signed
        # farmer may sign, but only touch status/signed_at
        self.assertEqual(self.farmer_c.patch(f"/api/entities/Agreement/{agr['id']}/", {"financing_amount": 1}, format="json").status_code, 403)
        unsigned = self.farmer_c.patch(
            f"/api/entities/Agreement/{agr['id']}/",
            {"status": "signed"},
            format="json",
        )
        self.assertEqual(unsigned.status_code, 400)
        signed = self.farmer_c.patch(
            f"/api/entities/Agreement/{agr['id']}/",
            {"status": "signed", "disclosure_acknowledged_at": "2026-10-08T08:00:00Z"},
            format="json",
        )
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertIsNotNone(signed.data["disclosure_acknowledged_at"])
        self.assertEqual(self.post(self.farmer_c, "Voucher", {**voucher, "total_value": 5000}).status_code, 403)  # inflated
        ok = self.post(self.farmer_c, "Voucher", voucher)
        self.assertEqual(ok.status_code, 201, ok.data)
        # vendor can redeem; farmer can no longer change it, other vendors can't see it
        self.assertEqual(self.vendor_c.patch(f"/api/entities/Voucher/{ok.data['id']}/", {"status": "redeemed"}, format="json").status_code, 200)
        self.assertEqual(self.vendor_c.patch(f"/api/entities/Voucher/{ok.data['id']}/", {"total_value": 1}, format="json").status_code, 403)
        _, other_vendor = make_user("v2@example.com", "vendor")
        self.assertEqual(self.query(other_vendor, "Voucher"), [])

    def test_settlement_cannot_be_self_approved(self):
        s = self.post(self.vendor_c, "Settlement", {"amount": 10, "status": "paid", "payment_reference": "x"}).data
        self.assertEqual((s["status"], s["payment_reference"]), ("pending_review", ""))

    def test_product_vendor_spoofing_blocked_but_employee_allowed(self):
        self.assertEqual(self.post(self.vendor_c, "Product", {"name": "x", "price": 1, "vendor_user_id": str(self.farmer.id)}).status_code, 403)
        self.assertEqual(self.post(self.vendor_c, "Product", {"name": "x", "price": 1}).status_code, 400)  # required
        self.assertEqual(self.post(self.vendor_c, "Product", {"name": "x", "price": 1, "vendor_user_id": str(self.vendor.id)}).status_code, 201)
        emp, emp_c = make_user("emp@example.com", "")
        employee = self.post(self.vendor_c, "VendorEmployee", {
            "vendor_user_id": str(self.vendor.id),
            "employee_email": emp.email,
            "employee_name": "Assistant",
            "employee_user_id": str(emp.id),
            "role": "assistant",
            "status": "active",
        })
        self.assertEqual(employee.status_code, 403)  # generic entity creation cannot bypass invitations
        from agri.models import Settlement, VendorEmployee

        employee_record = VendorEmployee.objects.create(
            created_by=self.vendor,
            vendor_user_id=str(self.vendor.id),
            employee_email=emp.email,
            employee_name="Assistant",
            employee_user_id=str(emp.id),
            role="assistant",
            status="active",
        )
        self.assertEqual(self.post(emp_c, "Product", {"name": "y", "price": 1, "vendor_user_id": str(self.vendor.id)}).status_code, 201)
        self.assertEqual(len(self.query(emp_c, "VendorEmployee", {"vendor_user_id": str(self.vendor.id)})), 1)
        employee_url = f"/api/entities/VendorEmployee/{employee_record.id}/"
        self.assertEqual(
            emp_c.patch(employee_url, {"status": "suspended"}, format="json").status_code,
            403,
        )
        self.assertEqual(emp_c.delete(employee_url).status_code, 403)
        manager, manager_c = make_user("manager@example.com", "")
        VendorEmployee.objects.create(
            created_by=self.vendor,
            vendor_user_id=str(self.vendor.id),
            employee_email=manager.email,
            employee_name="Store Manager",
            employee_user_id=str(manager.id),
            role="manager",
            status="active",
        )
        Settlement.objects.create(
            created_by=self.vendor,
            vendor_user_id=str(self.vendor.id),
            vendor_name="Farm Supplies",
            amount=100,
        )
        self.assertEqual(self.query(emp_c, "Settlement"), [])
        self.assertEqual(len(self.query(manager_c, "Settlement")), 1)
        self.assertEqual(
            self.query(manager_c, "VendorProfile", {"created_by_id": str(self.vendor.id)}),
            [],
        )
        self.assertGreaterEqual(
            len(self.query(manager_c, "Product", {"vendor_user_id": str(self.vendor.id)})),
            1,
        )
        orders = manager_c.get("/api/entities/Order/?sort=-created_date&limit=5")
        self.assertEqual(orders.status_code, 200, orders.data)
        settlements = manager_c.post(
            "/api/entities/Settlement/query/",
            {"q": {}, "sort": "-created_date", "limit": 100},
            format="json",
        )
        self.assertEqual(settlements.status_code, 200, settlements.data)
        manager_update = manager_c.patch(
            employee_url,
            {"role": "manager"},
            format="json",
        )
        self.assertEqual(manager_update.status_code, 200, manager_update.data)
        self.assertEqual(manager_update.data["role"], "manager")

    # ---- messaging / notifications / audit ------------------------------------------------------
    def test_message_sender_cannot_be_spoofed_and_privacy(self):
        conv = self.post(self.farmer_c, "Conversation", {"user1_id": str(self.farmer.id), "user2_id": str(self.vendor.id)}).data
        msg = {"conversation_id": conv["id"], "sender_id": str(self.farmer.id), "recipient_id": str(self.vendor.id), "content": "hi"}
        vendor_reply = self.post(self.vendor_c, "Message", msg)
        self.assertEqual(vendor_reply.status_code, 201, vendor_reply.data)
        self.assertEqual(vendor_reply.data["sender_id"], str(self.vendor.pk))
        self.assertEqual(vendor_reply.data["recipient_id"], str(self.farmer.pk))
        m = self.post(self.farmer_c, "Message", msg).data
        self.assertEqual(len(self.query(self.vendor_c, "Message", {"conversation_id": conv["id"]})), 2)
        self.assertEqual(self.query(self.farmer2_c, "Message"), [])
        self.assertEqual(self.vendor_c.patch(f"/api/entities/Message/{m['id']}/", {"read": True}, format="json").status_code, 200)
        self.assertEqual(self.vendor_c.patch(f"/api/entities/Message/{m['id']}/", {"content": "edited"}, format="json").status_code, 403)
        self.assertEqual(self.vendor_c.patch(
            f"/api/entities/Conversation/{conv['id']}/",
            {"user2_id": str(self.farmer2.pk)},
            format="json",
        ).status_code, 403)
        self.assertEqual(self.query(self.farmer2_c, "Conversation"), [])

    def test_cross_user_notifications_and_bulk_update(self):
        for t in ("one", "two"):
            self.assertEqual(self.post(self.admin_c, "Notification", {"user_id": str(self.farmer.id), "title": t, "message": "m"}).status_code, 201)
        mine = self.query(self.farmer_c, "Notification")
        self.assertEqual(len(mine), 2)
        self.assertFalse(any(
            notification["title"] in {"one", "two"}
            for notification in self.query(self.vendor_c, "Notification")
        ))
        self.assertEqual(self.post(self.vendor_c, "Notification", {
            "user_id": str(self.farmer.id), "title": "Spoofed", "message": "m",
        }).status_code, 403)
        res = self.farmer_c.post("/api/entities/Notification/bulk-update/", {"items": [{"id": n["id"], "read": True} for n in mine]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(all(n["read"] for n in res.data))

    def test_bulk_update_is_atomic_and_scoped(self):
        n = self.post(self.admin_c, "Notification", {"user_id": str(self.farmer.id), "title": "t", "message": "m"}).data
        res = self.farmer2_c.post("/api/entities/Notification/bulk-update/", {"items": [{"id": n["id"], "read": True}]}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_messaging_searches_users_and_starts_by_user_id(self):
        response = self.farmer_c.get("/api/messaging/recipients/?q=vendor")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [item["id"] for item in response.data],
            [str(self.vendor.pk)],
        )
        self.assertEqual(response.data[0]["user_type"], "vendor")
        self.assertNotIn(str(self.farmer.pk), [item["id"] for item in response.data])

        inactive, _inactive_client = make_user("inactive-user@example.com", "farmer", is_active=False)
        all_recipients = self.farmer_c.get("/api/messaging/recipients/")
        self.assertEqual(all_recipients.status_code, 200)
        self.assertNotIn(str(inactive.pk), [item["id"] for item in all_recipients.data])

        started = self.farmer_c.post(
            "/api/messaging/start/",
            {"recipient_id": str(self.vendor.pk)},
            format="json",
        )
        self.assertEqual(started.status_code, 200, started.data)
        self.assertEqual(started.data["user1_id"], str(self.farmer.pk))
        self.assertEqual(started.data["user2_id"], str(self.vendor.pk))
        same = self.farmer_c.post(
            "/api/messaging/start/",
            {"recipient_id": str(self.vendor.pk)},
            format="json",
        )
        self.assertEqual(same.status_code, 200, same.data)
        self.assertEqual(same.data["id"], started.data["id"])

        sent = self.post(self.farmer_c, "Message", {
            "conversation_id": started.data["id"],
            "sender_id": str(self.vendor.pk),
            "recipient_id": str(self.farmer.pk),
            "content": "Please review the delivery update.",
        })
        self.assertEqual(sent.status_code, 201, sent.data)
        self.assertEqual(sent.data["sender_id"], str(self.farmer.pk))
        self.assertEqual(sent.data["recipient_id"], str(self.vendor.pk))
        conversation = self.query(self.vendor_c, "Conversation", {"id": started.data["id"]})[0]
        self.assertEqual(conversation["last_message"], sent.data["content"])
        notification = self.query(self.vendor_c, "Notification", {
            "link": f"/messages?conversation_id={started.data['id']}",
        })
        self.assertEqual(len(notification), 1)
        self.assertEqual(notification[0]["link"], f"/messages?conversation_id={started.data['id']}")
        self.assertEqual(self.query(self.farmer_c, "Notification"), [])

    def test_messaging_recipient_search_requires_authentication(self):
        self.assertEqual(APIClient().get("/api/messaging/recipients/").status_code, 401)

    def test_financing_events_notify_active_officers_and_farmer(self):
        loan_officer, loan_officer_c = make_user("alerts-lo@example.com", "loan_officer")
        profile = self.post(loan_officer_c, "LoanOfficerProfile", {
            "full_name": "Alerts Officer",
        }).data
        self.assertEqual(self.admin_c.patch(
            f"/api/entities/LoanOfficerProfile/{profile['id']}/",
            {"status": "active"},
            format="json",
        ).status_code, 200)
        contract = self.active_offtake_contract(self.farmer, self.farmer_c)
        application = self.post(self.farmer_c, "FinancingRequest", {
            "order_id": self.order["id"],
            "offtake_contract_id": contract["id"],
            "requested_amount": 100,
        })
        self.assertEqual(application.status_code, 201, application.data)
        officer_notifications = self.query(loan_officer_c, "Notification")
        self.assertEqual(len(officer_notifications), 1)
        self.assertIn("New financing application", officer_notifications[0]["title"])

        reviewed = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{application.data['id']}/",
            {"status": "stage1_approved"},
            format="json",
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        approved = loan_officer_c.patch(
            f"/api/entities/FinancingRequest/{application.data['id']}/",
            {"status": "approved", "approved_amount": 100},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        farmer_notifications = self.query(self.farmer_c, "Notification", {
            "title": "Financing application approved",
        })
        self.assertEqual(len(farmer_notifications), 1)
        self.assertIn("approved", farmer_notifications[0]["title"])

    def test_audit_log_actor_is_server_set_and_admin_only_read(self):
        res = self.post(self.farmer_c, "AuditLog", {"action": "X", "entity_type": "Y", "actor_email": "ceo@example.com"})
        self.assertEqual(res.data["actor_email"], "farmer@example.com")
        self.assertEqual(self.query(self.farmer_c, "AuditLog"), [])
        self.assertEqual(len(self.query(self.admin_c, "AuditLog", {
            "action": "X", "entity_type": "Y",
        })), 1)

    def test_bulk_create_and_delete_many_respect_ownership(self):
        items = [{"name": f"p{i}", "price": i, "vendor_user_id": str(self.vendor.id)} for i in range(3)]
        res = self.vendor_c.post("/api/entities/Product/bulk-create/", {"items": items}, format="json")
        self.assertEqual((res.status_code, len(res.data)), (201, 3))
        res = self.farmer_c.post("/api/entities/Product/delete-many/", {"q": {"vendor_user_id": str(self.vendor.id)}}, format="json")
        self.assertEqual(res.data["deleted"], 0)
        res = self.vendor_c.post("/api/entities/Product/delete-many/", {"q": {"vendor_user_id": str(self.vendor.id)}}, format="json")
        self.assertEqual(res.data["deleted"], 3)
        deletions = self.query(self.admin_c, "AuditLog", {
            "entity_type": "Product",
            "action": "DELETE",
        })
        self.assertEqual(len(deletions), 3)

    def test_catalog_entities_admin_write_only(self):
        self.assertEqual(self.post(self.farmer_c, "Category", {"name": "Seeds"}).status_code, 403)
        self.assertEqual(self.post(self.admin_c, "Category", {"name": "Seeds"}).status_code, 201)
        self.assertEqual(len(self.query(self.farmer_c, "Category")), 1)

    def test_system_fields_cannot_be_forged(self):
        response = self.post(self.farmer_c, "Harvest", {
            "crop": "m",
            "farming_start_date": "2026-06-01",
            "crop_duration_days": 150,
            "expected_harvest_date": "2026-10-30",
            "created_by_id": str(self.farmer2.id),
            "created_by": "x",
            "id": "11111111-1111-1111-1111-111111111111",
        })
        self.assertEqual(response.status_code, 201, response.data)
        rec = response.data
        self.assertEqual(rec["created_by_id"], str(self.farmer.id))
        self.assertNotEqual(rec["id"], "11111111-1111-1111-1111-111111111111")


class FileTests(APITestCase):
    def setUp(self):
        import tempfile

        from django.test import override_settings

        self.tmp = tempfile.TemporaryDirectory()
        self.override = override_settings(UPLOAD_ROOT=__import__("pathlib").Path(self.tmp.name))
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.addCleanup(self.tmp.cleanup)
        self.farmer, self.farmer_c = make_user("farmer@example.com", "farmer")
        self.admin, self.admin_c = make_user("admin@example.com", role="admin")
        self.other, self.other_c = make_user("other@example.com", "farmer")

    def upload(self, client, name="doc.png", content=PNG, private=False):
        data = {"file": SimpleUploadedFile(name, content)}
        if private:
            data["private"] = "true"
        return client.post("/api/files/upload/", data, format="multipart")

    def test_public_upload_roundtrip_and_safe_headers(self):
        res = self.upload(self.farmer_c)
        self.assertEqual(res.status_code, 201, res.data)
        got = APIClient().get(res.data["file_url"])  # anyone with the URL
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got["X-Content-Type-Options"], "nosniff")
        self.assertEqual(b"".join(got.streaming_content), PNG)

    def test_rejects_bad_types_and_spoofed_content(self):
        self.assertEqual(self.upload(self.farmer_c, "x.html", b"<script>alert(1)</script>").status_code, 400)
        self.assertEqual(self.upload(self.farmer_c, "x.svg", b"<svg onload=alert(1)/>").status_code, 400)
        self.assertEqual(self.upload(self.farmer_c, "x.png", b"<script>alert(1)</script>").status_code, 400)
        self.assertEqual(self.upload(self.farmer_c, "../../etc/passwd.png", PNG).status_code, 201)  # name is sanitised
        self.assertEqual(APIClient().post("/api/files/upload/", {"file": SimpleUploadedFile("a.png", PNG)}, format="multipart").status_code, 401)

    def test_private_files_only_via_signed_link_handed_to_authorised_readers(self):
        uri = self.upload(self.farmer_c, private=True).data["file_uri"]
        self.assertTrue(uri.startswith("private:"))
        kyc = self.farmer_c.post("/api/entities/KYCVerification/", {"user_type": "farmer", "document_url": uri}, format="json")
        self.assertEqual(kyc.status_code, 201, kyc.data)
        link = kyc.data["document_url"]
        self.assertIn("/api/files/private/", link)
        self.assertEqual(APIClient().get(link).status_code, 200)  # browser can open it directly
        self.assertEqual(APIClient().get(link[:-3] + "xyz").status_code, 403)  # tampered signature
        self.assertEqual(APIClient().get(link.split("?")[0]).status_code, 403)  # no signature
        # admins see it, strangers don't see the record (so never get a link)
        self.assertIn("/api/files/private/", self.admin_c.get(f"/api/entities/KYCVerification/{kyc.data['id']}/").data["document_url"])
        self.assertEqual(self.other_c.get(f"/api/entities/KYCVerification/{kyc.data['id']}/").status_code, 404)
        # round-trip: sending the signed URL back normalises to the stored form
        upd = self.farmer_c.patch(f"/api/entities/KYCVerification/{kyc.data['id']}/", {"document_url": link}, format="json")
        self.assertEqual(upd.status_code, 200)
        # can't attach someone else's private file
        self.assertEqual(self.other_c.post("/api/entities/KYCVerification/", {"user_type": "farmer", "document_url": uri}, format="json").status_code, 400)

    def test_expired_private_link(self):
        from django.test import override_settings

        uri = self.upload(self.farmer_c, private=True).data["file_uri"]
        link = self.farmer_c.post("/api/entities/KYCVerification/", {"user_type": "farmer", "document_url": uri}, format="json").data["document_url"]
        with override_settings(PRIVATE_FILE_URL_TTL=-1):
            self.assertEqual(APIClient().get(link).status_code, 403)

    def test_size_limit(self):
        from django.test import override_settings

        with override_settings(MAX_UPLOAD_BYTES=10):
            self.assertEqual(self.upload(self.farmer_c).status_code, 400)


class EmailTests(APITestCase):
    def test_send_email_only_to_registered_users_and_sanitises_html(self):
        _, c = make_user("sender@example.com", "vendor")
        make_user("target@example.com", "farmer")
        bad = c.post("/api/integrations/send-email/", {"to": "stranger@evil.com", "subject": "s", "html": "<p>x</p>"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        ok = c.post("/api/integrations/send-email/", {"to": "Target@Example.com", "subject": "Hi\nBcc: x", "html": "<p style='color:red' onclick='alert(1)'>Hello</p><script>alert(1)</script><a href='javascript:x'>l</a><a href='https://example.com'>safe</a>"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(len(mail.outbox), 1)
        html = mail.outbox[0].alternatives[0][0]
        self.assertNotIn("<script", html)
        self.assertNotIn("javascript:", html)
        self.assertNotIn("onclick", html)
        self.assertNotIn("style=", html)
        self.assertIn('<a href="https://example.com">safe</a>', html)
        self.assertIn("Hello", mail.outbox[0].body)
        self.assertNotIn("\n", mail.outbox[0].subject)
        self.assertEqual(APIClient().post("/api/integrations/send-email/", {}, format="json").status_code, 401)

    def test_profile_email_is_a_valid_recipient(self):
        _, vendor_c = make_user("v@example.com", "vendor")
        vendor_c.post("/api/entities/VendorProfile/", {"business_name": "V", "email": "billing@vendor.co"}, format="json")
        _, c = make_user("buyer@example.com", "buyer")
        res = c.post("/api/integrations/send-email/", {"to": "billing@vendor.co", "subject": "s", "html": "<p>x</p>"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
