import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { ClipboardList, Loader2 } from "lucide-react";

export default function LoanOfficerApplications() {
  const [requests, setRequests] = useState(null);

  useEffect(() => {
    api.entities.FinancingRequest.filter({}, "-created_date", 500).then(setRequests);
  }, []);

  if (!requests) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  const queue = requests.filter((r) => ["requested", "under_review", "stage1_approved", "returned"].includes(r.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Applications Queue</h1>
        <p className="text-slate-500 text-sm mt-1">Review farmer financing requests backed by active buyer contracts.</p>
      </div>
      {queue.length === 0 ? <EmptyState icon={ClipboardList} title="No applications awaiting review" /> : (
        <div className="space-y-3">
          {queue.map((request) => (
            <Link key={request.id} to={`/loanofficer/applications/${request.id}`} className="block bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{request.farmer_name || "Farmer application"}</p>
                  <p className="text-xs text-slate-400">KES {Number(request.requested_amount || 0).toLocaleString()} requested · Order {request.order_id}</p>
                </div>
                <StatusBadge status={request.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
