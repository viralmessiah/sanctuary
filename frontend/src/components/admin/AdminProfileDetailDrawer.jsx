import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2 } from "lucide-react";

const CONFIG = {
  buyer: {
    entity: "BuyerProfile",
    title: "Buyer Details",
    name: (profile) => profile.business_name || "Buyer",
    fields: [
      ["Business Name", "business_name"], ["Contact Name", "full_name"], ["Email", "email"],
      ["Phone", "phone"], ["Address", "address"], ["National ID", "id_number"],
      ["Crops Bought", "crops_bought"], ["Regions Served", "regions"],
      ["Total Quantity Needed", "total_qty_needed"], ["Minimum Quantity per Farmer", "min_qty_per_farmer"],
      ["Price per Unit (KES)", "price_per_unit"],
    ],
  },
  field_officer: {
    entity: "FieldOfficerProfile",
    title: "Field Officer Details",
    name: (profile) => profile.full_name || "Field Officer",
    fields: [
      ["Full Name", "full_name"], ["Email", "email"], ["Phone", "phone"],
      ["Region", "region"], ["National ID", "id_number"],
    ],
  },
  loan_officer: {
    entity: "LoanOfficerProfile",
    title: "Loan Officer Details",
    name: (profile) => profile.full_name || "Loan Officer",
    fields: [["Full Name", "full_name"], ["Email", "email"], ["Phone", "phone"]],
  },
};

const formatValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function AdminProfileDetailDrawer({ record, open, onClose }) {
  const [kycRecords, setKycRecords] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const config = record ? CONFIG[record.kind] : null;
  const profile = record?.profile;

  useEffect(() => {
    if (!open || !record || !config) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const [kyc, related] = await Promise.all([
          api.entities.KYCVerification.filter({ created_by_id: profile.created_by_id }, "-created_date", 20),
          record.kind === "buyer"
            ? api.entities.OfftakeContract.filter({ buyer_user_id: profile.created_by_id }, "-created_date", 50)
            : record.kind === "field_officer"
              ? Promise.all([
                api.entities.FieldVerification.filter({ officer_user_id: profile.created_by_id }, "-created_date", 50),
                api.entities.FarmVisit.filter({ officer_user_id: profile.created_by_id }, "-created_date", 50),
              ]).then(([verifications, visits]) => [
                ...verifications.map((item) => ({ ...item, activity_type: "Field verification", description: item.farmer_name, activity_status: item.status })),
                ...visits.map((item) => ({ ...item, activity_type: "Farm visit", description: item.visit_date || item.farmer_user_id, activity_status: item.status })),
              ])
              : Promise.all([
                api.entities.FinancingRequest.filter({ approved_by: profile.email }, "-created_date", 50),
                api.entities.FinancingRequest.filter({ stage1_approved_by: profile.email }, "-created_date", 50),
              ]).then(([finalApprovals, stageApprovals]) => {
                const unique = new Map([...finalApprovals, ...stageApprovals].map((item) => [item.id, item]));
                return [...unique.values()].map((item) => ({
                  ...item,
                  activity_type: "Financing review",
                  description: `KES ${Number(item.approved_amount || item.requested_amount || 0).toLocaleString()}`,
                  activity_status: item.status,
                }));
              }),
        ]);
        if (!cancelled) {
          setKycRecords(kyc);
          setActivity(related);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load this user's related details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [open, record, config, profile]);

  if (!config || !profile) return null;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-8 text-left">{config.title}</SheetTitle>
          <p className="text-sm text-slate-500">{config.name(profile)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">Profile <StatusBadge status={profile.status} /></span>
            {profile.kyc_status && <span className="inline-flex items-center gap-1 text-xs text-slate-500">KYC <StatusBadge status={profile.kyc_status} /></span>}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Account & Profile</h3>
            <dl className="grid grid-cols-2 gap-4">
              {config.fields.map(([label, key]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs text-slate-400">{label}</dt>
                  <dd className="mt-0.5 break-words text-sm text-slate-900">{formatValue(profile[key])}</dd>
                </div>
              ))}
              <div className="min-w-0">
                <dt className="text-xs text-slate-400">Login email</dt>
                <dd className="mt-0.5 break-words text-sm text-slate-900">{profile.created_by || profile.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Registered</dt>
                <dd className="mt-0.5 text-sm text-slate-900">{profile.created_date ? new Date(profile.created_date).toLocaleString() : "—"}</dd>
              </div>
            </dl>
          </section>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" /></div>
          ) : (
            <>
              {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Identity Verification</h3>
                {kycRecords.length ? (
                  <div className="space-y-2">
                    {kycRecords.map((kyc) => (
                      <div key={kyc.id} className="rounded-xl bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800">{kyc.document_type || "Identity document"}</p>
                          <StatusBadge status={kyc.status} />
                        </div>
                        {kyc.rejection_reason && <p className="mt-2 text-xs text-red-700">{kyc.rejection_reason}</p>}
                        {kyc.document_url && <a href={kyc.document_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-emerald-700 underline">View submitted document</a>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-500">No identity documents submitted.</p>}
              </section>

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {record.kind === "buyer" ? "Offtake Contracts" : record.kind === "field_officer" ? "Field Activity" : "Financing Reviews"}
                </h3>
                {activity.length ? (
                  <div className="space-y-2">
                    {activity.map((item) => (
                      <div key={`${item.activity_type || "contract"}-${item.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">
                            {item.activity_type || item.contract_number || "Offtake contract"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {item.description || [item.crop, item.quantity, item.unit].filter(Boolean).join(" · ") || item.farmer_name || item.contract_number}
                          </p>
                        </div>
                        <StatusBadge status={item.activity_status || item.status} />
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-500">No related activity yet.</p>}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
