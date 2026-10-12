import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2, UploadCloud, Building2, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function BuyerProfileSetup() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ business_name: "", phone: user.email, email: user.email, address: "", crops_bought: [], regions: [], total_qty_needed: "", min_qty_per_farmer: "", price_per_unit: "", id_number: "" });

  const load = async () => {
    const [p, k] = await Promise.all([
      api.entities.BuyerProfile.filter({ created_by_id: user.id }).then((r) => r[0] || null),
      api.entities.KYCVerification.filter({ created_by_id: user.id }).then((r) => r[0] || null),
    ]);
    if (p) {
      setProfile(p);
      setForm({ business_name: p.business_name || "", phone: p.phone || "", email: p.email || "", address: p.address || "", crops_bought: p.crops_bought || [], regions: p.regions || [], total_qty_needed: p.total_qty_needed || "", min_qty_per_farmer: p.min_qty_per_farmer || "", price_per_unit: p.price_per_unit || "", id_number: p.id_number || "" });
    }
    setKyc(k);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const data = { ...form, crops_bought: form.crops_bought, regions: form.regions, total_qty_needed: Number(form.total_qty_needed) || undefined, min_qty_per_farmer: Number(form.min_qty_per_farmer) || undefined, price_per_unit: Number(form.price_per_unit) || undefined };
    if (profile) await api.entities.BuyerProfile.update(profile.id, data);
    else await api.entities.BuyerProfile.create({ ...data, status: "pending_review" });
    setSaving(false);
    load();
  };

  const uploadImage = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    await api.entities.BuyerProfile.update(profile.id, { profile_image_url: file_url });
    setUploading(false);
    load();
  };

  const submitKyc = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    await api.entities.KYCVerification.create({ user_type: "buyer", applicant_name: form.business_name, document_url: file_url, document_type: file.name.split('.').pop(), status: "pending", submitted_date: new Date().toISOString() });
    await api.entities.BuyerProfile.update(profile.id, { kyc_status: "pending" });
    setUploading(false);
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Buyer Profile</h1>
        <p className="text-slate-500 text-sm mt-1">Configure your buying profile — crops, regions, and pricing.</p>
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
            {profile?.profile_image_url ? <img src={profile.profile_image_url} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-8 h-8 text-slate-400" />}
          </div>
          {profile && (
            <label className="cursor-pointer text-sm text-emerald-700 font-medium">
              {uploading ? "Uploading..." : "Upload Logo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(e.target.files[0])} />
            </label>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Business Name *</Label><Input required value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Crops Bought (comma-separated)</Label><Input value={form.crops_bought.join(", ")} onChange={(e) => setForm({ ...form, crops_bought: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>
          <div className="space-y-1.5"><Label>Regions (comma-separated)</Label><Input value={form.regions.join(", ")} onChange={(e) => setForm({ ...form, regions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>
          <div className="space-y-1.5"><Label>Total Qty Needed</Label><Input type="number" value={form.total_qty_needed} onChange={(e) => setForm({ ...form, total_qty_needed: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Min Qty per Farmer</Label><Input type="number" value={form.min_qty_per_farmer} onChange={(e) => setForm({ ...form, min_qty_per_farmer: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Price per Unit (KES)</Label><Input type="number" value={form.price_per_unit} onChange={(e) => setForm({ ...form, price_per_unit: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>National ID</Label><Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} /></div>
        </div>
        <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">{saving ? "Saving..." : "Save Profile"}</Button>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
        <h2 className="font-medium text-slate-900">Business Verification (KYC)</h2>
        {kyc ? (
          <div className="flex items-center gap-3"><StatusBadge status={kyc.status} /> {kyc.rejection_reason && <span className="text-xs text-red-600">{kyc.rejection_reason}</span>}</div>
        ) : (
          <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-emerald-700 font-medium">
            <UploadCloud className="w-4 h-4" /> Upload Business Document
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