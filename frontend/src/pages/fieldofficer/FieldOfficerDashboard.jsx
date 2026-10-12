import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Loader2, ClipboardCheck, CheckCircle, XCircle } from "lucide-react";

export default function FieldOfficerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const [profile, verifications] = await Promise.all([
        api.entities.FieldOfficerProfile.filter({ created_by_id: user.id }).then((r) => r[0] || null),
        api.entities.FieldVerification.filter({ officer_user_id: user.id }, "-created_date", 500),
      ]);
      setStats({
        profile,
        pending: verifications.filter((v) => v.status === "assigned" || v.status === "in_progress").length,
        approved: verifications.filter((v) => v.status === "approved").length,
        rejected: verifications.filter((v) => v.status === "rejected").length,
      });
    })();
  }, []);

  if (!stats) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const cards = [
    { label: "Pending Verifications", value: stats.pending, icon: ClipboardCheck, to: "/fieldofficer/assignments" },
    { label: "Approved", value: stats.approved, icon: CheckCircle, to: "/fieldofficer/assignments" },
    { label: "Rejected", value: stats.rejected, icon: XCircle, to: "/fieldofficer/assignments" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Field Officer Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Verify farmer land and documents before admin approval.</p>
      </div>
      {stats.profile?.status !== "active" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Your account is pending review. You'll receive assignments once approved.
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-4">
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