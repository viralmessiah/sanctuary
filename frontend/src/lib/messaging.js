import { api } from "@/api/client";

export async function startConversation(recipientId, recipientName) {
  const me = await api.auth.me();
  const conversations = await api.entities.Conversation.list("-created_date", 500);
  const existing = conversations.find(
    (c) => (c.user1_id === me.id && c.user2_id === recipientId) ||
           (c.user1_id === recipientId && c.user2_id === me.id)
  );
  if (existing) return existing;
  return await api.entities.Conversation.create({
    user1_id: me.id,
    user1_name: me.full_name || me.email,
    user2_id: recipientId,
    user2_name: recipientName,
    last_message: "",
    last_message_date: new Date().toISOString(),
  });
}

export async function startConversationByUser(userId) {
  return api.messaging.startConversation(userId);
}