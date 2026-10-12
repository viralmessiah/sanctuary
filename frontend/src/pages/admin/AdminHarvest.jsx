import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Sprout, Loader2 } from "lucide-react";

export default function AdminHarvest() {
  const [harvests, setHarvests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});

  const load = async () => {
    const h = await api.entities.Harvest.list("-created_date", 200);
    setHarvests(h);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const recordValuation = async (h) => {
    const d = drafts[h.id] || {};
    await api.entities.Harvest.update(h.id, {
      actual_quantity: d.actual_quantity ? Number(d.actual_quantity) : h.actual_quantity,
      valuation: d.valuation ? Number(d.valuation) : h.valuation,
      agreed_share_amount: d.agreed_share_amount ? Number(d.agreed_share_amount) : h.agreed_share_amount,
      settlement_status: "valued",
    });
    await load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Harvest & Recovery</h1>
      {harvests.length === 0 ? (
        <EmptyState icon={Sprout} title="No harvest cycles recorded" description="Farmers' crop cycles will appear here as they're tracked." />
      ) : (
        <div className="space-y-3">
          {harvests.map((h) => (
            <div key={h.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{h.crop}</p>
                  <p className="text-xs text-slate-400">
                    Expected {h.expected_quantity ? `${h.expected_quantity} ${h.unit}` : "—"}
                    {h.actual_quantity ? ` · Actual ${h.actual_quantity} ${h.unit}` : ""}
                    {h.agreed_share_amount ? ` · Agreed Share KES ${h.agreed_share_amount.toLocaleString()}` : ""}
                  </p>
                </div>
                <StatusBadge status={h.settlement_status} />
              </div>
              {h.settlement_status !== "settled" && h.settlement_status !== "closed" && (
                <div className="grid sm:grid-cols-3 gap-2">
                  <Input placeholder="Actual quantity" type="number" onChange={(e) => setDrafts({ ...drafts, [h.id]: { ...drafts[h.id], actual_quantity: e.target.value } })} />
                  <Input placeholder="Valuation (KES)" type="number" onChange={(e) => setDrafts({ ...drafts, [h.id]: { ...drafts[h.id], valuation: e.target.value } })} />
                  <Input placeholder="Agreed share (KES)" type="number" onChange={(e) => setDrafts({ ...drafts, [h.id]: { ...drafts[h.id], agreed_share_amount: e.target.value } })} />
                </div>
              )}
              <div className="flex items-center gap-2">
                {h.settlement_status !== "settled" && h.settlement_status !== "closed" && (
                  <Button size="sm" variant="outline" onClick={() => recordValuation(h)}>Record Valuation</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}