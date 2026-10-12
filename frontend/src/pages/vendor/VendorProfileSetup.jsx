import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2, UploadCloud, CheckCircle2, User, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function VendorProfileSetup() {
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ business_name: "", phone: "", email: "", address: "", store_location: "", categories: "", payout_details: "", profile_image_url: "", id_number: "" });

  const load = async () => {
    const me = await api.auth.me();
    const vendorUserId = me.vendor_employment?.vendor_user_id || me.id;
    const profiles = await api.entities.VendorProfile.filter({ created_by_id: vendorUserId });
    const p = profiles[0] || null;
    setProfile(p);
    if (p) {
      setForm({
        business_name: p.business_name || "", phone: p.phone || "", email: p.email || "",
        address: p.address || "", store_location: p.store_location || "",
        categories: (p.categories || []).join(", "), payout_details: p.payout_details || "",
        profile_image_url: p.profile_image_url || "", id_number: p.id_number || "",
      });
    }
    const kycs = await api.entities.KYCVerification.filter({ created_by_id: vendorUserId, user_type: "vendor" });
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
      business_name: form.business_name, phone: form.phone, email: form.email,
      address: form.address, store_location: form.store_location,
      categories: form.categories.split(",").map((c) => c.trim()).filter(Boolean),
      payout_details: form.payout_details,
      profile_image_url: form.profile_image_url,
      id_number: form.id_number,
    };
    if (profile) {
      await api.entities.VendorProfile.update(profile.id, payload);
    } else {
      await api.entities.VendorProfile.create(payload);
    }
    await load();
    setSaving(false);
  };

  const submitKyc = async (file) => {
    setUploading(true);
    const { file_uri } = await api.integrations.Core.UploadPrivateFile({ file });
    if (kyc) {
      await api.entities.KYCVerification.update(kyc.id, { document_url: file_uri, status: "pending", submitted_date: new Date().toISOString() });
    } else {
      await api.entities.KYCVerification.create({
        user_type: "vendor", applicant_name: form.business_name, document_url: file_uri,
        document_type: "business_registration", status: "pending", submitted_date: new Date().toISOString(),
      });
    }
    if (profile) await api.entities.VendorProfile.update(profile.id, { kyc_status: "pending" });
    await load();
    setUploading(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Store Profile & Verification</h1>
        <p className="text-slate-500 text-sm mt-1">Complete your business details to start listing products.</p>
      </div>

      <form onSubmit={saveProfile} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Business Details</h2>
          {profile && <StatusBadge status={profile.status} />}
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
            <Label>Business Name</Label>
            <Input required value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone Number</Label>
            <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>ID Number</Label>
            <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} placeholder="National ID or Business Reg No." />
          </div>
          <div className="space-y-1.5">
            <Label>Payout Details (M-Pesa / Bank)</Label>
            <Input value={form.payout_details} onChange={(e) => setForm({ ...form, payout_details: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Store Location</Label>
            <Input value={form.store_location} onChange={(e) => setForm({ ...form, store_location: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Product Categories (comma separated)</Label>
          <Input value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="Seeds, Fertilizers" />
        </div>
        <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">{saving ? "Saving..." : "Save Profile"}</Button>
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-slate-900">KYC / Business Verification</h2>
          <StatusBadge status={kyc?.status || "not_started"} />
        </div>
        {kyc?.status === "verified" ? (
          <div className="flex items-center gap-2 text-emerald-700 text-sm"><CheckCircle2 className="w-4 h-4" /> Your business has been verified.</div>
        ) : (
          <div>
            <p className="text-sm text-slate-500 mb-3">
              {kyc?.status === "rejected" ? `Rejected: ${kyc.rejection_reason || "Please resubmit valid documents."}` : "Upload business registration or ID documents for review."}
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <UploadCloud className="w-4 h-4" />
              {uploading ? "Uploading..." : "Upload Document"}
              <input type="file" className="hidden" disabled={uploading || !profile} onChange={(e) => e.target.files[0] && submitKyc(e.target.files[0])} />
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