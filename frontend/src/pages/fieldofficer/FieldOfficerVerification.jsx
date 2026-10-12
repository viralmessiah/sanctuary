import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { ArrowLeft, Loader2, UploadCloud, Send } from "lucide-react";

export default function FieldOfficerVerification() {
  const { verificationId } = useParams();
  const navigate = useNavigate();
  const [verification, setVerification] = useState(null);
  const [farmer, setFarmer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    land_verification_notes: "",
    document_verification_notes: "",
    land_size_verified: "",
    crops_verified: [],
  });

  const load = async () => {
    const v = await api.entities.FieldVerification.get(verificationId);
    setVerification(v);
    setForm({
      land_verification_notes: v.land_verification_notes || "",
      document_verification_notes: v.document_verification_notes || "",
      land_size_verified: v.land_size_verified || "",
      crops_verified: v.crops_verified || [],
    });
    const profiles = await api.entities.FarmerProfile.filter({ created_by_id: v.farmer_user_id });
    setFarmer(profiles[0] || null);
    setLoading(false);
  };

  const hasPrivatePhoto = verification?.field_visit_photos?.some(
    (photo) => photo.startsWith("private:") || photo.includes("/api/files/private/"),
  );

  useEffect(() => { load(); }, [verificationId]);

  const uploadPhoto = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { file_uri } = await api.integrations.Core.UploadPrivateFile({ file });
      const photos = [...(verification.field_visit_photos || []), file_uri];
      await api.entities.FieldVerification.update(verificationId, { field_visit_photos: photos, status: "in_progress" });
      await load();
    } catch (err) {
      setError(err.message || "Unable to upload field evidence.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.entities.FieldVerification.update(verificationId, {
        status: "pending_admin_review",
        land_verification_notes: form.land_verification_notes,
        document_verification_notes: form.document_verification_notes,
        land_size_verified: form.land_size_verified ? Number(form.land_size_verified) : undefined,
        crops_verified: form.crops_verified,
        completed_date: new Date().toISOString(),
      });
      navigate("/fieldofficer/assignments");
    } catch (err) {
      setError(err.message || "Unable to submit findings for admin review.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/fieldofficer/assignments" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> Back to Assignments
      </Link>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-slate-900">Farmer Verification</h1>
          <StatusBadge status={verification.status} />
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {farmer && (
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-400">Name:</span> <span className="font-medium text-slate-900">{farmer.full_name}</span></div>
            <div><span className="text-slate-400">Region:</span> <span className="font-medium text-slate-900">{farmer.region || "—"}</span></div>
            <div><span className="text-slate-400">Farm:</span> <span className="font-medium text-slate-900">{farmer.farm_name || "—"}</span></div>
            <div><span className="text-slate-400">Location:</span> <span className="font-medium text-slate-900">{farmer.farm_location || "—"}</span></div>
            <div><span className="text-slate-400">Acreage:</span> <span className="font-medium text-slate-900">{farmer.acreage || "—"} acres</span></div>
            <div><span className="text-slate-400">Crops:</span> <span className="font-medium text-slate-900">{farmer.crops?.join(", ") || "—"}</span></div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h2 className="font-medium text-slate-900">Field Visit Evidence</h2>
        {verification.field_visit_photos?.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {verification.field_visit_photos.map((url, i) => (
              <img key={i} src={url} alt="" className="w-20 h-20 rounded-lg object-cover" />
            ))}
          </div>
        )}
        {["assigned", "in_progress"].includes(verification.status) && (
          <label className="cursor-pointer inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
            <UploadCloud className="h-4 w-4" /> Upload Field Visit Photo
            <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => uploadPhoto(e.target.files[0])} />
          </label>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h2 className="font-medium text-slate-900">Verification Report</h2>
        {!hasPrivatePhoto && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Upload at least one private field photo. The report cannot be sent for admin review without secure photo evidence.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>Land Verification Notes</Label>
          <Textarea rows={3} disabled={!["assigned", "in_progress"].includes(verification.status)} value={form.land_verification_notes} onChange={(e) => setForm({ ...form, land_verification_notes: e.target.value })} placeholder="Describe the land condition, size, and crop status observed during the visit." />
        </div>
        <div className="space-y-1.5">
          <Label>Document Verification Notes</Label>
          <Textarea rows={2} disabled={!["assigned", "in_progress"].includes(verification.status)} value={form.document_verification_notes} onChange={(e) => setForm({ ...form, document_verification_notes: e.target.value })} placeholder="Compare the farmer's submitted documents and credentials with what you inspected." />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Verified Land Size (acres)</Label>
            <Input type="number" disabled={!["assigned", "in_progress"].includes(verification.status)} value={form.land_size_verified} onChange={(e) => setForm({ ...form, land_size_verified: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Crops Verified (comma-separated)</Label>
            <Input disabled={!["assigned", "in_progress"].includes(verification.status)} value={form.crops_verified.join(", ")} onChange={(e) => setForm({ ...form, crops_verified: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </div>
        </div>
        {["assigned", "in_progress"].includes(verification.status) && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Submitting sends your findings to an administrator. Only the administrator can verify or reject the farmer account.</p>
            <Button onClick={submit} disabled={busy || !hasPrivatePhoto} className="bg-emerald-800 hover:bg-emerald-900">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit findings for admin review
            </Button>
          </div>
        )}
        {verification.status === "pending_admin_review" && (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Your findings are locked and awaiting administrator review.</p>
        )}
        {["approved", "rejected"].includes(verification.status) && (
          <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Administrator decision: {verification.status}{verification.rejection_reason ? ` — ${verification.rejection_reason}` : ""}</p>
        )}
      </div>
    </div>
  );
}