import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { ClipboardList, Loader2 } from "lucide-react";

export default function VendorOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.entities.Order.list("-created_date", 100).then((o) => { setOrders(o); setLoading(false); });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Orders</h1>
      {orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No orders yet" description="Orders farmers place with your store will appear here." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {orders.map((o) => (
            <div key={o.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-900">{o.farmer_name || "Farmer"} · KES {o.total?.toLocaleString()}</p>
                <StatusBadge status={o.status} />
              </div>
              <div className="text-xs text-slate-400 space-y-0.5">
                {o.items?.map((i, idx) => <p key={idx}>{i.product_name} × {i.quantity}</p>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}