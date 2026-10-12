import React, { useState } from "react";
import { api } from "@/api/client";
import { Sprout, Store, Leaf, Building2, ClipboardCheck, BadgeDollarSign } from "lucide-react";

export default function Onboarding() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const choose = async (type) => {
    setSaving(true);
    setError("");
    try {
      await api.auth.updateMe({ user_type: type });
      const user = await api.auth.me();
      let dest = type === "farmer" ? "/farmer/profile" : type === "buyer" ? "/buyer/profile" : type === "field_officer" ? "/fieldofficer/profile" : type === "loan_officer" ? "/loanofficer/dashboard" : type === "vendor" ? "/vendor/profile" : "/partner";
      if (type === "loan_officer") {
        const profiles = await api.entities.LoanOfficerProfile.filter({ created_by_id: user.id });
        if (profiles.length === 0) await api.entities.LoanOfficerProfile.create({ full_name: user.full_name || user.email, email: user.email });
      } else if (type === "field_officer") {
        const profiles = await api.entities.FieldOfficerProfile.filter({ created_by_id: user.id });
        if (profiles.length === 0) await api.entities.FieldOfficerProfile.create({ full_name: user.full_name || user.email, email: user.email });
      } else if (["insurer", "credit_bureau", "agronomist", "warehouse_logistics", "cooperative", "mobile_money", "compliance", "collections", "support_desk"].includes(type)) {
        const profiles = await api.entities.PartnerProfile.filter({ created_by_id: user.id });
        if (profiles.length === 0) await api.entities.PartnerProfile.create({
          partner_type: type, organization_name: user.full_name || user.email,
        });
      }
      window.location.href = dest;
    } catch (err) {
      setError(err.message || "Could not complete onboarding.");
      setSaving(false);
    }
  };

  const partnerRoles = [
    ["insurer", "Insurer"], ["credit_bureau", "Credit bureau"],
    ["agronomist", "Agronomist"], ["warehouse_logistics", "Warehouse & logistics"],
    ["cooperative", "Cooperative"], ["mobile_money", "Mobile money partner"],
    ["compliance", "Compliance"], ["collections", "Collections"], ["support_desk", "Support desk"],
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 to-slate-950 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
          <Leaf className="w-7 h-7 text-emerald-400" />
        </div>
        <h1 className="text-3xl font-semibold text-white tracking-tight mb-2">Welcome to Sanctuary AgriConnect</h1>
        <p className="text-white/50 mb-10">Tell us how you'll use the platform to get started.</p>
        {error && <p role="alert" className="mb-5 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <button
            disabled={saving}
            onClick={() => choose("farmer")}
            className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-8 text-left transition-colors disabled:opacity-50"
          >
            <Sprout className="w-8 h-8 text-emerald-400 mb-4" strokeWidth={1.5} />
            <p className="text-white font-medium text-lg">I'm a Farmer</p>
            <p className="text-white/40 text-sm mt-1">Order inputs, request financing, and manage your farm.</p>
          </button>
          <button
            disabled={saving}
            onClick={() => choose("buyer")}
            className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-8 text-left transition-colors disabled:opacity-50"
          >
            <Building2 className="w-8 h-8 text-emerald-400 mb-4" strokeWidth={1.5} />
            <p className="text-white font-medium text-lg">I'm a Buyer</p>
            <p className="text-white/40 text-sm mt-1">Contract with farmers, monitor crops, and receive harvest deliveries.</p>
          </button>
          <button
            disabled={saving}
            onClick={() => choose("field_officer")}
            className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-8 text-left transition-colors disabled:opacity-50"
          >
            <ClipboardCheck className="w-8 h-8 text-emerald-400 mb-4" strokeWidth={1.5} />
            <p className="text-white font-medium text-lg">I'm a Field Officer</p>
            <p className="text-white/40 text-sm mt-1">Verify farmer land and documents before system onboarding.</p>
          </button>
          <button
            disabled={saving}
            onClick={() => choose("loan_officer")}
            className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-8 text-left transition-colors disabled:opacity-50"
          >
            <BadgeDollarSign className="w-8 h-8 text-emerald-400 mb-4" strokeWidth={1.5} />
            <p className="text-white font-medium text-lg">I'm a Loan Officer</p>
            <p className="text-white/40 text-sm mt-1">Review financing applications, underwrite loans, and manage your portfolio.</p>
          </button>
          <button
            disabled={saving}
            onClick={() => choose("vendor")}
            className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-8 text-left transition-colors disabled:opacity-50"
          >
            <Store className="w-8 h-8 text-emerald-400 mb-4" strokeWidth={1.5} />
            <p className="text-white font-medium text-lg">I'm a Vendor</p>
            <p className="text-white/40 text-sm mt-1">List agricultural products and fulfil farmer orders.</p>
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
          <p className="mb-3 text-sm font-medium text-white">I represent a partner team</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {partnerRoles.map(([type, label]) => <button key={type} disabled={saving} onClick={() => choose(type)} className="rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 disabled:opacity-50">{label}</button>)}
          </div>
          <p className="mt-3 text-xs text-white/40">Partner workspaces remain restricted until an administrator approves the organization profile.</p>
        </div>
      </div>
    </div>
  );
}