import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Loader2, Users, Store, ClipboardList, Wallet, Ticket, Sprout, TrendingUp, Banknote, ClipboardCheck } from "lucide-react";
import StatCard from "@/components/admin/StatCard";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      try {
      const [farmers, vendors, orders, financing, vouchers, settlements, harvests, fieldVerifications] = await Promise.all([
        api.entities.FarmerProfile.list("-created_date", 500),
        api.entities.VendorProfile.list("-created_date", 500),
        api.entities.Order.list("-created_date", 500),
        api.entities.FinancingRequest.list("-created_date", 500),
        api.entities.Voucher.list("-created_date", 500),
        api.entities.Settlement.list("-created_date", 500),
        api.entities.Harvest.list("-created_date", 500),
        api.entities.FieldVerification.list("-created_date", 5000),
      ]);
      let interestPortfolio = null;
      try {
        interestPortfolio = await api.integrations.Finance.AccruePortfolioInterest();
      } catch (error) {
        setLoadError(error.message || "Could not update monthly interest accrual.");
      }
      const outstanding = financing.filter((f) => f.status === "approved").reduce((s, f) => s + (f.approved_amount || 0), 0);
      const voucherValue = vouchers.reduce((s, v) => s + (v.total_value || 0), 0);
      const payables = settlements.filter((s) => s.status !== "paid").reduce((s2, s) => s2 + (s.amount || 0), 0);
      const paidOut = settlements.filter((s) => s.status === "paid").reduce((s2, s) => s2 + (s.amount || 0), 0);
      setStats({
        farmers: farmers.length,
        verifiedFarmers: farmers.filter((f) => f.verification_status === "verified").length,
        vendors: vendors.length,
        activeVendors: vendors.filter((v) => v.status === "active").length,
        orders: orders.length,
        pendingOrders: orders.filter((o) => !["completed", "fulfilled", "cancelled"].includes(o.status)).length,
        financingRequests: financing.length,
        outstanding,
        voucherValue,
        redeemedVouchers: vouchers.filter((v) => v.status === "redeemed" || v.status === "settled").length,
        payables,
        paidOut,
        harvests: harvests.length,
        fieldVerifications: fieldVerifications.length,
        pendingFieldSubmissions: fieldVerifications.filter((verification) => verification.status === "pending_admin_review").length,
        interestPortfolio,
      });
      } catch (error) {
        setLoadError(error.message || "Could not load the admin dashboard.");
      }
    })();
  }, []);

  if (!stats) {
    return loadError
      ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
      : <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  }

  const cards = [
    { label: "Farmers", value: stats.farmers, sub: `${stats.verifiedFarmers} field verified`, icon: Users, accent: "emerald", to: "/admin/users" },
    { label: "Field Submissions for Review", value: stats.pendingFieldSubmissions, sub: "Awaiting admin verification", icon: ClipboardCheck, accent: "amber", to: "/admin/approvals" },
    { label: "Field Verification Archive", value: stats.fieldVerifications, sub: "Open reports, evidence and decisions", icon: ClipboardCheck, accent: "cyan", to: "/admin/field-verifications" },
    { label: "Vendors", value: stats.vendors, sub: `${stats.activeVendors} active`, icon: Store, accent: "blue", to: "/admin/users" },
    { label: "Orders", value: stats.orders, sub: `${stats.pendingOrders} in progress`, icon: ClipboardList, accent: "amber", to: "/admin/approvals" },
    { label: "Financing Outstanding", value: `KES ${stats.outstanding.toLocaleString()}`, icon: Wallet, accent: "rose", to: "/admin/approvals" },
    { label: "Interest Outstanding", value: stats.interestPortfolio ? `KES ${Number(stats.interestPortfolio.summary.interest_balance).toLocaleString()}` : "Unavailable", sub: stats.interestPortfolio ? `${stats.interestPortfolio.summary.individuals} borrowers · ${Number(stats.interestPortfolio.summary.monthly_interest).toLocaleString()} accrued this month` : "Interest report could not be loaded", icon: TrendingUp, accent: "violet", to: "/admin/interest" },
    { label: "Voucher Value Issued", value: `KES ${stats.voucherValue.toLocaleString()}`, icon: Ticket, accent: "violet", to: "/admin/vouchers" },
    { label: "Redeemed Vouchers", value: stats.redeemedVouchers, icon: Ticket, accent: "indigo", to: "/admin/vouchers" },
    { label: "Vendor Payables", value: `KES ${stats.payables.toLocaleString()}`, icon: Banknote, accent: "rose", to: "/admin/approvals" },
    { label: "Vendor Payments Made", value: `KES ${stats.paidOut.toLocaleString()}`, icon: Banknote, accent: "emerald", to: "/admin/approvals" },
    { label: "Harvest Records", value: stats.harvests, icon: Sprout, accent: "cyan", to: "/admin/harvest" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Platform Overview</h1>
          <p className="text-slate-500 text-sm mt-0.5">Financing exposure, redemptions and vendor payables at a glance.</p>
        </div>
      </div>
      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            icon={c.icon}
            label={c.label}
            value={c.value}
            sub={c.sub}
            accent={c.accent}
            onClick={() => navigate(c.to)}
          />
        ))}
      </div>
    </div>
  );
}