import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Truck, Loader2 } from "lucide-react";

export default function BuyerDeliveries() {
  const { user } = useAuth();
  const [harvests, setHarvests] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    const [h, s] = await Promise.all([
      api.entities.Harvest.filter({ buyer_user_id: user.id }, "-created_date", 200),
      api.entities.Settlement.filter({ buyer_user_id: user.id }, "-created_date", 200),
    ]);
    setHarvests(h);
    setSettlements(s);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const confirmDelivery = async (h) => {
    const e = edit[h.id] || {};
    setError(""); setNotice("");
    try {
      if (!e.delivery_evidence_file) {
        setError("Upload the signed weigh ticket or warehouse receipt before confirming delivery.");
        return;
      }
      const evidence = await api.integrations.Core.UploadPrivateFile({ file: e.delivery_evidence_file });
      const settlement = await api.entities.Settlement.create({
        harvest_id: h.id,
        offtake_contract_id: h.offtake_contract_id,
        buyer_user_id: user.id,
        buyer_name: h.buyer_name,
        farmer_user_id: h.created_by_id,
        crop_grade: e.crop_grade || h.crop_grade,
        delivery_quantity: Number(e.delivery_quantity) || h.actual_quantity,
        delivery_date: new Date().toISOString(),
        grading_notes: e.grading_notes || "",
        delivery_evidence_url: evidence.file_uri,
      });
      setEdit({ ...edit, [h.id]: undefined });
      setNotice(`Delivery recorded. Gross sale: KES ${Number(settlement.gross_sale_amount || 0).toLocaleString()}; withholding: KES ${Number(settlement.buyer_withholding_amount || 0).toLocaleString()}.`);
      await load();
    } catch (err) {
      setError(err.message || "Could not record the delivery. No settlement was created.");
    }
  };

  const submitPaymentClaim = async (settlement, paymentType) => {
    const key = `claim-${settlement.id}-${paymentType}`;
    const draft = edit[key] || {};
    setError(""); setNotice("");
    try {
      if (!draft.evidence_file) {
        setError("Upload transaction evidence before submitting the payment for verification.");
        return;
      }
      const evidence = await api.integrations.Core.UploadPrivateFile({ file: draft.evidence_file });
      await api.entities.SettlementReconciliation.create({
        settlement_id: settlement.id,
        payment_type: paymentType,
        amount: Number(draft.amount),
        external_reference: draft.external_reference,
        evidence_url: evidence.file_uri,
      });
      setEdit({ ...edit, [key]: undefined });
      setNotice("Payment evidence submitted. It will be credited only after an administrator independently verifies receipt.");
      await load();
    } catch (err) {
      setError(err.message || "Could not submit payment evidence.");
    }
  };

  const paymentClaimForm = (settlement, paymentType, due, reported, label) => {
    const key = `claim-${settlement.id}-${paymentType}`;
    const remaining = Math.max(Number(due || 0) - Number(reported || 0), 0);
    if (settlement.status !== "approved" || remaining <= 0) return null;
    const draft = edit[key] || {};
    return (
      <form key={key} onSubmit={(event) => { event.preventDefault(); submitPaymentClaim(settlement, paymentType); }} className="mt-3 grid gap-2 sm:grid-cols-2">
        <p className="text-xs text-slate-500 sm:col-span-2">{label}: {`KES ${remaining.toLocaleString()}`} remaining to report.</p>
        <Input required type="number" min="0.01" step="0.01" max={remaining} placeholder="Amount remitted" value={draft.amount || ""} onChange={(e) => setEdit({ ...edit, [key]: { ...draft, amount: e.target.value } })} />
        <Input required placeholder="Bank/mobile-money reference" value={draft.external_reference || ""} onChange={(e) => setEdit({ ...edit, [key]: { ...draft, external_reference: e.target.value } })} />
        <Input required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setEdit({ ...edit, [key]: { ...draft, evidence_file: e.target.files?.[0] } })} />
        <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900">Submit evidence for verification</Button>
      </form>
    );
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const ready = harvests.filter((h) => ["harvest_ready", "harvest_recorded"].includes(h.settlement_status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Deliveries & Settlement</h1>
        <p className="text-slate-500 text-sm mt-1">Receive, weigh, and grade crop deliveries from contracted farmers.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {ready.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Awaiting Delivery ({ready.length})</h2>
          {ready.map((h) => (
            <div key={h.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div><p className="font-medium text-slate-900">{h.crop}</p><p className="text-xs text-slate-400">{h.expected_quantity} {h.unit} expected</p></div>
                <StatusBadge status={h.settlement_status} />
              </div>
              {edit[h.id] ? (
                <div className="grid sm:grid-cols-3 gap-2">
                  <div><Label className="text-xs">Delivery Qty</Label><Input type="number" className="text-sm" value={edit[h.id].delivery_quantity || ""} onChange={(e) => setEdit({ ...edit, [h.id]: { ...edit[h.id], delivery_quantity: e.target.value } })} /></div>
                  <div><Label className="text-xs">Grade</Label><select className="w-full border border-slate-200 rounded-lg h-9 px-2 text-sm bg-white" value={edit[h.id].crop_grade || ""} onChange={(e) => setEdit({ ...edit, [h.id]: { ...edit[h.id], crop_grade: e.target.value } })}><option value="">Select</option><option value="grade_a">Grade A</option><option value="grade_b">Grade B</option><option value="grade_c">Grade C</option><option value="rejected">Rejected</option></select></div>
                  <div className="sm:col-span-2"><Label className="text-xs">Signed weigh ticket or warehouse receipt</Label><Input required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setEdit({ ...edit, [h.id]: { ...edit[h.id], delivery_evidence_file: e.target.files?.[0] } })} /></div>
                  <div className="flex items-end"><Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => confirmDelivery(h)}>Confirm Delivery & Calculate Withholding</Button></div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, [h.id]: {} })}>Receive & Grade</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {settlements.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Settlements ({settlements.length})</h2>
          {settlements.map((s) => (
          <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div><p className="font-medium text-slate-900">KES {Number(s.gross_sale_amount || s.amount || 0).toLocaleString()} gross</p><p className="text-xs text-slate-500">{s.buyer_name} · {s.delivery_quantity} {s.unit || "units"} · {s.crop_grade?.replaceAll("_", " ")}</p>
                {s.delivery_evidence_url && <a className="text-xs text-emerald-700 underline" href={s.delivery_evidence_url} target="_blank" rel="noreferrer">View delivery evidence</a>}
              </div>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
              <p>Withholding due: KES {Number(s.buyer_withholding_amount || 0).toLocaleString()}</p>
              <p>Buyer reported / verified: KES {Number(s.buyer_remitted_amount || 0).toLocaleString()} / {Number(s.buyer_verified_received_amount || 0).toLocaleString()}</p>
              <p>Farmer payment due / verified: KES {Number(s.farmer_payment_due_amount || 0).toLocaleString()} / {Number(s.farmer_payment_verified_amount || 0).toLocaleString()}</p>
            </div>
            {paymentClaimForm(s, "buyer_withholding", s.buyer_withholding_amount, s.buyer_remitted_amount, "Loan withholding")}
            {paymentClaimForm(s, "farmer_payment", s.farmer_payment_due_amount, s.farmer_payment_reported_amount, "Farmer sale proceeds")}
          </div>
          ))}
        </div>
      )}

      {ready.length === 0 && settlements.length === 0 && (
        <EmptyState icon={Truck} title="No deliveries yet" description="Crop deliveries from contracted farmers will appear here." />
      )}
    </div>
  );
}