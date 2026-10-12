import asyncio
from datetime import timedelta

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.utils import timezone

from accounts.models import AuthToken


class MessagingConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user_group = None
        self.auth_timeout = asyncio.create_task(self._close_if_unauthenticated())
        await self.accept()

    async def disconnect(self, close_code):
        if self.auth_timeout:
            self.auth_timeout.cancel()
        if self.user_group:
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if self.user_group:
            await self.close(code=4400)
            return
        if content.get("type") != "authenticate" or not isinstance(content.get("token"), str):
            await self.close(code=4401)
            return

        user_id = await self._get_user_id(content["token"])
        if not user_id:
            await self.close(code=4401)
            return

        self.user_group = f"user_{user_id.replace('-', '')}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        self.auth_timeout.cancel()
        await self.send_json({"type": "authenticated"})

    async def message_created(self, event):
        await self.send_json(event["payload"])

    async def _close_if_unauthenticated(self):
        await asyncio.sleep(10)
        if not self.user_group:
            await self.close(code=4401)

    @database_sync_to_async
    def _get_user_id(self, token):
        if not token or len(token) > 256:
            return None
        record = AuthToken.objects.filter(
            key_hash=AuthToken.hash_key(token),
            created__gte=timezone.now() - timedelta(days=settings.TOKEN_TTL_DAYS),
            user__is_active=True,
        ).values_list("user_id", flat=True).first()
        return str(record) if record else None
