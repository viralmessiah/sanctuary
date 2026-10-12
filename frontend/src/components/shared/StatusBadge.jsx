import React from "react";

const STYLES = {
  // generic
  active: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  verified: "bg-emerald-100 text-emerald-800",
  signed: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-100 text-emerald-800",
  settled: "bg-emerald-100 text-emerald-800",
  completed: "bg-emerald-100 text-emerald-800",
  redeemed: "bg-blue-100 text-blue-800",
  presented: "bg-blue-100 text-blue-800",
  under_review: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  pending_review: "bg-amber-100 text-amber-800",
  pending_admin_review: "bg-amber-100 text-amber-800",
  pending_approval: "bg-amber-100 text-amber-800",
  requested: "bg-amber-100 text-amber-800",
  submitted: "bg-amber-100 text-amber-800",
  financing_pending: "bg-amber-100 text-amber-800",
  agreement_pending: "bg-amber-100 text-amber-800",
  fulfillment_pending: "bg-amber-100 text-amber-800",
  profile_incomplete: "bg-amber-100 text-amber-800",
  not_started: "bg-slate-100 text-slate-700",
  generated: "bg-slate-100 text-slate-700",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-red-100 text-red-800",
  expired: "bg-red-100 text-red-800",
  disputed: "bg-red-100 text-red-800",
  suspended: "bg-red-100 text-red-800",
  resubmission_required: "bg-red-100 text-red-800",
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || "bg-slate-100 text-slate-700";
  const label = (status || "unknown").replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${style}`}>
      {label}
    </span>
  );
}