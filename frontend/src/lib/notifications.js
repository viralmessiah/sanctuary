import { api } from "@/api/client";

/**
 * Creates an in-app notification for a specific user.
 * @param {string} userId
 * @param {{ title: string, message: string, type?: string, link?: string }} notif
 */
export async function createNotification(userId, { title, message, type = "system", link }) {
  if (!userId || !title || !message) return;
  try {
    await api.entities.Notification.create({
      user_id: userId,
      title,
      message,
      type,
      link,
      read: false,
    });
  } catch (_) {
    // Notification failures should never block the main workflow
  }
}

/**
 * Creates an in-app notification and sends an email to the user.
 * @param {string} userId
 * @param {string} email
 * @param {{ title: string, message: string, type?: string, link?: string }} notif
 */
export async function notifyUser(userId, email, { title, message, type = "system", link }) {
  await createNotification(userId, { title, message, type, link });
  if (!email) return;
  try {
    await api.integrations.Core.SendEmail({
      to: email,
      subject: title,
      html: `<p>${message}</p>\n<p style="color:#888;font-size:12px;">— Sanctuary AgriConnect</p>`,
    });
  } catch (_) {
    // Email failures should not block the workflow
  }
}