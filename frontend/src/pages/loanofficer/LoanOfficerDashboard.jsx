import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { BriefcaseBusiness, ClipboardList, FileSignature, Loader2 } from "lucide-react";

export default function LoanOfficerDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    (async () => {
      const [profiles, requests] = await Promise.all([
        api.entities.LoanOfficerProfile.filter({ created_by_id: user.id }),
        api.entities.FinancingRequest.filter({}, "-created_date", 500),
      ]);
      const profile = profiles[0] || null;
      const contractIds = [...new Set(requests.map((request) => request.offtake_contract_id).filter(Boolean))];
      const contracts = contractIds.length
        ? await api.entities.OfftakeContract.filter({ id: { $in: contractIds } }, "-created_date", 500)
        : [];
      setSummary({
        profile,
        queue: requests.filter((r) => ["requested", "under_review", "stage1_approved", "returned"].includes(r.status)).length,
        approved: requests.filter((r) => r.status === "approved").length,
        pendingSignatures: contracts.filter((contract) => contract.status === "active" && !contract.loan_officer_signed_at).length,
      });
    })();
  }, [user.id]);

  if (!summary) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const cards = [
    { label: "Applications to review", value: summary.queue, to: "/loanofficer/applications", icon: ClipboardList },
    { label: "Approved applications", value: summary.approved, to: "/loanofficer/portfolio", icon: BriefcaseBusiness },
    { label: "Contracts to sign", value: summary.pendingSignatures, to: "/loanofficer/contracts", icon: FileSignature },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Loan Officer Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Review applications, make underwriting decisions, and manage your portfolio.</p>
      </div>
      {summary.profile?.status !== "active" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Your loan officer access is pending administrator approval. Application review and portfolio access will be enabled once approved.
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
            <card.icon className="w-4 h-4 text-slate-400 mb-2" />
            <p className="text-xl font-semibold text-slate-900">{summary.profile?.status === "active" ? card.value : "—"}</p>
            <p className="text-xs text-slate-400 mt-0.5">{card.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
