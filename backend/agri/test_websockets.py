from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings

from accounts.models import AuthToken, User
from config.asgi import application


@override_settings(ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class MessagingWebSocketTests(TransactionTestCase):
    def test_authenticated_user_receives_live_message_events(self):
        user = User.objects.create_user(
            "websocket@example.com",
            "safe-password",
            is_active=True,
        )
        token = AuthToken.issue(user)
        payload = {
            "type": "message.created",
            "message": {
                "id": "message-1",
                "conversation_id": "conversation-1",
                "content": "Hello in real time",
            },
        }

        async def exercise_socket():
            communicator = WebsocketCommunicator(
                application,
                "/ws/messages/",
                headers=[(b"origin", b"http://localhost")],
            )
            connected, details = await communicator.connect()
            self.assertTrue(connected, details)
            await communicator.send_json_to({"type": "authenticate", "token": token})
            self.assertEqual(await communicator.receive_json_from(), {"type": "authenticated"})

            await get_channel_layer().group_send(
                f"user_{str(user.pk).replace('-', '')}",
                {"type": "message.created", "payload": payload},
            )
            self.assertEqual(await communicator.receive_json_from(), payload)
            await communicator.disconnect()

        async_to_sync(exercise_socket)()

    def test_websocket_rejects_invalid_token(self):
        async def exercise_socket():
            communicator = WebsocketCommunicator(
                application,
                "/ws/messages/",
                headers=[(b"origin", b"http://localhost")],
            )
            connected, details = await communicator.connect()
            self.assertTrue(connected, details)
            await communicator.send_json_to({"type": "authenticate", "token": "invalid"})
            close_event = await communicator.receive_output()
            self.assertEqual(close_event["type"], "websocket.close")
            self.assertEqual(close_event["code"], 4401)

        async_to_sync(exercise_socket)()
