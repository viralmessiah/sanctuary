import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Loader2, FileText, Truck, Sprout, Wallet } from "lucide-react";

export default function BuyerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const [profile, contracts, harvests, settlements] = await Promise.all([
        api.entities.BuyerProfile.filter({ created_by_id: user.id }).then((r) => r[0] || null),
        api.entities.OfftakeContract.filter({ buyer_user_id: user.id }, "-created_date", 500),
        api.entities.Harvest.filter({ buyer_user_id: user.id }, "-created_date", 500),
        api.entities.Settlement.filter({ buyer_user_id: user.id }, "-created_date", 500),
      ]);
      setStats({
        profile,
        activeContracts: contracts.filter((c) => c.status === "active").length,
        pendingContracts: contracts.filter((c) => c.status === "draft" || c.status === "pending_signature").length,
        monitoring: harvests.filter((h) => !["settled", "closed"].includes(h.settlement_status)).length,
        pendingDeliveries: harvests.filter((h) => ["harvest_ready", "delivered"].includes(h.settlement_status)).length,
        settlements: settlements.length,
        paid: settlements.filter((s) => s.status === "paid").length,
      });
    })();
  }, []);

  if (!stats) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const cards = [
    { label: "Active Contracts", value: stats.activeContracts, icon: FileText, to: "/buyer/contracts" },
    { label: "Pending Contracts", value: stats.pendingContracts, icon: FileText, to: "/buyer/contracts" },
    { label: "Crops Monitoring", value: stats.monitoring, icon: Sprout, to: "/buyer/monitoring" },
    { label: "Pending Deliveries", value: stats.pendingDeliveries, icon: Truck, to: "/buyer/deliveries" },
    { label: "Settlements", value: stats.settlements, icon: Wallet, to: "/buyer/deliveries" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Buyer Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Manage contracts, monitor crops, and track deliveries.</p>
      </div>
      {stats.profile?.status !== "active" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Your account is pending review. You'll be able to contract with farmers once approved.
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <button key={c.label} onClick={() => navigate(c.to)} className="text-left bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition-all cursor-pointer">
            <c.icon className="w-4 h-4 text-slate-400 mb-2" />
            <p className="text-xl font-semibold text-slate-900">{c.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{c.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}