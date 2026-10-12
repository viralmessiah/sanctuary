import logging

from django.conf import settings
from django.core.mail import send_mail
from django.utils.html import escape

logger = logging.getLogger(__name__)

SIGNATURE = "Sanctuary AgriConnect"


def send_html_email(to, subject, html, text=None):
    try:
        send_mail(
            subject=subject,
            message=text or "",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[to],
            html_message=html,
            fail_silently=False,
        )
        return True
    except Exception:  # SMTP outage must not 500 an auth request; the user can retry/resend
        logger.exception("Failed to send email to %s", to)
        return False


def send_otp_email(user, code):
    html = (
        f"<p>Welcome to {SIGNATURE}!</p>"
        f"<p>Your verification code is <strong style='font-size:20px;letter-spacing:3px'>{escape(code)}</strong>.</p>"
        f"<p>It expires in {settings.OTP_TTL_MINUTES} minutes. If you didn't sign up, you can ignore this email.</p>"
    )
    return send_html_email(user.email, f"Your {SIGNATURE} verification code", html, f"Your verification code is {code}")


def send_password_reset_email(user, token, invited=False):
    link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    if invited:
        subject = f"You've been invited to {SIGNATURE}"
        lead = f"<p>You've been invited to join {SIGNATURE}. Set your password to activate your account:</p>"
    else:
        subject = f"Reset your {SIGNATURE} password"
        lead = "<p>We received a request to reset your password. Use the link below to choose a new one:</p>"
    html = f"{lead}<p><a href='{escape(link)}'>{escape(link)}</a></p><p>If you didn't request this, ignore this email.</p>"
    return send_html_email(user.email, subject, html, f"{link}")


def send_vendor_employee_invite_email(email, employee_name, vendor_name):
    from urllib.parse import urlencode

    link = f"{settings.FRONTEND_URL}/register?{urlencode({'email': email})}"
    html = (
        f"<p>Hello {escape(employee_name)},</p>"
        f"<p>{escape(vendor_name)} invited you to join their vendor team on {SIGNATURE}.</p>"
        "<p>Create your account using this invited email address. Your vendor must approve your access "
        "before you can use the vendor workspace.</p>"
        f"<p><a href='{escape(link)}'>Create your account</a></p>"
    )
    text = (
        f"{vendor_name} invited you to join their vendor team on {SIGNATURE}. "
        f"Create your account using {email}: {link}"
    )
    return send_html_email(email, f"Vendor team invitation to {SIGNATURE}", html, text)
