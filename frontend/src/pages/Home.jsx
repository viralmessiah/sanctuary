import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "@/api/client";

export default function Home() {
  const [redirect, setRedirect] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const user = await api.auth.me();
        if (user?.role === "admin") return setRedirect("/admin/dashboard");
        if (user?.vendor_employment) {
          if (user.vendor_employment.status === "active") {
            return setRedirect(user.vendor_employment.role === "assistant" ? "/vendor/products" : "/vendor/dashboard");
          }
          if (user.vendor_employment.status === "suspended") return setRedirect("/vendor/employee-pending?status=suspended");
          return setRedirect("/vendor/employee-pending");
        }
        if (user?.user_type === "farmer") return setRedirect("/farmer/dashboard");
        if (user?.user_type === "buyer") return setRedirect("/buyer/dashboard");
        if (user?.user_type === "loan_officer") return setRedirect("/loanofficer/dashboard");
        if (user?.user_type === "field_officer") return setRedirect("/fieldofficer/dashboard");
        if (user?.user_type === "vendor") return setRedirect("/vendor/dashboard");
        if (["insurer", "credit_bureau", "agronomist", "warehouse_logistics", "cooperative", "mobile_money", "compliance", "collections", "support_desk"].includes(user?.user_type)) return setRedirect("/partner");

      } catch {}

      setRedirect("/onboarding");
    })();
  }, []);

  if (!redirect) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-emerald-700 rounded-full animate-spin" />
      </div>
    );
  }

  return <Navigate to={redirect} replace />;
}