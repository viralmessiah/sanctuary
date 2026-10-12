import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const purposes = [
  ["credit_bureau", "Credit bureau", "Share financing and ledger records with an approved credit bureau."],
  ["insurance", "Insurance", "Share crop-failure case information with an approved insurer."],
  ["field_monitoring", "Agronomy and field monitoring", "Share crop visit, GPS and harvest records with an approved agronomist."],
  ["logistics", "Warehouse and logistics", "Share delivery and grading information with an approved logistics partner."],
  ["cooperative", "Cooperative", "Share your farmer profile with your approved cooperative."],
  ["mobile_money", "Mobile money", "Share payment tranche and ledger records with an approved mobile-money partner."],
  ["sms_notifications", "SMS notifications", "Record your opt-in for future SMS notifications. SMS delivery requires a configured gateway."],
];

export default function LegalCenter() {
  const location = useLocation();
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const mode = location.pathname === "/terms" ? "terms" : location.pathname === "/privacy" ? "privacy" : "help";

  const load = async () => setRecords(await api.entities.ConsentRecord.list("-created_date", 500));
  useEffect(() => {
    if (mode !== "privacy") { setLoading(false); return; }
    load().catch((err) => setError(err.message || "Could not load your consent settings."))
      .finally(() => setLoading(false));
  }, [mode, user?.id]);

  const latest = new Map();
  [...records].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")).forEach((item) => {
    if (!latest.has(item.consent_type)) latest.set(item.consent_type, item);
  });

  const changeConsent = async (consentType) => {
    const active = latest.get(consentType)?.granted === true;
    setBusy(consentType); setError(""); setNotice("");
    try {
      await api.entities.ConsentRecord.create({
        consenting_user_id: user.id,
        consent_type: consentType,
        granted: !active,
        text_version: "v1",
        scope: { purpose: purposes.find(([key]) => key === consentType)?.[2] || "" },
      });
      await load();
      setNotice(active ? "Consent revoked. New partner queries are denied." : "Consent recorded. Approved partners may only access records for this purpose.");
    } catch (err) { setError(err.message || "Could not save the consent choice."); }
    finally { setBusy(""); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-3xl space-y-5">
      {mode === "terms" && <>
        <h1 className="text-2xl font-semibold text-slate-900">Financing terms</h1>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">These platform terms are an implementation draft and require review by qualified local counsel before production use.</p>
        <Section title="Buyer-backed financing">A financing request must reference an active offtake contract with the buyer named on that contract. No funds are released unless the farmer, buyer and active loan officer have signed, the buyer has accepted the guarantee, and the farmer has signed the disclosed financing agreement.</Section>
        <Section title="Interest and repayment">The projected schedule uses non-compounding simple monthly interest on outstanding principal at the rate displayed in the signed agreement. Interest accrues monthly on principal actually released; tranche timing and repayments can change the actual balance. The signed schedule is a projection.</Section>
        <Section title="Buyer withholding">The configured percentage (initially 20%) is withheld from gross proceeds on eligible contracted crop sales and applied to the outstanding loan. Per-sale and total-guarantee limits are set by administrators. Any proceeds left after remittance belong to the farmer, subject to the sale agreement.</Section>
        <Section title="Problems and remedies">Farmers may report crop failure, buyer default, side-selling concerns, delivery disputes or restructuring requests. A case is not approved until reviewed. Write-offs and restructures require authorized approval and an auditable ledger entry.</Section>
        <Section title="Records">Financial releases, repayments, interest, adjustments and write-offs are recorded in an append-only ledger. Partner access is limited by role and purpose-specific consent.</Section>
      </>}
      {mode === "privacy" && <>
        <h1 className="text-2xl font-semibold text-slate-900">Privacy & consent</h1>
        <p className="text-sm text-slate-600">Consent is optional, purpose-specific and revocable. A new consent record is created for every change; revocation prevents new partner queries. Existing lawful records are retained for audit and legal requirements.</p>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <div className="space-y-3">
          {purposes.map(([key, label, description]) => {
            const allowed = latest.get(key)?.granted === true;
            return <section key={key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div><h2 className="text-sm font-medium text-slate-900">{label}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>
              <Button disabled={busy === key} variant={allowed ? "outline" : "default"} className={allowed ? "" : "bg-emerald-800 hover:bg-emerald-900"} onClick={() => changeConsent(key)}>{busy === key ? "Saving…" : allowed ? "Revoke consent" : "Grant consent"}</Button>
            </section>;
          })}
        </div>
      </>}
      {mode === "help" && <>
        <h1 className="text-2xl font-semibold text-slate-900">Help centre</h1>
        <div className="space-y-3">
          <Section title="Apply for financing">Create an offtake contract with a buyer, request financing from an order, wait for loan-officer review, then read and acknowledge the full schedule before signing.</Section>
          <Section title="Delivery and repayment">The buyer records delivery quantity and grade. The platform calculates the configured withholding against sale value and outstanding balance. Administrators reconcile the buyer's remittance before it posts to your loan ledger.</Section>
          <Section title="USSD access">The server supports an authenticated USSD gateway callback for loan balance lookup and complaint submission. A deployment must configure `USSD_GATEWAY_TOKEN` and a provider callback before publishing its short code. Do not share loan data over unauthenticated SMS.</Section>
          <Section title="SMS">Outbound SMS delivery is not active until an SMS gateway and credentials are configured. You can record an opt-in under <Link className="text-emerald-800 underline" to="/privacy">Privacy & consent</Link>; an opt-in does not itself enable a provider.</Section>
          <Section title="Complaints">Use the independent <Link className="text-emerald-800 underline" to="/complaints">complaints channel</Link> for service, harassment, fraud, privacy or delivery issues. Complaints are not routed to loan officers.</Section>
          <Section title="Need an agent?">Contact your cooperative or platform support team. Avoid sending identity documents or account credentials over public channels.</Section>
        </div>
      </>}
    </div>
  );
}

function Section({ title, children }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-medium text-slate-900">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{children}</p></section>;
}
