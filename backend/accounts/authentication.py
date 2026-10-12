from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import AuthToken


class ExpiringTokenAuthentication(TokenAuthentication):
    """`Authorization: Bearer <token>`; tokens live TOKEN_TTL_DAYS and are stored hashed."""

    keyword = "Bearer"

    def authenticate_credentials(self, key):
        try:
            token = AuthToken.objects.select_related("user").get(key_hash=AuthToken.hash_key(key))
        except AuthToken.DoesNotExist:
            raise AuthenticationFailed("Invalid token.")
        if token.created < timezone.now() - timedelta(days=settings.TOKEN_TTL_DAYS):
            token.delete()
            raise AuthenticationFailed("Session expired. Please log in again.")
        if not token.user.is_active:
            raise AuthenticationFailed("Account is inactive.")
        return token.user, token
