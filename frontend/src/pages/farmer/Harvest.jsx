import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import HarvestYieldCharts from "@/components/farmer/HarvestYieldCharts";
import { Sprout, Loader2, Plus, ChevronDown, ChevronUp, Calendar, TrendingUp, Pencil, Check, AlertTriangle } from "lucide-react";

const STAGES = ["planned", "growing", "field_verified", "harvest_ready", "harvest_recorded", "valued", "delivered", "graded", "settled", "closed"];
const CROP_STAGES = ["land_preparation", "planting", "growing", "flowering", "maturation", "harvest_ready", "harvested"];
const RISK_ALERTS = ["none", "no_update", "poor_crop", "pest_infestation", "weather_risk"];

export default function Harvest() {
  const [harvests, setHarvests] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState({});
  const [form, setForm] = useState({ crop: "", expected_quantity: "", unit: "bags", farming_start_date: "", crop_duration_days: "", expected_harvest_date: "", offtake_contract_id: "" });

  const load = async () => {
    const [h, c] = await Promise.all([
      api.entities.Harvest.list("-created_date", 50),
      api.entities.OfftakeContract.filter({ status: "active" }),
    ]);
    setHarvests(h);
    setContracts(c);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createHarvest = async (e) => {
    e.preventDefault();
    setSaving(true);
    const contract = contracts.find((c) => c.id === form.offtake_contract_id);
    await api.entities.Harvest.create({
      crop: form.crop, expected_quantity: Number(form.expected_quantity) || undefined,
      unit: form.unit, farming_start_date: form.farming_start_date,
      crop_duration_days: Number(form.crop_duration_days),
      expected_harvest_date: form.expected_harvest_date,
      offtake_contract_id: form.offtake_contract_id || undefined,
      buyer_user_id: contract?.buyer_user_id, buyer_name: contract?.buyer_name,
      crop_stage: "planting", risk_alert: "none", settlement_status: "planned",
    });
    setShowForm(false);
    setForm({ crop: "", expected_quantity: "", unit: "bags", farming_start_date: "", crop_duration_days: "", expected_harvest_date: "", offtake_contract_id: "" });
    await load();
    setSaving(false);
  };

  const startEdit = (h) => {
    setEditing({
      [h.id]: {
        actual_quantity: h.actual_quantity || "", actual_harvest_date: h.actual_harvest_date || "",
        settlement_status: h.settlement_status, valuation: h.valuation || "",
        expected_quantity: h.expected_quantity || "", expected_harvest_date: h.expected_harvest_date || "",
        crop_stage: h.crop_stage || "planting", yield_estimate: h.yield_estimate || "", risk_alert: h.risk_alert || "none",
      },
    });
  };

  const saveEdit = async (h) => {
    const e = editing[h.id];
    await api.entities.Harvest.update(h.id, {
      actual_quantity: e.actual_quantity ? Number(e.actual_quantity) : undefined,
      actual_harvest_date: e.actual_harvest_date || undefined,
      settlement_status: e.settlement_status, valuation: e.valuation ? Number(e.valuation) : undefined,
      expected_quantity: e.expected_quantity ? Number(e.expected_quantity) : undefined,
      expected_harvest_date: e.expected_harvest_date || undefined,
      crop_stage: e.crop_stage, yield_estimate: e.yield_estimate ? Number(e.yield_estimate) : undefined,
      risk_alert: e.risk_alert, last_update_date: new Date().toISOString(),
    });
    setEditing({});
    await load();
  };

  const progressPercent = (h) => {
    const idx = STAGES.indexOf(h.settlement_status);
    return Math.round(((idx + 1) / STAGES.length) * 100);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Harvest & Crop Monitoring</h1>
          <p className="text-slate-500 text-sm mt-1">Track crop cycles, monitor progress, and manage delivery toward settlement.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-emerald-800 hover:bg-emerald-900"><Plus className="w-4 h-4 mr-1" /> New Crop Cycle</Button>
      </div>

      {showForm && (
        <form onSubmit={createHarvest} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Crop</Label><Input required value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })} placeholder="Maize" /></div>
            <div className="space-y-1.5"><Label>Linked Contract</Label><select className="w-full border border-slate-200 rounded-lg h-10 px-3 text-sm bg-white" value={form.offtake_contract_id} onChange={(e) => setForm({ ...form, offtake_contract_id: e.target.value })}><option value="">None</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number} — {c.buyer_name}</option>)}</select></div>
            <div className="space-y-1.5"><Label>Expected Quantity</Label><Input type="number" value={form.expected_quantity} onChange={(e) => setForm({ ...form, expected_quantity: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Farming Start Date *</Label><Input type="date" required value={form.farming_start_date} onChange={(e) => setForm({ ...form, farming_start_date: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Normal Crop Duration (days) *</Label><Input type="number" min="1" required value={form.crop_duration_days} onChange={(e) => setForm({ ...form, crop_duration_days: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Expected Harvest Date *</Label><Input type="date" required value={form.expected_harvest_date} onChange={(e) => setForm({ ...form, expected_harvest_date: e.target.value })} /></div>
          </div>
          <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">Save Crop Cycle</Button>
        </form>
      )}

      {harvests.length === 0 ? (
        <EmptyState icon={Sprout} title="No harvest records yet" description="Track your crop cycles as they progress toward settlement." />
      ) : (
        <div className="space-y-6">
          <HarvestYieldCharts harvests={harvests} />
          <div className="space-y-3">
            {harvests.map((h) => {
              const isEditing = !!editing[h.id];
              const e = editing[h.id] || {};
              const isOpen = expanded === h.id;
              const cycleProgress = h.farming_start_date && h.crop_duration_days
                ? Math.min(100, Math.max(0, Math.round(((Date.now() - new Date(`${h.farming_start_date}T00:00:00`).getTime()) / (Number(h.crop_duration_days) * 86400000)) * 100)))
                : null;
              return (
                <div key={h.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="p-4 cursor-pointer" onClick={() => setExpanded(isOpen ? null : h.id)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{h.crop}</p>
                          <StatusBadge status={h.settlement_status} />
                          {h.risk_alert && h.risk_alert !== "none" && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                          {h.expected_quantity && <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {h.expected_quantity} {h.unit} expected</span>}
                          {h.actual_quantity != null && <span className="flex items-center gap-1 text-emerald-700"><Check className="w-3 h-3" /> {h.actual_quantity} {h.unit} actual</span>}
                          {h.expected_harvest_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(h.expected_harvest_date).toLocaleDateString()}</span>}
                          {h.buyer_name && <span className="text-slate-400">→ {h.buyer_name}</span>}
                        </div>
                        {cycleProgress !== null && (
                          <div className="mt-3 max-w-xl">
                            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                              <span>Crop cycle progress</span>
                              <span>{cycleProgress}% · {h.crop_duration_days} day cycle</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${cycleProgress}%` }} /></div>
                            <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>Start {new Date(`${h.farming_start_date}T00:00:00`).toLocaleDateString()}</span><span>Expected {new Date(`${h.expected_harvest_date}T00:00:00`).toLocaleDateString()}</span></div>
                          </div>
                        )}
                      </div>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        {STAGES.map((s, i) => (<span key={s} className={i <= STAGES.indexOf(h.settlement_status) ? "text-emerald-700 font-medium" : ""}>{s.replace(/_/g, " ")}</span>))}
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-600 rounded-full transition-all" style={{ width: `${progressPercent(h)}%` }} /></div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50">
                      {isEditing ? (
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5"><Label className="text-xs">Expected Quantity</Label><Input type="number" value={e.expected_quantity} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, expected_quantity: ev.target.value } })} /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Actual Quantity</Label><Input type="number" value={e.actual_quantity} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, actual_quantity: ev.target.value } })} placeholder="Record yield" /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Expected Harvest Date</Label><Input type="date" value={e.expected_harvest_date} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, expected_harvest_date: ev.target.value } })} /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Actual Harvest Date</Label><Input type="date" value={e.actual_harvest_date} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, actual_harvest_date: ev.target.value } })} /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Valuation (KES)</Label><Input type="number" value={e.valuation} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, valuation: ev.target.value } })} placeholder="Harvest value" /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Crop Stage</Label><select className="w-full border border-slate-200 rounded-lg h-9 px-3 text-sm bg-white" value={e.crop_stage} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, crop_stage: ev.target.value } })}>{CROP_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
                          <div className="space-y-1.5"><Label className="text-xs">Yield Estimate</Label><Input type="number" value={e.yield_estimate} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, yield_estimate: ev.target.value } })} /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Risk Alert</Label><select className="w-full border border-slate-200 rounded-lg h-9 px-3 text-sm bg-white" value={e.risk_alert} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, risk_alert: ev.target.value } })}>{RISK_ALERTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
                          <div className="space-y-1.5"><Label className="text-xs">Stage</Label><select className="w-full border border-slate-200 rounded-lg h-9 px-3 text-sm bg-white" value={e.settlement_status} onChange={(ev) => setEditing({ ...editing, [h.id]: { ...e, settlement_status: ev.target.value } })}>{STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
                          <div className="sm:col-span-2 flex gap-2">
                            <Button size="sm" onClick={() => saveEdit(h)} className="bg-emerald-800 hover:bg-emerald-900"><Check className="w-4 h-4" /> Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditing({})}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-4 text-sm">
                          {h.valuation != null && <div><span className="text-slate-400 text-xs">Valuation:</span> <span className="font-medium text-slate-900">KES {h.valuation?.toLocaleString()}</span></div>}
                          {h.crop_stage && <div><span className="text-slate-400 text-xs">Stage:</span> <span className="font-medium text-slate-900 capitalize">{h.crop_stage.replace(/_/g, " ")}</span></div>}
                          {h.yield_estimate != null && <div><span className="text-slate-400 text-xs">Yield Est.:</span> <span className="font-medium text-slate-900">{h.yield_estimate}</span></div>}
                          {h.buyer_name && <div><span className="text-slate-400 text-xs">Buyer:</span> <span className="font-medium text-slate-900">{h.buyer_name}</span></div>}
                          <Button size="sm" variant="outline" onClick={() => startEdit(h)}><Pencil className="w-3 h-3 mr-1" /> Update Progress</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}