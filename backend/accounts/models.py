import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email, password, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, role=User.ROLE_ADMIN)
        return self._create(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    ROLE_ADMIN = "admin"
    ROLE_USER = "user"
    ROLE_CHOICES = [(ROLE_ADMIN, "admin"), (ROLE_USER, "user")]
    USER_TYPE_CHOICES = [(t, t) for t in (
        "farmer", "vendor", "buyer", "field_officer", "loan_officer", "insurer", "credit_bureau",
        "agronomist", "warehouse_logistics", "cooperative", "mobile_money", "compliance",
        "collections", "support_desk",
    )]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=ROLE_USER)
    user_type = models.CharField(max_length=20, choices=USER_TYPE_CHOICES, blank=True)
    # Free-form server-managed attributes (e.g. employer_vendor_id for vendor employees).
    data = models.JSONField(default=dict, blank=True)

    is_active = models.BooleanField(default=True)  # False until the email OTP is verified
    is_staff = models.BooleanField(default=False)  # Django admin access; kept in sync with role
    created_date = models.DateTimeField(default=timezone.now)

    # Email verification (registration) one-time code
    otp_hash = models.CharField(max_length=128, blank=True)
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    otp_attempts = models.PositiveSmallIntegerField(default=0)

    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        ordering = ["-created_date"]

    def save(self, *args, **kwargs):
        self.email = self.email.lower()
        if self.is_superuser:
            self.role = self.ROLE_ADMIN
        if self.role == self.ROLE_ADMIN:
            self.is_staff = True
        super().save(*args, **kwargs)

    @property
    def is_admin(self):
        return self.role == self.ROLE_ADMIN

    def __str__(self):
        return self.email


class AuthToken(models.Model):
    """API session token. Only the SHA-256 of the key is stored, so a database leak doesn't leak sessions.
    A user can hold several (one per device/login)."""

    key_hash = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="auth_tokens")
    created = models.DateTimeField(default=timezone.now)

    @staticmethod
    def hash_key(key):
        import hashlib

        return hashlib.sha256(key.encode()).hexdigest()

    @classmethod
    def issue(cls, user):
        import secrets

        key = secrets.token_hex(32)
        cls.objects.create(key_hash=cls.hash_key(key), user=user)
        return key
