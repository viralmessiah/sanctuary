import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Wallet, Loader2 } from "lucide-react";

export default function VendorSettlements() {
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.entities.Settlement.list("-created_date", 100).then((s) => { setSettlements(s); setLoading(false); });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const totalPending = settlements.filter((s) => s.status !== "paid").reduce((sum, s) => sum + (s.amount || 0), 0);
  const totalPaid = settlements.filter((s) => s.status === "paid").reduce((sum, s) => sum + (s.amount || 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Settlements</h1>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Pending Payout</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">KES {totalPending.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Total Paid</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">KES {totalPaid.toLocaleString()}</p>
        </div>
      </div>

      {settlements.length === 0 ? (
        <EmptyState icon={Wallet} title="No settlement claims yet" description="Claims are created automatically after each voucher redemption." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {settlements.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">KES {s.amount?.toLocaleString()}</p>
                <p className="text-xs text-slate-400">Claimed {new Date(s.claim_date || s.created_date).toLocaleDateString()}{s.payment_reference && ` · Ref: ${s.payment_reference}`}</p>
              </div>
              <StatusBadge status={s.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}