import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";

// Landing page for Google sign-in: the backend redirects here with the session token in the URL
// fragment (#access_token=...&returnTo=...). Store it, scrub the URL, and continue to the app.
export default function AuthCallback() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("access_token");
    if (!token) {
      setFailed(true);
      return;
    }
    api.auth.setToken(token);
    window.history.replaceState(null, "", window.location.pathname);
    const target = params.get("returnTo") || "/";
    // same-origin paths only (the backend already validates; this is belt and braces)
    window.location.replace(target.startsWith("/") && !target.startsWith("//") && !target.includes("\\") ? target : "/");
  }, []);

  if (failed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-slate-700">Sign-in could not be completed.</p>
        <Link to="/login" className="text-primary font-medium hover:underline">Back to login</Link>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-emerald-700 rounded-full animate-spin" />
    </div>
  );
}
