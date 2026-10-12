import re

from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from agri.models import VendorEmployee, VendorProfile
from .models import User

PW = "S3cure-pass-word"


def otp_from_outbox():
    return re.search(r"(\d{6})", mail.outbox[-1].body).group(1)


class AuthFlowTests(APITestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache

    def register_and_verify(self, email="a@example.com"):
        self.client.post("/api/auth/register/", {"email": email, "password": PW}, format="json")
        res = self.client.post("/api/auth/verify-otp/", {"email": email, "otp_code": otp_from_outbox()}, format="json")
        return res

    def test_register_verify_login_me_logout(self):
        res = self.register_and_verify()
        self.assertEqual(res.status_code, 200)
        token = res.data["access_token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.data["email"], "a@example.com")
        self.assertEqual(me.data["role"], "user")
        self.client.post("/api/auth/logout/")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.client.credentials()
        login = self.client.post("/api/auth/login/", {"email": "A@Example.com", "password": PW}, format="json")
        self.assertEqual(login.status_code, 200)
        self.assertIn("access_token", login.data)

    def test_unverified_cannot_login(self):
        self.client.post("/api/auth/register/", {"email": "b@example.com", "password": PW}, format="json")
        res = self.client.post("/api/auth/login/", {"email": "b@example.com", "password": PW}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_wrong_password_and_unknown_user_same_error(self):
        self.register_and_verify()
        r1 = self.client.post("/api/auth/login/", {"email": "a@example.com", "password": "nope"}, format="json")
        r2 = self.client.post("/api/auth/login/", {"email": "ghost@example.com", "password": "nope"}, format="json")
        self.assertEqual((r1.status_code, r1.data["message"]), (r2.status_code, r2.data["message"]))

    def test_weak_password_rejected(self):
        res = self.client.post("/api/auth/register/", {"email": "c@example.com", "password": "123"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("message", res.data)

    def test_otp_locks_after_too_many_attempts(self):
        self.client.post("/api/auth/register/", {"email": "d@example.com", "password": PW}, format="json")
        good = otp_from_outbox()
        for _ in range(5):
            self.client.post("/api/auth/verify-otp/", {"email": "d@example.com", "otp_code": "000000" if good != "000000" else "111111"}, format="json")
        res = self.client.post("/api/auth/verify-otp/", {"email": "d@example.com", "otp_code": good}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(User.objects.get(email="d@example.com").is_active)

    def test_cannot_escalate_role_or_change_type(self):
        token = self.register_and_verify().data["access_token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        res = self.client.patch("/api/auth/me/", {"role": "admin", "is_staff": True, "user_type": "farmer"}, format="json")
        self.assertEqual(res.data["role"], "user")
        self.assertEqual(res.data["user_type"], "farmer")
        self.assertEqual(self.client.patch("/api/auth/me/", {"user_type": "vendor"}, format="json").status_code, 403)
        self.assertFalse(User.objects.get(email="a@example.com").is_staff)

    def test_loan_officer_account_type_is_supported(self):
        token = self.register_and_verify().data["access_token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.patch("/api/auth/me/", {"user_type": "loan_officer"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user_type"], "loan_officer")

    def test_password_reset_flow_invalidates_sessions(self):
        token = self.register_and_verify().data["access_token"]
        self.client.credentials()
        self.client.post("/api/auth/reset-password-request/", {"email": "a@example.com"}, format="json")
        reset = re.search(r"token=([^\s<'\"]+)", mail.outbox[-1].body).group(1)
        res = self.client.post("/api/auth/reset-password/", {"reset_token": reset, "new_password": "An0ther-strong-pw"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)  # old session revoked
        self.client.credentials()
        reuse = self.client.post("/api/auth/reset-password/", {"reset_token": reset, "new_password": "Yet-another-pw-1"}, format="json")
        self.assertEqual(reuse.status_code, 400)  # single use
        self.assertEqual(self.client.post("/api/auth/login/", {"email": "a@example.com", "password": "An0ther-strong-pw"}, format="json").status_code, 200)

    def test_reset_request_does_not_leak_account_existence(self):
        res = self.client.post("/api/auth/reset-password-request/", {"email": "nobody@example.com"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_invite_requires_vendor_or_admin(self):
        token = self.register_and_verify().data["access_token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.post("/api/auth/invite-user/", {"email": "e@example.com"}, format="json").status_code, 403)
        self.client.patch("/api/auth/me/", {"user_type": "vendor"}, format="json")
        res = self.client.post("/api/auth/invite-user/", {"email": "e@example.com", "role": "admin"}, format="json")
        self.assertEqual(res.status_code, 403)  # vendors can't mint admins
        self.assertEqual(self.client.post("/api/auth/invite-user/", {"email": "e@example.com", "role": "user"}, format="json").status_code, 200)
        self.assertIn("invited", mail.outbox[-1].subject)

    def test_vendor_employee_registers_by_invited_email_and_vendor_approves(self):
        vendor = User.objects.create_user("vendor@example.com", PW, user_type="vendor")
        VendorProfile.objects.create(created_by=vendor, business_name="Green Harvest")
        vendor_client = self.client_class()
        vendor_client.force_authenticate(user=vendor)

        invite = vendor_client.post("/api/auth/invite-employee/", {
            "email": "employee@example.com",
            "employee_name": "Farm Assistant",
            "role": "assistant",
        }, format="json")
        self.assertEqual(invite.status_code, 200, invite.data)
        self.assertFalse(User.objects.filter(email="employee@example.com").exists())
        self.assertIn("/register?email=employee%40example.com", mail.outbox[-1].body)
        employee_record = VendorEmployee.objects.get(pk=invite.data["invitation_id"])
        self.assertEqual(employee_record.status, "invited")
        self.assertEqual(employee_record.vendor_user_id, str(vendor.pk))
        not_registered = vendor_client.patch(
            f"/api/entities/VendorEmployee/{employee_record.pk}/",
            {"status": "active"},
            format="json",
        )
        self.assertEqual(not_registered.status_code, 400)

        self.client.credentials()
        self.client.post("/api/auth/register/", {
            "email": "employee@example.com",
            "password": PW,
        }, format="json")
        otp = otp_from_outbox()
        verified = self.client.post("/api/auth/verify-otp/", {
            "email": "employee@example.com",
            "otp_code": otp,
        }, format="json")
        self.assertEqual(verified.status_code, 200, verified.data)
        self.assertEqual(verified.data["user"]["vendor_employment"], {
            "vendor_user_id": str(vendor.pk),
            "vendor_name": "Green Harvest",
            "role": "assistant",
            "status": "invited",
        })
        employee = User.objects.get(email="employee@example.com")
        self.assertEqual(employee_record.__class__.objects.get(pk=employee_record.pk).employee_user_id, str(employee.pk))

        employee_client = self.client_class()
        employee_client.force_authenticate(user=employee)
        attempted_link_change = employee_client.patch("/api/auth/me/", {
            "employer_vendor_id": "another-vendor",
        }, format="json")
        self.assertEqual(attempted_link_change.status_code, 200)
        self.assertEqual(attempted_link_change.data["employer_vendor_id"], str(vendor.pk))

        admin = User.objects.create_superuser("admin@example.com", PW)
        admin_client = self.client_class()
        admin_client.force_authenticate(user=admin)
        rejected_admin_approval = admin_client.patch(
            f"/api/entities/VendorEmployee/{employee_record.pk}/",
            {"status": "active"},
            format="json",
        )
        self.assertEqual(rejected_admin_approval.status_code, 403)

        approval = vendor_client.patch(
            f"/api/entities/VendorEmployee/{employee_record.pk}/",
            {"status": "active"},
            format="json",
        )
        self.assertEqual(approval.status_code, 200, approval.data)
        self.assertEqual(approval.data["status"], "active")

    def test_open_redirect_helper(self):
        from .views import safe_return_to

        for bad in ("//evil.com", "/\\evil.com", "https://evil.com", "evil", None):
            self.assertEqual(safe_return_to(bad), "/")
        self.assertEqual(safe_return_to("/farmer/dashboard?x=1"), "/farmer/dashboard?x=1")

    def test_superuser_gets_admin_role(self):
        u = User.objects.create_superuser("root@example.com", PW)
        self.assertEqual((u.role, u.is_staff), ("admin", True))
