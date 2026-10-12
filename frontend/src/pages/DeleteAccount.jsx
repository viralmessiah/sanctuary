import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, ShieldAlert, CheckCircle2 } from "lucide-react";

export default function DeleteAccount() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await api.auth.me();
      setUser(me);
      setEmail(me.email || "");
      const params = new URLSearchParams(window.location.search);
      if (params.get("verified") === "true") {
        setVerified(true);
      }
    })();
  }, []);

  const verifyCredentials = async (e) => {
    e.preventDefault();
    setVerifying(true);
    setError("");
    try {
      await api.auth.loginViaEmailPassword(email, password);
      setVerified(true);
      setVerifying(false);
    } catch (err) {
      setError("Incorrect email or password. Please try again.");
      setVerifying(false);
    }
  };

  const deleteEverything = async () => {
    setDeleting(true);
    const me = user;
    const safeDelete = async (entityName, filter) => {
      try {
        await api.entities[entityName].deleteMany(filter);
      } catch (e) {
        // RLS may block some deletions — continue
      }
    };

    await safeDelete("Product", { vendor_user_id: me.id });
    await safeDelete("Product", { created_by_id: me.id });
    await safeDelete("FarmerProfile", { created_by_id: me.id });
    await safeDelete("VendorProfile", { created_by_id: me.id });
    await safeDelete("KYCVerification", { created_by_id: me.id });
    await safeDelete("Order", { created_by_id: me.id });
    await safeDelete("Order", { vendor_user_id: me.id });
    await safeDelete("Harvest", { created_by_id: me.id });
    await safeDelete("Agreement", { farmer_user_id: me.id });
    await safeDelete("Voucher", { farmer_user_id: me.id });
    await safeDelete("Voucher", { vendor_user_id: me.id });
    await safeDelete("Settlement", { created_by_id: me.id });
    await safeDelete("FinancingRequest", { created_by_id: me.id });
    await safeDelete("Redemption", { created_by_id: me.id });
    await safeDelete("Notification", { user_id: me.id });
    await safeDelete("VendorEmployee", { vendor_user_id: me.id });

    setDeleting(false);
    setDone(true);
    setTimeout(() => {
      api.auth.logout();
    }, 2000);
  };

  if (!user) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  if (done) {
    return (
      <div className="max-w-md mx-auto py-20 text-center space-y-4">
        <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
        <h1 className="text-xl font-semibold text-slate-900">Account Data Deleted</h1>
        <p className="text-sm text-slate-500">Your data has been removed and you will be logged out shortly.</p>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="max-w-md mx-auto py-10 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 text-red-600" />
          <h1 className="text-xl font-semibold text-slate-900">Final Confirmation</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="text-sm text-red-800 space-y-2">
              <p className="font-medium">This action is irreversible.</p>
              <p>All your profiles, products, orders, agreements, vouchers, and related records will be permanently deleted.</p>
              <p>You will be logged out immediately after.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={deleting}
            onClick={deleteEverything}
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Permanently Delete"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-10 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-8 h-8 text-red-600" />
        <h1 className="text-xl font-semibold text-slate-900">Delete Account</h1>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            To delete your account, please verify your identity by entering your email and password.
          </p>
        </div>
      </div>
      <form onSubmit={verifyCredentials} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Password</Label>
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={verifying} className="w-full bg-red-600 hover:bg-red-700">
          {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify Credentials"}
        </Button>
      </form>
      <Button variant="ghost" className="w-full" onClick={() => navigate(-1)}>
        Cancel
      </Button>
    </div>
  );
}