import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2, UploadCloud, MapPin, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function FieldOfficerProfileSetup() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: user.email, email: user.email, region: "", id_number: "" });

  const load = async () => {
    const [p, k] = await Promise.all([
      api.entities.FieldOfficerProfile.filter({ created_by_id: user.id }).then((r) => r[0] || null),
      api.entities.KYCVerification.filter({ created_by_id: user.id }).then((r) => r[0] || null),
    ]);
    if (p) {
      setProfile(p);
      setForm({ full_name: p.full_name || "", phone: p.phone || "", email: p.email || "", region: p.region || "", id_number: p.id_number || "" });
    }
    setKyc(k);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    if (profile) await api.entities.FieldOfficerProfile.update(profile.id, form);
    else await api.entities.FieldOfficerProfile.create({ ...form, status: "pending_review" });
    setSaving(false);
    load();
  };

  const uploadImage = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    await api.entities.FieldOfficerProfile.update(profile.id, { profile_image_url: file_url });
    setUploading(false);
    load();
  };

  const submitKyc = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    await api.entities.KYCVerification.create({ user_type: "field_officer", applicant_name: form.full_name, document_url: file_url, document_type: file.name.split('.').pop(), status: "pending", submitted_date: new Date().toISOString() });
    await api.entities.FieldOfficerProfile.update(profile.id, { kyc_status: "pending" });
    setUploading(false);
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Field Officer Profile</h1>
        <p className="text-slate-500 text-sm mt-1">Set up your profile so the admin can assign you verification tasks.</p>
      </div>

      {profile && (
        <div className="flex items-center gap-3">
          <StatusBadge status={profile.status} />
          <StatusBadge status={profile.kyc_status} />
        </div>
      )}

      <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center overflow-hidden">
            {profile?.profile_image_url ? <img src={profile.profile_image_url} alt="" className="w-full h-full object-cover" /> : <MapPin className="w-8 h-8 text-slate-400" />}
          </div>
          {profile && (
            <label className="cursor-pointer text-sm text-emerald-700 font-medium">
              {uploading ? "Uploading..." : "Upload Photo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(e.target.files[0])} />
            </label>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Full Name *</Label><Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Region *</Label><Input required value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="e.g. Nakuru County" /></div>
          <div className="space-y-1.5"><Label>National ID</Label><Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} /></div>
        </div>
        <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">{saving ? "Saving..." : "Save Profile"}</Button>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
        <h2 className="font-medium text-slate-900">Identity Verification (KYC)</h2>
        {kyc ? (
          <div className="flex items-center gap-3"><StatusBadge status={kyc.status} /></div>
        ) : (
          <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-emerald-700 font-medium">
            <UploadCloud className="w-4 h-4" /> Upload ID Document
            <input type="file" className="hidden" onChange={(e) => submitKyc(e.target.files[0])} />
          </label>
        )}
      </div>

      <div className="pt-4 border-t border-slate-200">
        <Link to="/delete-account" className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700">
          <Trash2 className="w-4 h-4" /> Delete my account
        </Link>
      </div>
    </div>
  );
}