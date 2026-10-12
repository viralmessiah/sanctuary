import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

const emptyForm = {
  monthly_interest_rate: "",
  buyer_withholding_percentage: "",
  advance_percentage: "",
  maximum_financing_amount: "",
  maximum_withholding_amount: "",
  default_tenor_months: "",
  reserve_percentage: "",
  is_active: true,
};

export default function AdminLoanSettings() {
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const settings = await api.entities.LoanSettings.filter({}, "-created_date", 100);
    const active = settings.find((item) => item.is_active) || settings[0] || null;
    setRecord(active);
    if (active) {
      setForm({
        monthly_interest_rate: active.monthly_interest_rate ?? "",
        buyer_withholding_percentage: active.buyer_withholding_percentage ?? "",
        advance_percentage: active.advance_percentage ?? "",
        maximum_financing_amount: active.maximum_financing_amount ?? "",
        maximum_withholding_amount: active.maximum_withholding_amount ?? "",
        default_tenor_months: active.default_tenor_months ?? "",
        reserve_percentage: active.reserve_percentage ?? "",
        is_active: true,
      });
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        monthly_interest_rate: Number(form.monthly_interest_rate),
        buyer_withholding_percentage: Number(form.buyer_withholding_percentage),
        advance_percentage: Number(form.advance_percentage),
        maximum_financing_amount: form.maximum_financing_amount === "" ? null : Number(form.maximum_financing_amount),
        maximum_withholding_amount: form.maximum_withholding_amount === "" ? null : Number(form.maximum_withholding_amount),
        default_tenor_months: Number(form.default_tenor_months),
        reserve_percentage: Number(form.reserve_percentage),
        is_active: true,
      };
      if (record) await api.entities.LoanSettings.update(record.id, payload);
      else await api.entities.LoanSettings.create(payload);
      toast({ title: "Loan settings saved" });
      await load();
    } catch (error) {
      toast({ title: "Unable to save loan settings", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  const field = (key, label, options = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type="number"
        min={options.min ?? 0}
        max={options.max}
        step={options.step || "0.01"}
        required={!options.optional}
        placeholder={options.optional ? "No cap" : ""}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </div>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Financing Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Configure pricing and exposure limits. Approved loans keep a snapshot of the settings used.</p>
      </div>
      <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          {field("monthly_interest_rate", "Interest per month on outstanding principal (%)", { step: "0.01" })}
          {field("buyer_withholding_percentage", "Buyer withholding from sale (%)", { min: 0, max: 100 })}
          {field("advance_percentage", "Maximum advance against contract value (%)", { min: 0.01, max: 100 })}
          {field("default_tenor_months", "Default repayment term (months)", { min: 1, step: "1" })}
          {field("reserve_percentage", "Loss reserve (%)", { min: 0, max: 100 })}
          {field("maximum_financing_amount", "Maximum financing amount (KES)", { optional: true })}
          {field("maximum_withholding_amount", "Maximum buyer withholding per sale (KES)", { optional: true })}
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          <Settings className="w-4 h-4 mt-0.5 text-slate-400" />
          <p>Interest accrues monthly, without compounding, on released principal outstanding. Contract-backed financing is limited by this advance rate and any maximum amount. A blank amount cap means no additional cap.</p>
        </div>
        <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">{saving ? "Saving..." : "Save active settings"}</Button>
      </form>
    </div>
  );
}
