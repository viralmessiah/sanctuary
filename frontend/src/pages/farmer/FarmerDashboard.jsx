import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { ClipboardList, Ticket, FileText, Sprout, Loader2, Store, MessageSquare, UserCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { startConversation } from "@/lib/messaging";

export default function FarmerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [profiles, orders, agreements, vouchers, harvests, verifications] = await Promise.all([
        api.entities.FarmerProfile.filter({}),
        api.entities.Order.list("-created_date", 5),
        api.entities.Agreement.list("-created_date", 5),
        api.entities.Voucher.filter({ status: "active" }),
        api.entities.Harvest.list("-created_date", 5),
        api.entities.FieldVerification.filter({ farmer_user_id: user.id }, "-created_date", 5),
      ]);
      setData({ profile: profiles[0], orders, agreements, vouchers, harvests, verification: verifications[0] });
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const { profile, orders, agreements, vouchers, harvests, verification } = data;

  const messageOfficer = async () => {
    const conv = await startConversation(verification.officer_user_id, verification.officer_name);
    navigate(`/messages?conversation_id=${conv.id}`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
        <p className="text-slate-500 text-sm mt-1">Here's a snapshot of your account.</p>
      </div>

      {(!profile || profile.kyc_status !== "verified") && (
        <Link to="/farmer/profile" className="block bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 hover:bg-amber-100 transition-colors">
          {!profile ? "Complete your profile to start ordering." : "Your KYC verification is not complete yet — finish it to access financing."}
        </Link>
      )}

      {verification && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserCircle className="w-8 h-8 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-900">Field Officer: {verification.officer_name}</p>
              <p className="text-xs text-slate-400 capitalize">Verification: {verification.status.replace(/_/g, " ")}</p>
            </div>
          </div>
          <button onClick={messageOfficer} className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800">
            <MessageSquare className="w-4 h-4" /> Message
          </button>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Profile Status</p>
          <div className="mt-2"><StatusBadge status={profile?.profile_status || "profile_incomplete"} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">KYC Status</p>
          <div className="mt-2"><StatusBadge status={profile?.kyc_status || "not_started"} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Active Vouchers</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{vouchers.length}</p>
        </div>
      </div>

      <Link to="/marketplace" className="flex items-center gap-3 bg-emerald-800 hover:bg-emerald-900 text-white rounded-2xl p-5 transition-colors">
        <Store className="w-5 h-5" />
        <span className="font-medium">Browse the Marketplace</span>
      </Link>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-4 h-4 text-slate-400" />
            <h2 className="font-medium text-slate-900">Recent Orders</h2>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-slate-400">No orders yet.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50">
                  <span className="text-sm text-slate-700">{o.vendor_name || "Order"} · KES {o.total?.toLocaleString()}</span>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-slate-400" />
            <h2 className="font-medium text-slate-900">Agreements</h2>
          </div>
          {agreements.length === 0 ? (
            <p className="text-sm text-slate-400">No agreements yet.</p>
          ) : (
            <div className="space-y-2">
              {agreements.map((a) => (
                <Link key={a.id} to={`/orders/${a.order_id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50">
                  <span className="text-sm text-slate-700">{a.agreement_number}</span>
                  <StatusBadge status={a.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Ticket className="w-4 h-4 text-slate-400" />
            <h2 className="font-medium text-slate-900">Active Vouchers</h2>
          </div>
          {vouchers.length === 0 ? (
            <EmptyState icon={Ticket} title="No active vouchers" description="Vouchers appear here once your financing agreement is signed." />
          ) : (
            <div className="space-y-2">
              {vouchers.map((v) => (
                <Link key={v.id} to={`/orders/${v.order_id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50">
                  <span className="text-sm font-mono text-slate-700">{v.voucher_code}</span>
                  <StatusBadge status={v.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sprout className="w-4 h-4 text-slate-400" />
            <h2 className="font-medium text-slate-900">Harvest Obligations</h2>
          </div>
          {harvests.length === 0 ? (
            <p className="text-sm text-slate-400">No harvest records yet.</p>
          ) : (
            <div className="space-y-2">
              {harvests.map((h) => (
                <div key={h.id} className="flex items-center justify-between p-3 rounded-lg">
                  <span className="text-sm text-slate-700">{h.crop}</span>
                  <StatusBadge status={h.settlement_status} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}