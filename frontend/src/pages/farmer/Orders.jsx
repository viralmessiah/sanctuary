import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Link, useLocation } from "react-router-dom";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { ClipboardList, Loader2 } from "lucide-react";

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    api.entities.Order.list("-created_date", 100).then((o) => { setOrders(o); setLoading(false); });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">My Orders</h1>
      {location.state?.placedOrders > 0 && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {location.state.placedOrders} vendor order{location.state.placedOrders === 1 ? "" : "s"} placed successfully.
        </p>
      )}
      {orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No orders yet" description="Orders you place from the marketplace will appear here." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {orders.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50">
              <div>
                <p className="text-sm font-medium text-slate-900">{o.vendor_name}</p>
                <p className="text-xs text-slate-400">{o.items?.length} item(s) · KES {o.total?.toLocaleString()}</p>
              </div>
              <StatusBadge status={o.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}