import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { useLocation } from "react-router-dom";
import { Clock3, ShieldAlert } from "lucide-react";

export default function VendorEmployeePending() {
  const { user } = useAuth();
  const location = useLocation();
  const suspended = new URLSearchParams(location.search).get("status") === "suspended";
  const employment = user?.vendor_employment;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {suspended ? (
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
        ) : (
          <Clock3 className="mx-auto h-10 w-10 text-emerald-700" />
        )}
        <h1 className="mt-4 text-xl font-semibold text-slate-900">
          {suspended ? "Vendor access is suspended" : "Waiting for vendor approval"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {suspended
            ? `Your access to ${employment?.vendor_name || "this vendor account"} is suspended. Contact the vendor account owner for assistance.`
            : `Your account is registered for ${employment?.vendor_name || "this vendor account"}. The vendor must approve your access before the workspace is available.`}
        </p>
        {employment?.role && (
          <p className="mt-4 text-xs text-slate-500">Assigned role: {employment.role}</p>
        )}
      </section>
    </main>
  );
}
