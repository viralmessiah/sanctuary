import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { BriefcaseBusiness, Loader2 } from "lucide-react";

export default function LoanOfficerPortfolio() {
  const [requests, setRequests] = useState(null);
  useEffect(() => { api.entities.FinancingRequest.filter({}, "-created_date", 500).then(setRequests); }, []);

  if (!requests) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  const portfolio = requests.filter((request) => ["approved", "agreement_pending", "active", "restructured", "written_off"].includes(request.status));
  const total = portfolio.reduce((sum, request) => sum + Number(request.approved_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Loan Portfolio</h1><p className="text-slate-500 text-sm mt-1">Applications you have underwritten and their current status.</p></div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5"><p className="text-sm text-slate-500">Underwritten applications</p><p className="text-2xl font-semibold text-slate-900 mt-1">{portfolio.length}</p></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5"><p className="text-sm text-slate-500">Approved principal</p><p className="text-2xl font-semibold text-slate-900 mt-1">KES {total.toLocaleString()}</p></div>
      </div>
      {portfolio.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No underwritten loans yet" /> : (
        <div className="space-y-3">
          {portfolio.map((request) => (
            <Link key={request.id} to={`/loanofficer/applications/${request.id}`} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300">
              <div><p className="font-medium text-slate-900">{request.farmer_name || "Farmer application"}</p><p className="text-xs text-slate-400">KES {Number(request.approved_amount || 0).toLocaleString()} · Order {request.order_id}</p></div>
              <StatusBadge status={request.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
