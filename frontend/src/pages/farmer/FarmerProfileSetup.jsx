import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2, UploadCloud, CheckCircle2, User, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function FarmerProfileSetup() {
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    full_name: "", phone: "", national_id: "", farm_name: "",
    farm_location: "", acreage: "", production_cycle: "", crops: "", profile_image_url: "",
  });

  const load = async () => {
    const profiles = await api.entities.FarmerProfile.filter({});
    const p = profiles[0] || null;
    setProfile(p);
    if (p) {
      setForm({
        full_name: p.full_name || "", phone: p.phone || "", national_id: p.national_id || "",
        farm_name: p.farm_name || "", farm_location: p.farm_location || "",
        acreage: p.acreage || "", production_cycle: p.production_cycle || "",
        crops: (p.crops || []).join(", "), profile_image_url: p.profile_image_url || "",
      });
    }
    const kycs = await api.entities.KYCVerification.filter({ user_type: "farmer" });
    setKyc(kycs[0] || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const uploadImage = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    setForm((f) => ({ ...f, profile_image_url: file_url }));
    setUploading(false);
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      full_name: form.full_name, phone: form.phone, national_id: form.national_id,
      farm_name: form.farm_name, farm_location: form.farm_location,
      acreage: form.acreage ? Number(form.acreage) : undefined,
      production_cycle: form.production_cycle,
      crops: form.crops.split(",").map((c) => c.trim()).filter(Boolean),
      profile_image_url: form.profile_image_url,
      profile_status: "profile_complete",
    };
    if (profile) {
      await api.entities.FarmerProfile.update(profile.id, payload);
    } else {
      await api.entities.FarmerProfile.create(payload);
    }
    await load();
    setSaving(false);
  };

  const submitKyc = async (file) => {
    setUploading(true);
    const { file_uri } = await api.integrations.Core.UploadPrivateFile({ file });
    if (kyc) {
      await api.entities.KYCVerification.update(kyc.id, {
        document_url: file_uri, status: "pending", submitted_date: new Date().toISOString(),
      });
    } else {
      await api.entities.KYCVerification.create({
        user_type: "farmer", applicant_name: form.full_name, document_url: file_uri,
        document_type: "national_id", status: "pending", submitted_date: new Date().toISOString(),
      });
    }
    if (profile) await api.entities.FarmerProfile.update(profile.id, { kyc_status: "pending" });
    await load();
    setUploading(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Profile & Verification</h1>
        <p className="text-slate-500 text-sm mt-1">Complete your profile and KYC to unlock financing and orders.</p>
      </div>

      <form onSubmit={saveProfile} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Personal & Farm Details</h2>
          {profile && <StatusBadge status={profile.profile_status} />}
        </div>

        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
            {form.profile_image_url ? (
              <img src={form.profile_image_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-slate-300" />
            )}
          </div>
          <div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <UploadCloud className="w-4 h-4" />
              {uploading ? "Uploading..." : form.profile_image_url ? "Change Photo" : "Upload Photo"}
              <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])} />
            </label>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone Number</Label>
            <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254 7XX XXX XXX" />
          </div>
          <div className="space-y-1.5">
            <Label>National ID</Label>
            <Input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Farm Name</Label>
            <Input value={form.farm_name} onChange={(e) => setForm({ ...form, farm_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Farm Location</Label>
            <Input value={form.farm_location} onChange={(e) => setForm({ ...form, farm_location: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Acreage</Label>
            <Input type="number" step="0.1" value={form.acreage} onChange={(e) => setForm({ ...form, acreage: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Crops (comma separated)</Label>
          <Input value={form.crops} onChange={(e) => setForm({ ...form, crops: e.target.value })} placeholder="Maize, Beans" />
        </div>
        <div className="space-y-1.5">
          <Label>Production Cycle</Label>
          <Textarea rows={2} value={form.production_cycle} onChange={(e) => setForm({ ...form, production_cycle: e.target.value })} />
        </div>
        <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">
          {saving ? "Saving..." : "Save Profile"}
        </Button>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-slate-900">KYC Verification</h2>
          <StatusBadge status={kyc?.status || "not_started"} />
        </div>
        {kyc?.status === "verified" ? (
          <div className="flex items-center gap-2 text-emerald-700 text-sm">
            <CheckCircle2 className="w-4 h-4" /> Your identity has been verified.
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-500 mb-3">
              {kyc?.status === "rejected"
                ? `Rejected: ${kyc.rejection_reason || "Please resubmit a valid document."}`
                : "Upload a national ID or passport for verification by our team."}
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <UploadCloud className="w-4 h-4" />
              {uploading ? "Uploading..." : "Upload Document"}
              <input
                type="file"
                className="hidden"
                disabled={uploading || !profile}
                onChange={(e) => e.target.files[0] && submitKyc(e.target.files[0])}
              />
            </label>
            {!profile && <p className="text-xs text-amber-600 mt-2">Save your profile first.</p>}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-200">
        <Link
          to="/delete-account"
          className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700"
        >
          <Trash2 className="w-4 h-4" />
          Delete my account
        </Link>
      </div>
    </div>
  );
}