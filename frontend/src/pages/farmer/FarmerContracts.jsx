import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { FileText, Loader2, Plus } from "lucide-react";

export default function FarmerContracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ crop: "", quantity: "", unit: "bags", price_per_unit: "", delivery_schedule: "", delivery_location: "" });

  const load = async () => {
    const [c, b] = await Promise.all([
      api.entities.OfftakeContract.filter({ farmer_user_id: user.id }, "-created_date", 200),
      api.entities.BuyerProfile.filter({ status: "active" }, "-created_date", 200),
    ]);
    setContracts(c);
    setBuyers(b);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const requestContract = async (e) => {
    e.preventDefault();
    setBusy(true);
    const buyer = buyers[0];
    if (!buyer) { setBusy(false); return; }
    const contractNumber = `OFC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const total = (Number(form.quantity) || 0) * (Number(form.price_per_unit) || 0);
    await api.entities.OfftakeContract.create({
      contract_number: contractNumber, farmer_user_id: user.id, farmer_name: user.full_name || user.email,
      buyer_user_id: buyer.created_by_id, buyer_name: buyer.business_name, crop: form.crop,
      quantity: Number(form.quantity), unit: form.unit, price_per_unit: Number(form.price_per_unit),
      total_value: total, delivery_schedule: form.delivery_schedule, delivery_location: form.delivery_location,
      initiated_by: "farmer", status: "draft",
    });
    setShowForm(false);
    setForm({ crop: "", quantity: "", unit: "bags", price_per_unit: "", delivery_schedule: "", delivery_location: "" });
    setBusy(false);
    load();
  };

  const signContract = async (c) => {
    setBusy(true);
    await api.entities.OfftakeContract.update(c.id, { farmer_signed_at: new Date().toISOString() });
    setBusy(false);
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const pending = contracts.filter((c) => c.status === "draft" || c.status === "pending_signature");
  const active = contracts.filter((c) => c.status === "active" || c.status === "fulfilled");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Offtake Contracts</h1>
          <p className="text-slate-500 text-sm mt-1">Contract with buyers to secure a market for your harvest.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-emerald-800 hover:bg-emerald-900"><Plus className="w-4 h-4 mr-1" /> Request Buyer</Button>
      </div>

      {showForm && (
        <form onSubmit={requestContract} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Crop *</Label><Input required value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Quantity *</Label><Input type="number" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Price per Unit (KES)</Label><Input type="number" value={form.price_per_unit} onChange={(e) => setForm({ ...form, price_per_unit: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Expected Delivery Date</Label><Input type="date" value={form.delivery_schedule} onChange={(e) => setForm({ ...form, delivery_schedule: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Delivery Location</Label><Input value={form.delivery_location} onChange={(e) => setForm({ ...form, delivery_location: e.target.value })} /></div>
          </div>
          {buyers.length === 0 && <p className="text-sm text-amber-600">No active buyers yet. Your request will be queued.</p>}
          <Button type="submit" disabled={busy} className="bg-emerald-800 hover:bg-emerald-900">{busy ? "Submitting..." : "Submit Contract Request"}</Button>
        </form>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Pending ({pending.length})</h2>
          {pending.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div><p className="font-medium text-slate-900">{c.contract_number}</p><p className="text-xs text-slate-400">{c.buyer_name} · {c.crop} · {c.quantity} {c.unit}</p></div>
                <StatusBadge status={c.status} />
              </div>
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <div><span className="text-slate-400">Price/unit:</span> KES {c.price_per_unit?.toLocaleString()}</div>
                <div><span className="text-slate-400">Total:</span> KES {c.total_value?.toLocaleString()}</div>
                <div><span className="text-slate-400">Delivery:</span> {c.delivery_schedule ? new Date(c.delivery_schedule).toLocaleDateString() : "TBD"}</div>
              </div>
              {c.status === "pending_signature" && <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" disabled={busy} onClick={() => signContract(c)}>E-Sign Contract</Button>}
            </div>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Active ({active.length})</h2>
          {active.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center justify-between">
              <div><p className="font-medium text-slate-900">{c.contract_number}</p><p className="text-xs text-slate-400">{c.buyer_name} · {c.crop} · {c.quantity} {c.unit} · KES {c.total_value?.toLocaleString()}</p></div>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                {c.status === "active" && !c.farmer_signed_at && <Button size="sm" disabled={busy} onClick={() => signContract(c)}>E-Sign Contract</Button>}
                {c.farmer_signed_at && <span className="text-xs text-emerald-700">Signed</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length === 0 && active.length === 0 && <EmptyState icon={FileText} title="No contracts yet" description="Request a buyer to secure a market for your harvest before ordering inputs." />}
    </div>
  );
}