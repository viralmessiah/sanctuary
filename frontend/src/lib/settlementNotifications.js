import { api } from "@/api/client";
import { createNotification } from "@/lib/notifications";

/**
 * Looks up the vendor by business name and sends a settlement notification
 * (in-app + email).
 * @param {object} settlement - The settlement record
 * @param {"approved"|"paid"} eventType
 */
export async function notifySettlementUpdate(settlement, eventType) {
  if (!settlement?.vendor_name) return;
  try {
    const vendors = await api.entities.VendorProfile.filter(
      { business_name: settlement.vendor_name },
      "-created_date",
      1
    );
    const vendor = vendors[0];
    const email = vendor?.email;
    const vendorUserId = vendor?.created_by_id;

    const title = eventType === "approved"
      ? "Settlement Claim Approved"
      : "Settlement Payment Completed";
    const message = eventType === "approved"
      ? `Your settlement claim of KES ${settlement.amount?.toLocaleString()} has been approved. A payment notification will follow once the payout is processed.`
      : `Your settlement of KES ${settlement.amount?.toLocaleString()} has been paid out. Payment reference: ${settlement.payment_reference || "N/A"}.`;

    if (vendorUserId) {
      await createNotification(vendorUserId, {
        title,
        message,
        type: "settlement",
        link: "/vendor/settlements",
      });
    }

    if (!email) return;

    if (eventType === "approved") {
      await api.integrations.Core.SendEmail({
        to: email,
        subject: title,
        html: `<p>Hi ${vendor.business_name},</p>
<p>Your settlement claim of <strong>KES ${settlement.amount?.toLocaleString()}</strong> has been <strong>approved</strong>.</p>
<p>You will receive a payment notification once the payout is processed.</p>
<p>— Sanctuary AgriConnect</p>`,
      });
    } else if (eventType === "paid") {
      await api.integrations.Core.SendEmail({
        to: email,
        subject: title,
        html: `<p>Hi ${vendor.business_name},</p>
<p>Your settlement of <strong>KES ${settlement.amount?.toLocaleString()}</strong> has been <strong>paid out</strong>.</p>
<p>Payment reference: <strong>${settlement.payment_reference || "N/A"}</strong></p>
<p>— Sanctuary AgriConnect</p>`,
      });
    }
  } catch (_) {
    // Notification failures should not block the settlement workflow
  }
}