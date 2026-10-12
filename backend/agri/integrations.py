import hmac
import re
from decimal import Decimal
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit

from django.conf import settings
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from accounts.emails import send_html_email
from accounts.models import User

from . import finance
from .models import AuditLog, BuyerProfile, Complaint, FarmerProfile, FieldOfficerProfile, FinancingRequest, VendorProfile

ALLOWED_TAGS = {"p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "h1", "h2", "h3", "span", "div"}
BLOCKED_TAGS = {"embed", "iframe", "math", "noscript", "object", "script", "style", "svg", "template"}


class _EmailHTMLSanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.html_parts = []
        self.text_parts = []
        self.open_tags = []
        self.suppressed_tags = []

    def handle_starttag(self, tag, attrs):
        if self.suppressed_tags:
            if tag in BLOCKED_TAGS:
                self.suppressed_tags.append(tag)
            return
        if tag in BLOCKED_TAGS:
            self.suppressed_tags.append(tag)
            return
        if tag not in ALLOWED_TAGS:
            return

        if tag in {"div", "h1", "h2", "h3", "li", "p"}:
            self.text_parts.append("\n")
        safe_attrs = []
        if tag == "a":
            href = dict(attrs).get("href")
            if href and self._safe_href(href):
                safe_attrs.append(f' href="{escape(href, quote=True)}"')
        self.html_parts.append(f"<{tag}{''.join(safe_attrs)}>")
        if tag == "br":
            self.text_parts.append("\n")
        else:
            self.open_tags.append(tag)

    def handle_endtag(self, tag):
        if self.suppressed_tags:
            if tag in self.suppressed_tags:
                del self.suppressed_tags[len(self.suppressed_tags) - 1 - self.suppressed_tags[::-1].index(tag):]
            return
        if tag not in self.open_tags:
            return
        index = len(self.open_tags) - 1 - self.open_tags[::-1].index(tag)
        for open_tag in reversed(self.open_tags[index:]):
            self.html_parts.append(f"</{open_tag}>")
            if open_tag in {"div", "h1", "h2", "h3", "li", "p"}:
                self.text_parts.append("\n")
        del self.open_tags[index:]

    def handle_data(self, data):
        if self.suppressed_tags:
            return
        self.html_parts.append(escape(data, quote=False))
        self.text_parts.append(data)

    def finish(self):
        self.close()
        for open_tag in reversed(self.open_tags):
            self.html_parts.append(f"</{open_tag}>")
        text = re.sub(r"[ \t]+", " ", "".join(self.text_parts))
        text = re.sub(r" *\n *", "\n", text).strip()
        return "".join(self.html_parts), text

    @staticmethod
    def _safe_href(href):
        if any(ord(char) < 32 or ord(char) == 127 for char in href) or "\\" in href:
            return False
        value = href.strip()
        try:
            parsed = urlsplit(value)
        except ValueError:
            return False
        if parsed.scheme:
            if parsed.scheme.lower() not in {"http", "https", "mailto"}:
                return False
            if parsed.scheme.lower() in {"http", "https"}:
                return bool(parsed.netloc)
            return bool(parsed.path)
        return bool(value) and not value.startswith("//")


def _sanitize_email_html(value):
    sanitizer = _EmailHTMLSanitizer()
    sanitizer.feed(value)
    return sanitizer.finish()


class EmailThrottle(UserRateThrottle):
    scope = "email"


class UssdThrottle(AnonRateThrottle):
    scope = "ussd"


def _is_known_recipient(email):
    """Notification emails may only go to people registered on the platform - this endpoint is not an open relay."""
    return (
        User.objects.filter(email__iexact=email).exists()
        or VendorProfile.objects.filter(email__iexact=email).exists()
        or BuyerProfile.objects.filter(email__iexact=email).exists()
        or FieldOfficerProfile.objects.filter(email__iexact=email).exists()
    )


@api_view(["POST"])
@throttle_classes([EmailThrottle])
def send_email(request):
    """POST {to, subject, html|body}. Replaces Base44's Core.SendEmail."""
    to = (request.data.get("to") or "").strip().lower()
    subject = str(request.data.get("subject") or "").replace("\n", " ").strip()[:200]
    html = request.data.get("html") or request.data.get("body") or ""
    if not to or not subject or not html:
        raise ValidationError({"detail": "to, subject and html/body are required."})
    if not _is_known_recipient(to):
        raise ValidationError({"to": "Recipient is not registered on the platform."})
    clean, text = _sanitize_email_html(str(html)[:20000])
    sent = send_html_email(to, subject, clean, text)
    return Response({"ok": sent})


def _digits(value):
    return re.sub(r"\D", "", str(value or ""))


def _ussd_reply(text, status=200):
    return HttpResponse(text, status=status, content_type="text/plain; charset=utf-8")


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([UssdThrottle])
def ussd_callback(request):
    """USSD gateway callback. Requires a configured shared gateway token and registered farmer phone."""
    expected_token = settings.USSD_GATEWAY_TOKEN
    supplied_token = request.headers.get("X-USSD-Gateway-Token", "")
    if not expected_token:
        return _ussd_reply("END Service unavailable.", status=503)
    if not hmac.compare_digest(supplied_token, expected_token):
        return _ussd_reply("END Service unavailable.", status=403)
    phone = _digits(request.data.get("phone_number"))
    text = str(request.data.get("text") or "").strip()[:5000]
    if len(phone) < 7:
        return _ussd_reply("END Invalid phone number.")
    matches = list(FarmerProfile.objects.filter(phone__isnull=False).exclude(phone=""))
    matches = [profile for profile in matches if _digits(profile.phone) == phone]
    if len(matches) != 1:
        return _ussd_reply("END This phone is not uniquely linked to a farmer account. Please contact support.")
    farmer = User.objects.filter(pk=matches[0].created_by_id, user_type="farmer", is_active=True).first()
    if farmer is None:
        return _ussd_reply("END This account is not available. Please contact support.")

    if not text:
        return _ussd_reply("CON Sanctuary AgriConnect\n1. My loan balance\n2. Submit a complaint\n3. Help")
    if text == "1":
        principal_total = Decimal("0.00")
        interest_total = Decimal("0.00")
        for loan in FinancingRequest.objects.filter(created_by=farmer, status="approved"):
            principal, interest = finance.loan_balances(loan.pk)
            principal_total += principal
            interest_total += interest
        return _ussd_reply(
            f"END Loan balance: KES {finance.money(principal_total + interest_total)} "
            f"(principal {finance.money(principal_total)}, interest {finance.money(interest_total)})."
        )
    if text == "2":
        return _ussd_reply("CON Reply with 2* followed by your complaint.")
    if text.startswith("2*"):
        message = text[2:].strip()
        if len(message) < 8:
            return _ussd_reply("CON Please describe the issue in at least 8 characters.")
        complaint = Complaint.objects.create(
            created_by=farmer,
            complainant_user_id=str(farmer.pk),
            category="other",
            message=message,
            status="open",
        )
        AuditLog.objects.create(
            created_by=farmer,
            actor_email=farmer.email,
            action="USSD_COMPLAINT_SUBMITTED",
            entity_type="Complaint",
            entity_id=str(complaint.pk),
        )
        return _ussd_reply("END Complaint sent to independent support and compliance staff.")
    if text == "3":
        return _ussd_reply("END Call your cooperative or use the independent Complaints menu on the web app.")
    return _ussd_reply("END Invalid choice. Dial again to restart.")
