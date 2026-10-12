import React, { useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { QrCode, CheckCircle2, XCircle } from "lucide-react";

export default function VendorRedeem() {
  const [code, setCode] = useState("");
  const [voucher, setVoucher] = useState(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const search = async (e) => {
    e.preventDefault();
    setSearched(true);
    setResult(null);
    const me = await api.auth.me();
    const vendorUserId = me.vendor_employment?.vendor_user_id || me.id;
    const vouchers = await api.entities.Voucher.filter({ voucher_code: code.trim() });
    const v = vouchers[0];
    if (!v || v.vendor_user_id !== vendorUserId) {
      setVoucher(null);
      setResult({ ok: false, message: "Voucher not found or not issued for your store." });
      return;
    }
    setVoucher(v);
  };

  const redeem = async () => {
    setBusy(true);
    const me = await api.auth.me();
    const vendorUserId = me.vendor_employment?.vendor_user_id || me.id;
    if (voucher.status !== "active") {
      setResult({ ok: false, message: `Voucher cannot be redeemed — current status: ${voucher.status}.` });
      setBusy(false);
      return;
    }
    if (new Date(voucher.expiry_date) < new Date()) {
      await api.entities.Voucher.update(voucher.id, { status: "expired" });
      setResult({ ok: false, message: "This voucher has expired." });
      setBusy(false);
      return;
    }
    await api.entities.Voucher.update(voucher.id, { status: "redeemed" });
    await api.entities.Redemption.create({
      voucher_id: voucher.id, voucher_code: voucher.voucher_code,
      farmer_user_id: voucher.farmer_user_id, vendor_user_id: vendorUserId,
      redeemed_at: new Date().toISOString(), verification_result: "approved",
    });
    if (voucher.order_id) {
      await api.entities.Order.update(voucher.order_id, { status: "fulfilled" });
    }
    await api.entities.Settlement.create({
      voucher_id: voucher.id, order_id: voucher.order_id, amount: voucher.total_value,
      status: "pending_review", claim_date: new Date().toISOString(),
    });
    await api.entities.AuditLog.create({ action: "VOUCHER_REDEEMED", entity_type: "Voucher", entity_id: voucher.id });
    setResult({ ok: true, message: "Voucher redeemed. Release the financed products to the farmer." });
    setVoucher({ ...voucher, status: "redeemed" });
    setBusy(false);
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Redeem Voucher</h1>
        <p className="text-slate-500 text-sm mt-1">Enter the voucher code presented by the farmer along with their verified identity.</p>
      </div>

      <form onSubmit={search} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="space-y-1.5">
          <Label>Voucher Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AGC-XXXXXXXX-XXXXXXXX" className="font-mono" />
        </div>
        <Button type="submit" className="bg-emerald-800 hover:bg-emerald-900 w-full">
          <QrCode className="w-4 h-4 mr-2" /> Look Up Voucher
        </Button>
      </form>

      {searched && !voucher && !result?.ok && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
          <XCircle className="w-4 h-4" /> {result?.message}
        </div>
      )}

      {voucher && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-sm text-slate-700">{voucher.voucher_code}</p>
            <StatusBadge status={voucher.status} />
          </div>
          <p className="text-sm text-slate-500">Authorized Value: KES {voucher.total_value?.toLocaleString()}</p>
          <p className="text-sm text-slate-500">Expires: {new Date(voucher.expiry_date).toLocaleDateString()}</p>
          <p className="text-xs text-amber-600">Confirm the farmer's verified identity matches this voucher before releasing products.</p>
          {voucher.status === "active" && (
            <Button onClick={redeem} disabled={busy} className="w-full bg-emerald-800 hover:bg-emerald-900">
              {busy ? "Processing..." : "Confirm Identity & Redeem"}
            </Button>
          )}
          {result && (
            <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {result.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}