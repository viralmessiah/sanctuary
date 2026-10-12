import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2 } from "lucide-react";

const roleLabels = {
  insurer: "Insurance claims",
  credit_bureau: "Consented credit files",
  agronomist: "Crop monitoring",
  warehouse_logistics: "Delivery and grading records",
  cooperative: "Consented cooperative members",
  mobile_money: "Consented payment tranches",
  compliance: "Compliance and fraud review",
  collections: "Collections and recovery cases",
  support_desk: "Independent support queue",
};

const roleData = {
  insurer: [["LoanCase", { case_type: "crop_failure" }]],
  credit_bureau: [["FinancingRequest", {}], ["LoanLedgerEntry", {}]],
  agronomist: [["FarmVisit", {}], ["Harvest", {}]],
  warehouse_logistics: [["Settlement", {}]],
  cooperative: [["FarmerProfile", {}]],
  mobile_money: [["LoanDisbursement", {}]],
  compliance: [["FraudAlert", {}], ["LoanCase", {}], ["Complaint", {}]],
  collections: [["LoanCase", {}], ["LoanLedgerEntry", {}]],
  support_desk: [["Complaint", {}]],
};

export default function PartnerWorkspace() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [records, setRecords] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const profiles = await api.entities.PartnerProfile.filter({ created_by_id: user.id }, "-created_date", 5);
      const ownProfile = profiles[0];
      setProfile(ownProfile || null);
      if (!ownProfile || ownProfile.status !== "active") return;
      const sources = roleData[user.user_type] || [];
      const result = await Promise.all(sources.map(async ([name, query]) => {
        const items = await api.entities[name].filter(query, "-created_date", 200);
        return items.map((item) => ({ ...item, _entity: name }));
      }));
      setRecords(result.flat().sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    })().catch((err) => setError(err.message || "Could not load partner records."))
      .finally(() => setLoading(false));
  }, [user?.id, user?.user_type]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>;
  const active = profile?.status === "active";
  const display = (item) => item.case_type || item.alert_type || item.entry_type || item.settlement_status || item.status || item._entity;
  const update = async (item, patch) => {
    setBusyId(item.id); setError("");
    try {
      await api.entities[item._entity].update(item.id, patch);
      const sources = roleData[user.user_type] || [];
      const result = await Promise.all(sources.map(async ([name, query]) => {
        const items = await api.entities[name].filter(query, "-created_date", 200);
        return items.map((record) => ({ ...record, _entity: name }));
      }));
      setRecords(result.flat().sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    } catch (err) { setError(err.message || "Could not update this partner record."); }
    finally { setBusyId(""); }
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{user?.user_type?.replaceAll("_", " ")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{roleLabels[user?.user_type] || "Partner workspace"}</h1>
        <p className="mt-1 text-sm text-slate-500">Records are returned only when your organization is approved and the farmer has granted the relevant data-sharing consent.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!profile && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No partner profile was found. Return to onboarding to register this organization.</div>}
      {profile && !active && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-medium text-amber-900">Partner approval pending</p>
        <p className="mt-1 text-sm text-amber-800">The organization profile must be approved by an administrator before partner data is available.</p>
      </div>}
      {active && <>
        {["insurer", "credit_bureau", "agronomist", "warehouse_logistics", "cooperative", "mobile_money"].includes(user?.user_type) && (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Need access to a farmer record? The farmer can grant or revoke a specific purpose under <Link className="text-emerald-800 underline" to="/privacy">Privacy & consent</Link>. No consent means no record is shared.
          </p>
        )}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium">Authorized work queue ({records.length})</h2>
          {records.map((item) => <article key={`${item._entity}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-3 text-sm">
            <div><p className="font-medium capitalize">{display(item).replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{item._entity} · record {item.id}</p></div>
            <div className="flex items-center gap-3">{item.amount != null && <span>KES {Number(item.amount).toLocaleString()}</span>}{item.status && <StatusBadge status={item.status} />}</div>
            {(user.user_type === "support_desk" || user.user_type === "compliance") && item._entity === "Complaint" && ["open", "under_review"].includes(item.status) && (
              <div className="basis-full space-y-2">
                <textarea className="w-full rounded-lg border border-slate-200 p-2 text-sm" rows={2} value={drafts[item.id] || ""} onChange={(event) => setDrafts({ ...drafts, [item.id]: event.target.value })} placeholder="Private resolution note" />
                <div className="flex gap-2">{item.status === "open" && <button disabled={busyId === item.id} className="rounded-md border px-3 py-1.5 text-xs" onClick={() => update(item, { status: "under_review" })}>Start review</button>}<button disabled={busyId === item.id} className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs text-white" onClick={() => update(item, { status: "resolved", resolution: drafts[item.id] || "Reviewed by the independent support team." })}>Resolve</button></div>
              </div>
            )}
            {user.user_type === "compliance" && item._entity === "FraudAlert" && ["open", "under_review"].includes(item.status) && (
              <div className="basis-full flex gap-2">
                {item.status === "open" && <button disabled={busyId === item.id} className="rounded-md border px-3 py-1.5 text-xs" onClick={() => update(item, { status: "under_review" })}>Review</button>}
                {item.status === "under_review" && <><button disabled={busyId === item.id} className="rounded-md border px-3 py-1.5 text-xs" onClick={() => update(item, { status: "cleared" })}>Clear</button><button disabled={busyId === item.id} className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs text-white" onClick={() => update(item, { status: "confirmed" })}>Confirm</button></>}
              </div>
            )}
            {["compliance", "collections"].includes(user.user_type) && item._entity === "LoanCase" && ["open", "under_review"].includes(item.status) && (
              <div className="basis-full flex gap-2"><button disabled={busyId === item.id} className="rounded-md border px-3 py-1.5 text-xs" onClick={() => update(item, { status: item.status === "open" ? "under_review" : "rejected", decision_notes: drafts[item.id] || "Reviewed by partner." })}>{item.status === "open" ? "Start review" : "Reject"}</button>{item.status === "under_review" && <button disabled={busyId === item.id} className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs text-white" onClick={() => update(item, { status: "approved", decision_notes: drafts[item.id] || "Approved after partner review." })}>Approve</button>}</div>
            )}
          </article>)}
          {!records.length && <p className="text-sm text-slate-500">No records are currently available for your role and active consent grants.</p>}
        </section>
      </>}
    </div>
  );
}
