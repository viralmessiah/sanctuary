import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { FileText, Loader2, Check, X } from "lucide-react";

export default function BuyerContracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const c = await api.entities.OfftakeContract.filter({ buyer_user_id: user.id }, "-created_date", 200);
    setContracts(c);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const accept = async (c) => {
    setBusy(true);
    await api.entities.OfftakeContract.update(c.id, { status: "active", signed_at: new Date().toISOString() });
    await api.entities.AuditLog.create({ action: "CONTRACT_ACCEPTED", entity_type: "OfftakeContract", entity_id: c.id });
    setBusy(false);
    load();
  };

  const reject = async (c) => {
    setBusy(true);
    await api.entities.OfftakeContract.update(c.id, { status: "terminated" });
    await api.entities.AuditLog.create({ action: "CONTRACT_REJECTED", entity_type: "OfftakeContract", entity_id: c.id });
    setBusy(false);
    load();
  };

  const acceptGuarantee = async (c) => {
    setBusy(true);
    try {
      await api.entities.OfftakeContract.update(c.id, { buyer_guarantee_accepted_at: new Date().toISOString() });
      await api.entities.AuditLog.create({ action: "BUYER_GUARANTEE_ACCEPTED", entity_type: "OfftakeContract", entity_id: c.id });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const pending = contracts.filter((c) => c.status === "draft" || c.status === "pending_signature");
  const active = contracts.filter((c) => c.status === "active" || c.status === "fulfilled");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Offtake Contracts</h1>
        <p className="text-slate-500 text-sm mt-1">Review contract requests from farmers and manage active contracts.</p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Pending Requests ({pending.length})</h2>
          {pending.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{c.contract_number}</p>
                  <p className="text-xs text-slate-400">{c.farmer_name} · {c.crop} · {c.quantity} {c.unit}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <div><span className="text-slate-400">Price/unit:</span> KES {c.price_per_unit?.toLocaleString()}</div>
                <div><span className="text-slate-400">Total:</span> KES {c.total_value?.toLocaleString()}</div>
                <div><span className="text-slate-400">Delivery:</span> {c.delivery_schedule ? new Date(c.delivery_schedule).toLocaleDateString() : "TBD"}</div>
              </div>
              <p className="text-xs text-slate-500">
                Farmer: {c.farmer_signed_at ? "signed" : "awaiting signature"} · Loan officer: {c.loan_officer_signed_at ? "signed" : "awaiting signature"}
              </p>
              {c.status === "active" && c.farmer_signed_at && c.loan_officer_signed_at && (
                c.buyer_guarantee_accepted_at ? (
                  <p className="text-sm text-emerald-700">Guarantee accepted on {new Date(c.buyer_guarantee_accepted_at).toLocaleDateString()}.</p>
                ) : (
                  <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" disabled={busy} onClick={() => acceptGuarantee(c)}>
                    Accept buyer guarantee
                  </Button>
                )
              )}
              <div className="flex gap-2">
                {c.status !== "active" && <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" disabled={busy} onClick={() => accept(c)}><Check className="w-4 h-4" /> Accept & Sign</Button>}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => reject(c)}><X className="w-4 h-4" /> Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {active.length === 0 && pending.length === 0 ? (
        <EmptyState icon={FileText} title="No contracts yet" description="Farmers will send you contract requests once your profile is active." />
      ) : active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Active Contracts ({active.length})</h2>
          {active.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{c.contract_number}</p>
                  <p className="text-xs text-slate-400">{c.farmer_name} · {c.crop} · {c.quantity} {c.unit} · KES {c.total_value?.toLocaleString()}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}