import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/shared/StatusBadge";
import { Package, ClipboardList, QrCode, Wallet, Loader2 } from "lucide-react";

export default function VendorDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const me = await api.auth.me();
      const vendorUserId = me.vendor_employment?.vendor_user_id || me.id;
      const [profiles, products, orders, settlements] = await Promise.all([
        api.entities.VendorProfile.filter({ created_by_id: vendorUserId }),
        api.entities.Product.filter({ vendor_user_id: vendorUserId }),
        api.entities.Order.list("-created_date", 5),
        api.entities.Settlement.filter({}),
      ]);
      setData({ profile: profiles[0], products, orders, settlements });
    } catch (loadError) {
      setError(loadError.message || "Unable to load vendor dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  if (error) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <h1 className="font-semibold text-red-900">Your dashboard couldn’t be loaded</h1>
        <p className="mt-2 text-sm text-red-800">{error}</p>
        <button
          type="button"
          onClick={loadDashboard}
          className="mt-4 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900"
        >
          Try again
        </button>
      </div>
    );
  }
  const { profile, products, orders, settlements } = data;
  const pendingPay = settlements.filter((s) => s.status !== "paid").reduce((sum, s) => sum + (s.amount || 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Welcome back{profile ? `, ${profile.business_name}` : ""}</h1>
        <p className="text-slate-500 text-sm mt-1">Here's what's happening with your store.</p>
      </div>

      {(!profile || profile.status !== "active") && (
        <Link to="/vendor/profile" className="block bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 hover:bg-amber-100">
          {!profile ? "Complete your store profile to start listing products." : "Your store verification is still pending admin review."}
        </Link>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Link to="/vendor/products" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
          <Package className="w-4 h-4 text-slate-400 mb-2" />
          <p className="text-2xl font-semibold text-slate-900">{products.length}</p>
          <p className="text-xs text-slate-400">Products Listed</p>
        </Link>
        <Link to="/vendor/orders" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
          <ClipboardList className="w-4 h-4 text-slate-400 mb-2" />
          <p className="text-2xl font-semibold text-slate-900">{orders.length}</p>
          <p className="text-xs text-slate-400">Recent Orders</p>
        </Link>
        <Link to="/vendor/settlements" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
          <Wallet className="w-4 h-4 text-slate-400 mb-2" />
          <p className="text-2xl font-semibold text-slate-900">KES {pendingPay.toLocaleString()}</p>
          <p className="text-xs text-slate-400">Pending Payables</p>
        </Link>
      </div>

      <Link to="/vendor/redeem" className="flex items-center gap-3 bg-emerald-800 hover:bg-emerald-900 text-white rounded-2xl p-5">
        <QrCode className="w-5 h-5" />
        <span className="font-medium">Verify / Redeem Voucher</span>
      </Link>

      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-medium text-slate-900 mb-4">Recent Orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-slate-400">No orders yet.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between p-3 rounded-lg">
                <span className="text-sm text-slate-700">{o.farmer_name || "Farmer"} · KES {o.total?.toLocaleString()}</span>
                <StatusBadge status={o.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}