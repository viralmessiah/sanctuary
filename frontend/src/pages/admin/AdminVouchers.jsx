import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Ticket, Loader2 } from "lucide-react";

export default function AdminVouchers() {
  const [tokens, setTokens] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refs, setRefs] = useState({});
  const [error, setError] = useState("");

  const load = async () => {
    const [v, s] = await Promise.all([
      api.entities.Voucher.list("-created_date", 200),
      api.entities.Settlement.list("-created_date", 200),
    ]);
    setTokens(v);
    setSettlements(s);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const approveSettlement = async (s) => {
    setError("");
    try {
      await api.entities.Settlement.update(s.id, { status: "approved", approval_date: new Date().toISOString() });
      await api.entities.AuditLog.create({ action: "SETTLEMENT_APPROVED", entity_type: "Settlement", entity_id: s.id });
      await load();
    } catch (err) { setError(err.message || "Could not approve settlement."); }
  };

  const markPaid = async (s) => {
    if (s.offtake_contract_id) {
      setError("Buyer-backed sale proceeds must be reconciled from buyer evidence and independently verified.");
      return;
    }
    const payment_reference = refs[s.id] || `PMT-${Date.now()}`;
    setError("");
    try {
      const payload = { status: "paid", payment_date: new Date().toISOString(), payment_reference };
      await api.entities.Settlement.update(s.id, payload);
      if (s.voucher_id) await api.entities.Voucher.update(s.voucher_id, { status: "settled" });
      await api.entities.AuditLog.create({ action: "PAYMENT_COMPLETED", entity_type: "Settlement", entity_id: s.id });
      await load();
    } catch (err) { setError(err.message || "Could not reconcile remittance."); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Tokens & Settlements</h1>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Tabs defaultValue="tokens">
        <TabsList>
          <TabsTrigger value="tokens">Tokens ({tokens.length})</TabsTrigger>
          <TabsTrigger value="settlements">Settlements ({settlements.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens" className="mt-4">
          {tokens.length === 0 ? <EmptyState icon={Ticket} title="No tokens issued yet" /> : (
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
              {tokens.map((v) => (
                <div key={v.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-mono text-slate-900">{v.voucher_code}</p>
                    <p className="text-xs text-slate-400">{v.vendor_name} · KES {v.total_value?.toLocaleString()}</p>
                  </div>
                  <StatusBadge status={v.status} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="settlements" className="mt-4 space-y-3">
          {settlements.length === 0 ? <EmptyState icon={Ticket} title="No settlement claims yet" /> : settlements.map((s) => (
            <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">KES {s.amount?.toLocaleString()}</p>
                  <p className="text-xs text-slate-400">{s.buyer_name || s.vendor_name} · {s.delivery_quantity ? `${s.delivery_quantity} ${s.unit || "units"}` : `Claimed ${new Date(s.claim_date || s.created_date).toLocaleDateString()}`}</p>
                  {s.offtake_contract_id && <div className="mt-1 space-y-1 text-xs text-slate-500">
                    <p>Gross sale {Number(s.gross_sale_amount || 0).toLocaleString()} · {s.delivery_quantity} {s.unit || "units"} × {Number(s.price_per_unit || 0).toLocaleString()} per unit (contract price) · {s.crop_grade?.replaceAll("_", " ") || "grade missing"}</p>
                    <p>Withholding due {Number(s.buyer_withholding_amount || 0).toLocaleString()} · reported {Number(s.buyer_remitted_amount || 0).toLocaleString()} · verified {Number(s.buyer_verified_received_amount || 0).toLocaleString()}</p>
                    {s.delivery_evidence_url && <a className="text-emerald-700 underline" href={s.delivery_evidence_url} target="_blank" rel="noreferrer">Review signed weigh ticket / warehouse receipt</a>}
                  </div>}
                </div>
                <StatusBadge status={s.status} />
              </div>
              {s.status === "pending_review" && (
                <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => approveSettlement(s)}>Approve Claim</Button>
              )}
              {s.status === "approved" && s.offtake_contract_id && (
                <p className="text-xs text-slate-500">
                  Buyer withholding due {Number(s.buyer_withholding_amount || 0).toLocaleString()} · reported {Number(s.buyer_remitted_amount || 0).toLocaleString()} · independently verified {Number(s.buyer_verified_received_amount || 0).toLocaleString()}. Review payment evidence under Portfolio Oversight; only a verified claim updates the loan ledger.
                </p>
              )}
              {s.status === "approved" && !s.offtake_contract_id && (
                <div className="flex items-center gap-2">
                  <Input placeholder="Payment reference" className="text-sm" value={refs[s.id] || ""} onChange={(e) => setRefs({ ...refs, [s.id]: e.target.value })} />
                  <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => markPaid(s)}>Mark Paid</Button>
                </div>
              )}
              {s.status === "paid" && <p className="text-xs text-emerald-700">Reference: {s.payment_reference}</p>}
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}