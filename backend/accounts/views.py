import secrets
from datetime import timedelta
from urllib.parse import quote, urlencode

import requests
from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .emails import send_otp_email, send_password_reset_email
from .models import AuthToken, User

# ---------------------------------------------------------------------------------------------------
# helpers


class AuthThrottle(AnonRateThrottle):
    scope = "auth"


class OtpThrottle(AnonRateThrottle):
    scope = "otp"


# Per-user attributes the client may set on itself through PATCH /auth/me/ (everything else is ignored).
SELF_EDITABLE = {"full_name"}


class InvitationEmailUnavailable(APIException):
    status_code = 503
    default_detail = "The invitation email could not be sent. Please try again."
    default_code = "invitation_email_unavailable"


def link_registered_vendor_employee(user):
    from agri.models import VendorEmployee

    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        invites = list(
            VendorEmployee.objects.select_for_update().filter(
                employee_email__iexact=user.email,
                employee_user_id="",
                status="invited",
            )[:2]
        )
        if len(invites) != 1:
            return user
        invite = invites[0]
        invite.employee_user_id = str(user.pk)
        invite.save(update_fields=["employee_user_id", "updated_date"])
        user.data = {**(user.data or {}), "employer_vendor_id": invite.vendor_user_id}
        update_fields = ["data"]
        if not user.full_name:
            user.full_name = invite.employee_name
            update_fields.append("full_name")
        user.save(update_fields=update_fields)
        return user


def user_payload(user):
    payload = {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "user_type": user.user_type or None,
        "data": user.data or {},
        "created_date": user.created_date.isoformat(),
    }
    for key, value in (user.data or {}).items():  # custom attributes are also exposed top-level
        payload.setdefault(key, value)
    from agri.models import VendorEmployee

    employment = VendorEmployee.objects.filter(
        employee_user_id=str(user.pk),
        employee_email__iexact=user.email,
    ).first()
    if employment:
        payload["vendor_employment"] = {
            "vendor_user_id": employment.vendor_user_id,
            "vendor_name": employment.vendor_name,
            "role": employment.role,
            "status": employment.status,
        }
    return payload


def session_response(user, http_status=status.HTTP_200_OK):
    user = link_registered_vendor_employee(user)
    return Response({"access_token": AuthToken.issue(user), "user": user_payload(user)}, status=http_status)


def clean_email(value):
    email = (value or "").strip().lower()
    try:
        validate_email(email)
    except DjangoValidationError:
        raise ValidationError({"email": "Enter a valid email address."})
    return email


def check_password_strength(password, user=None):
    try:
        password_validation.validate_password(password or "", user)
    except DjangoValidationError as exc:
        raise ValidationError({"password": list(exc.messages)})


def _otp_hash(user, code):
    return salted_hmac("accounts.otp", f"{user.pk}:{code}").hexdigest()


def issue_otp(user):
    code = f"{secrets.randbelow(10**6):06d}"
    user.otp_hash = _otp_hash(user, code)
    user.otp_expires_at = timezone.now() + timedelta(minutes=settings.OTP_TTL_MINUTES)
    user.otp_attempts = 0
    user.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts"])
    send_otp_email(user, code)


def safe_return_to(value):
    """Same-origin path only; blocks //evil.com and backslash tricks (open redirect)."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value


def make_reset_token(user):
    uid = urlsafe_base64_encode(force_bytes(str(user.pk)))
    return f"{uid}.{default_token_generator.make_token(user)}"


# ---------------------------------------------------------------------------------------------------
# registration with email OTP


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def register(request):
    email = clean_email(request.data.get("email"))
    password = request.data.get("password") or ""
    existing = User.objects.filter(email=email).first()
    if existing and existing.is_active:
        raise ValidationError({"email": "An account with this email already exists. Try logging in."})
    check_password_strength(password, existing or User(email=email))
    if existing:  # unverified earlier attempt: take the new password and resend a fresh code
        user = existing
        user.set_password(password)
        user.save(update_fields=["password"])
    else:
        user = User.objects.create_user(email=email, password=password, is_active=False,
                                        full_name=(request.data.get("full_name") or "")[:255])
    issue_otp(user)
    return Response({"ok": True, "message": "Verification code sent."}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([OtpThrottle])
def verify_otp(request):
    email = clean_email(request.data.get("email"))
    code = str(request.data.get("otp_code") or request.data.get("otpCode") or "").strip()
    invalid = ValidationError({"otp_code": "Invalid or expired verification code."})
    user = User.objects.filter(email=email).first()
    if not user or not user.otp_hash:
        raise invalid
    if user.otp_attempts >= settings.OTP_MAX_ATTEMPTS or not user.otp_expires_at or user.otp_expires_at < timezone.now():
        raise ValidationError({"otp_code": "This code is no longer valid. Request a new one."})
    if not constant_time_compare(user.otp_hash, _otp_hash(user, code)):
        user.otp_attempts += 1
        user.save(update_fields=["otp_attempts"])
        raise invalid
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        user.is_active = True
        user.otp_hash, user.otp_expires_at, user.otp_attempts = "", None, 0
        update_fields = ["is_active", "otp_hash", "otp_expires_at", "otp_attempts"]
        user.save(update_fields=update_fields)
    return session_response(user)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([OtpThrottle])
def resend_otp(request):
    email = clean_email(request.data.get("email"))
    user = User.objects.filter(email=email, is_active=False).first()
    if user:  # don't reveal whether the address exists
        issue_otp(user)
    return Response({"ok": True})


# ---------------------------------------------------------------------------------------------------
# login / logout / me


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def login(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""
    user = User.objects.filter(email=email).first()
    if user is None:
        User().set_password(password)  # burn a comparable hash so timing doesn't reveal whether the account exists
        raise PermissionDenied("Invalid email or password.")
    if not user.check_password(password):
        raise PermissionDenied("Invalid email or password.")
    if not user.is_active:
        raise PermissionDenied("Please verify your email address first. Register again to get a new code.")
    return session_response(user)


@api_view(["POST"])
def logout(request):
    if request.auth is not None:
        request.auth.delete()
    return Response({"ok": True})


@api_view(["GET", "PATCH"])
def me(request):
    user = request.user
    if request.method == "PATCH":
        body = request.data
        changed = []
        if "user_type" in body and body["user_type"]:
            wanted = body["user_type"]
            if wanted not in dict(User.USER_TYPE_CHOICES):
                raise ValidationError({"user_type": "Invalid account type."})
            if user.user_type and user.user_type != wanted:
                raise PermissionDenied("Account type can't be changed once chosen. Contact support.")
            user.user_type = wanted
            changed.append("user_type")
        if "full_name" in body:
            user.full_name = str(body["full_name"] or "")[:255]
            changed.append("full_name")
        if changed:
            user.save(update_fields=changed)
    return Response(user_payload(user))


# ---------------------------------------------------------------------------------------------------
# password reset & invitations


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def reset_password_request(request):
    email = (request.data.get("email") or "").strip().lower()
    user = User.objects.filter(email=email, is_active=True).first()
    if user:
        send_password_reset_email(user, make_reset_token(user))
    return Response({"ok": True})  # same answer whether or not the account exists


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def reset_password(request):
    token = request.data.get("reset_token") or request.data.get("resetToken") or ""
    new_password = request.data.get("new_password") or request.data.get("newPassword") or ""
    bad = ValidationError({"reset_token": "This reset link is invalid or has expired."})
    try:
        uid, _, key = token.partition(".")
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid)), is_active=True)
    except (User.DoesNotExist, ValueError, TypeError, OverflowError, DjangoValidationError):
        raise bad
    if not default_token_generator.check_token(user, key):
        raise bad
    check_password_strength(new_password, user)
    user.set_password(new_password)  # also invalidates this reset token (it hashes the password)
    user.save(update_fields=["password"])
    user.auth_tokens.all().delete()  # sign out everywhere
    return Response({"ok": True})


@api_view(["POST"])
def invite_user(request):
    """A vendor (for employees) or an admin can invite someone by email; they get a link to set a password."""
    inviter = request.user
    if not (inviter.is_admin or inviter.user_type == "vendor"):
        raise PermissionDenied("Only vendors and admins can invite users.")
    email = clean_email(request.data.get("email"))
    role = request.data.get("role") or "user"
    if role == "admin" and not inviter.is_admin:
        raise PermissionDenied("Only admins can invite admins.")
    user = User.objects.filter(email=email).first()
    if user is None:
        user = User.objects.create_user(email=email, password=None, role=role if role in ("user", "admin") else "user")
    send_password_reset_email(user, make_reset_token(user), invited=True)
    return Response({"ok": True, "email": email})


@api_view(["POST"])
def invite_employee(request):
    from agri import policies
    from agri.models import VendorEmployee, VendorProfile

    vendor = request.user
    vendor_user_id = policies.vendor_account_id(vendor, "team")
    if not vendor_user_id:
        raise PermissionDenied("Only this vendor or an approved vendor manager can invite employees.")
    if not VendorProfile.objects.filter(created_by_id=vendor_user_id).exists():
        raise PermissionDenied("Set up your vendor profile before inviting employees.")

    email = clean_email(request.data.get("email"))
    employee_name = str(request.data.get("employee_name") or "").strip()[:255]
    role = str(request.data.get("role") or "assistant")
    if not employee_name:
        raise ValidationError({"employee_name": "Enter the employee's name."})
    if role not in {"assistant", "manager"}:
        raise ValidationError({"role": "Choose a supported employee role."})
    if User.objects.filter(email=email, is_active=True).exists():
        raise ValidationError({"email": "This email already has an account. Ask the employee to contact support."})
    if VendorEmployee.objects.filter(employee_email__iexact=email).exists():
        raise ValidationError({"email": "An employee invitation already exists for this email."})

    profile = VendorProfile.objects.filter(created_by_id=vendor_user_id).first()
    vendor_name = profile.business_name or "A vendor"
    from .emails import send_vendor_employee_invite_email

    with transaction.atomic():
        if not send_vendor_employee_invite_email(email, employee_name, vendor_name):
            raise InvitationEmailUnavailable()
        invitation = VendorEmployee.objects.create(
            created_by=vendor,
            vendor_user_id=vendor_user_id,
            vendor_name=vendor_name,
            employee_name=employee_name,
            employee_email=email,
            role=role,
            status="invited",
        )
    return Response({"ok": True, "email": email, "invitation_id": str(invitation.pk)})


# ---------------------------------------------------------------------------------------------------
# Google sign-in (authorization-code flow, handled entirely server-side)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
OAUTH_COOKIE = "oauth_nonce"
STATE_SALT = "accounts.google.state"


def _frontend_error(message):
    return HttpResponseRedirect(f"{settings.FRONTEND_URL}/login?error={quote(message)}")


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def google_start(request):
    if not (settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET):
        return _frontend_error("Google sign-in is not configured.")
    nonce = secrets.token_urlsafe(16)
    state = signing.dumps({"n": nonce, "r": safe_return_to(request.GET.get("returnTo"))}, salt=STATE_SALT)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    response = HttpResponseRedirect(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")
    response.set_cookie(OAUTH_COOKIE, nonce, max_age=600, httponly=True, samesite="Lax", secure=not settings.DEBUG)
    return response


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def google_callback(request):
    try:
        state = signing.loads(request.GET.get("state", ""), salt=STATE_SALT, max_age=600)
    except signing.BadSignature:
        return _frontend_error("Google sign-in expired. Please try again.")
    if not constant_time_compare(state.get("n", ""), request.COOKIES.get(OAUTH_COOKIE, "")):
        return _frontend_error("Google sign-in could not be verified. Please try again.")
    code = request.GET.get("code")
    if not code:
        return _frontend_error("Google sign-in was cancelled.")
    try:
        token = requests.post(GOOGLE_TOKEN_URL, data={
            "code": code, "client_id": settings.GOOGLE_CLIENT_ID, "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI, "grant_type": "authorization_code",
        }, timeout=10)
        token.raise_for_status()
        info = requests.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {token.json()['access_token']}"}, timeout=10)
        info.raise_for_status()
        info = info.json()
    except (requests.RequestException, KeyError, ValueError):
        return _frontend_error("Could not complete Google sign-in.")
    email = (info.get("email") or "").lower()
    if not email or not info.get("email_verified"):
        return _frontend_error("Your Google email address is not verified.")
    user = User.objects.filter(email=email).first()
    if user is None:
        user = User.objects.create_user(email=email, password=None, full_name=(info.get("name") or "")[:255])
    elif not user.is_active:  # they proved ownership of the address via Google
        user.is_active = True
        user.save(update_fields=["is_active"])
    # Token goes in the URL *fragment* so it never reaches server logs or Referer headers.
    target = f"{settings.FRONTEND_URL}/auth/callback#access_token={AuthToken.issue(user)}&returnTo={quote(state['r'])}"
    response = HttpResponseRedirect(target)
    response.delete_cookie(OAUTH_COOKIE)
    return response
