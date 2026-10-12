import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Sprout, Loader2, UploadCloud, AlertTriangle } from "lucide-react";

const CROP_STAGES = ["land_preparation", "planting", "growing", "flowering", "maturation", "harvest_ready", "harvested"];

export default function BuyerMonitoring() {
  const { user } = useAuth();
  const [harvests, setHarvests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [edit, setEdit] = useState({});

  const load = async () => {
    const h = await api.entities.Harvest.filter({ buyer_user_id: user.id }, "-created_date", 200);
    setHarvests(h);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const uploadPhoto = async (h, file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    const photos = [...(h.field_verification_photos || []), file_url];
    await api.entities.Harvest.update(h.id, { field_verification_photos: photos, last_update_date: new Date().toISOString(), settlement_status: "field_verified" });
    setUploading(false);
    load();
  };

  const updateStage = async (h) => {
    const e = edit[h.id] || {};
    await api.entities.Harvest.update(h.id, { crop_stage: e.crop_stage || h.crop_stage, yield_estimate: e.yield_estimate ? Number(e.yield_estimate) : undefined, risk_alert: e.risk_alert || h.risk_alert, last_update_date: new Date().toISOString() });
    setEdit({ ...edit, [h.id]: undefined });
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Crop Monitoring</h1>
        <p className="text-slate-500 text-sm mt-1">Field verification, crop progress, and risk alerts for contracted crops.</p>
      </div>
      {harvests.length === 0 ? (
        <EmptyState icon={Sprout} title="No crops to monitor" description="Crops linked to your contracts will appear here." />
      ) : (
        <div className="space-y-3">
          {harvests.map((h) => (
            <div key={h.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{h.crop}</p>
                  <p className="text-xs text-slate-400">{h.expected_quantity} {h.unit} expected · {new Date(h.expected_harvest_date).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  {h.risk_alert && h.risk_alert !== "none" && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  <StatusBadge status={h.settlement_status} />
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <div><span className="text-slate-400">Stage:</span> <span className="font-medium text-slate-700 capitalize">{(h.crop_stage || "planting").replace(/_/g, " ")}</span></div>
                <div><span className="text-slate-400">Yield estimate:</span> <span className="font-medium text-slate-700">{h.yield_estimate || "—"}</span></div>
                <div><span className="text-slate-400">Risk:</span> <span className="font-medium text-slate-700 capitalize">{(h.risk_alert || "none").replace(/_/g, " ")}</span></div>
              </div>
              {h.field_verification_photos?.length > 0 && (
                <div className="flex gap-2">
                  {h.field_verification_photos.slice(0, 5).map((url, i) => <img key={i} src={url} alt="" className="w-16 h-16 rounded-lg object-cover" />)}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1 text-sm text-emerald-700 font-medium">
                  <UploadCloud className="w-4 h-4" /> {uploading ? "Uploading..." : "Add Verification Photo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(h, e.target.files[0])} />
                </label>
                {edit[h.id] ? (
                  <div className="flex items-center gap-2">
                    <select className="border border-slate-200 rounded-lg h-9 px-2 text-sm bg-white" value={edit[h.id].crop_stage || h.crop_stage} onChange={(e) => setEdit({ ...edit, [h.id]: { ...edit[h.id], crop_stage: e.target.value } })}>
                      {CROP_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                    </select>
                    <Input type="number" placeholder="Yield est." className="w-24 text-sm" value={edit[h.id].yield_estimate || ""} onChange={(e) => setEdit({ ...edit, [h.id]: { ...edit[h.id], yield_estimate: e.target.value } })} />
                    <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => updateStage(h)}>Save</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, [h.id]: {} })}>Update Progress</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}