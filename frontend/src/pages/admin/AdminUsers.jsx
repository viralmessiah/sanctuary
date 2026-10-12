import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import FarmerDetailDrawer from "@/components/admin/FarmerDetailDrawer";
import VendorDetailDrawer from "@/components/admin/VendorDetailDrawer";
import AdminProfileDetailDrawer from "@/components/admin/AdminProfileDetailDrawer";
import { Users, Loader2, Eye, Building2, BriefcaseBusiness, HandCoins } from "lucide-react";

export default function AdminUsers() {
  const [farmers, setFarmers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [fieldOfficers, setFieldOfficers] = useState([]);
  const [loanOfficers, setLoanOfficers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFarmer, setSelectedFarmer] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);

  const load = async () => {
    const [f, v, b, fo, lo] = await Promise.all([
      api.entities.FarmerProfile.list("-created_date", 200),
      api.entities.VendorProfile.list("-created_date", 200),
      api.entities.BuyerProfile.list("-created_date", 200),
      api.entities.FieldOfficerProfile.list("-created_date", 200),
      api.entities.LoanOfficerProfile.list("-created_date", 200),
    ]);
    setFarmers(f);
    setVendors(v);
    setBuyers(b);
    setFieldOfficers(fo);
    setLoanOfficers(lo);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleVendorStatus = async (vendor, status) => {
    await api.entities.VendorProfile.update(vendor.id, { status });
    await load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const renderProfiles = (profiles, { title, icon: Icon, name, detail, kind }) => (
    profiles.length === 0 ? <EmptyState icon={Icon} title={`No ${title.toLowerCase()} registered yet`} /> : (
      <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
        {profiles.map((profile) => (
          <button
            type="button"
            key={profile.id}
            onClick={() => setSelectedProfile({ kind, profile })}
            className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{name(profile)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{profile.email || profile.created_by || "No email on profile"}</p>
              <p className="mt-0.5 text-xs text-slate-400">{detail(profile)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">Profile <StatusBadge status={profile.status} /></span>
              {profile.kyc_status && <span className="inline-flex items-center gap-1 text-xs text-slate-500">KYC <StatusBadge status={profile.kyc_status} /></span>}
            </div>
          </button>
        ))}
      </div>
    )
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">User Directory</h1>
        <p className="mt-1 text-sm text-slate-500">Registered farmers, businesses and field and lending staff.</p>
      </div>
      <Tabs defaultValue="farmers">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="farmers">Farmers ({farmers.length})</TabsTrigger>
          <TabsTrigger value="vendors">Vendors ({vendors.length})</TabsTrigger>
          <TabsTrigger value="buyers">Buyers ({buyers.length})</TabsTrigger>
          <TabsTrigger value="field-officers">Field Officers ({fieldOfficers.length})</TabsTrigger>
          <TabsTrigger value="loan-officers">Loan Officers ({loanOfficers.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="farmers" className="mt-4">
          {farmers.length === 0 ? <EmptyState icon={Users} title="No farmers registered yet" /> : (
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
              {farmers.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => setSelectedFarmer(f)}>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{f.full_name}</p>
                    <p className="text-xs text-slate-400">{f.farm_name || "No farm name"} · {f.farm_location || "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={f.profile_status} />
                    <StatusBadge status={f.kyc_status} />
                    <Button size="sm" variant="ghost" className="text-slate-400"><Eye className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="vendors" className="mt-4">
          {vendors.length === 0 ? <EmptyState icon={Users} title="No vendors registered yet" /> : (
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
              {vendors.map((v) => (
                <div key={v.id} className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => setSelectedVendor(v)}>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{v.business_name}</p>
                    <p className="text-xs text-slate-400">{v.store_location || "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={v.status} />
                    <Button size="sm" variant="ghost" className="text-slate-400"><Eye className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="buyers" className="mt-4">
          {renderProfiles(buyers, {
            title: "Buyers",
            icon: Building2,
            kind: "buyer",
            name: (buyer) => buyer.business_name || buyer.full_name || "Buyer",
            detail: (buyer) => [buyer.phone, buyer.address].filter(Boolean).join(" · ") || "No phone or address provided",
          })}
        </TabsContent>
        <TabsContent value="field-officers" className="mt-4">
          {renderProfiles(fieldOfficers, {
            title: "Field Officers",
            icon: BriefcaseBusiness,
            kind: "field_officer",
            name: (officer) => officer.full_name || officer.created_by || "Field Officer",
            detail: (officer) => [officer.phone, officer.region].filter(Boolean).join(" · ") || "No phone or region provided",
          })}
        </TabsContent>
        <TabsContent value="loan-officers" className="mt-4">
          {renderProfiles(loanOfficers, {
            title: "Loan Officers",
            icon: HandCoins,
            kind: "loan_officer",
            name: (officer) => officer.full_name || officer.created_by || "Loan Officer",
            detail: (officer) => officer.phone || "No phone provided",
          })}
        </TabsContent>
      </Tabs>

      <FarmerDetailDrawer farmer={selectedFarmer} open={!!selectedFarmer} onClose={() => setSelectedFarmer(null)} />
      <VendorDetailDrawer vendor={selectedVendor} open={!!selectedVendor} onClose={() => setSelectedVendor(null)} />
      <AdminProfileDetailDrawer record={selectedProfile} open={!!selectedProfile} onClose={() => setSelectedProfile(null)} />
    </div>
  );
}