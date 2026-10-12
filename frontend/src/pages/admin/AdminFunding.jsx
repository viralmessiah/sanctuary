import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Wallet } from "lucide-react";

const money = (value) => `KES ${Number(value || 0).toLocaleString()}`;

export default function AdminFunding() {
  const [facilities, setFacilities] = useState([]);
  const [applications, setApplications] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [tranches, setTranches] = useState([]);
  const [facilityName, setFacilityName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [facilityLimit, setFacilityLimit] = useState("");
  const [selectedFacility, setSelectedFacility] = useState("");
  const [selectedLoan, setSelectedLoan] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    const [f, a, g, d] = await Promise.all([
      api.entities.FundingFacility.list("-created_date", 200),
      api.entities.FinancingRequest.list("-created_date", 500),
      api.entities.Agreement.list("-created_date", 500),
      api.entities.LoanDisbursement.list("-created_date", 500),
    ]);
    setFacilities(f);
    setApplications(a.filter((item) => item.status === "approved"));
    setAgreements(g);
    setTranches(d);
    setSelectedFacility((current) => current || f.find((item) => item.status === "active")?.id || "");
    setSelectedLoan((current) => current || a.find((item) => item.status === "approved")?.id || "");
  };

  useEffect(() => {
    load().catch((err) => setError(err.message || "Could not load funding data."))
      .finally(() => setLoading(false));
  }, []);

  const createFacility = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api.entities.FundingFacility.create({
        facility_name: facilityName, provider_name: providerName,
        facility_limit: Number(facilityLimit), committed_amount: 0, status: "active",
      });
      setFacilityName(""); setProviderName(""); setFacilityLimit("");
      setNotice("Funding facility created."); await load();
    } catch (err) { setError(err.message || "Could not create facility."); }
    finally { setBusy(false); }
  };

  const releaseTranche = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api.entities.LoanDisbursement.create({
        financing_request_id: selectedLoan, facility_id: selectedFacility,
        amount: Number(amount), reference, notes: "Released from the administrator funding console.",
      });
      setAmount(""); setReference("");
      setNotice("Payout instruction recorded. Confirm it only after the payment provider or bank confirms the transfer."); await load();
    } catch (err) { setError(err.message || "Tranche release was rejected."); }
    finally { setBusy(false); }
  };

  const confirmPayout = async (item) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await api.entities.LoanDisbursement.update(item.id, { status: "released" });
      setNotice("Payout confirmation recorded in the append-only loan ledger.");
      await load();
    } catch (err) { setError(err.message || "Could not confirm this payout."); }
    finally { setBusy(false); }
  };

  const markPayoutFailed = async (item) => {
    const reason = window.prompt("Why did this payout fail?");
    if (!reason?.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.entities.LoanDisbursement.update(item.id, { status: "failed", notes: reason.trim() });
      setNotice("Failed payout recorded. No funds were added to the loan balance.");
      await load();
    } catch (err) { setError(err.message || "Could not record the failed payout."); }
    finally { setBusy(false); }
  };

  const accrueInterest = async () => {
    if (!selectedLoan) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.integrations.Finance.AccrueMonthlyInterest(selectedLoan);
      setNotice(`${result.created_entries} monthly interest entries posted. Current principal: ${money(result.principal_balance)}; interest: ${money(result.interest_balance)}.`);
      await load();
    } catch (err) { setError(err.message || "Could not accrue monthly interest."); }
    finally { setBusy(false); }
  };

  const selectedApplication = applications.find((item) => item.id === selectedLoan);
  const reservedForLoan = tranches.filter((item) =>
    item.financing_request_id === selectedLoan && ["pending_confirmation", "released"].includes(item.status)
  )
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const remainingForLoan = Math.max(Number(selectedApplication?.approved_amount || 0) - reservedForLoan, 0);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Funding facilities & disbursements</h1>
        <p className="mt-1 text-sm text-slate-500">Manage facility limits and release approved financing only after all contract and disclosure gates pass.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 font-medium">Funding facilities</h2>
        <form onSubmit={createFacility} className="grid gap-3 sm:grid-cols-4">
          <div><Label>Facility name</Label><Input required value={facilityName} onChange={(e) => setFacilityName(e.target.value)} /></div>
          <div><Label>Provider</Label><Input required value={providerName} onChange={(e) => setProviderName(e.target.value)} /></div>
          <div><Label>Limit (KES)</Label><Input required min="0.01" type="number" step="0.01" value={facilityLimit} onChange={(e) => setFacilityLimit(e.target.value)} /></div>
          <div className="flex items-end"><Button disabled={busy} className="w-full bg-emerald-800 hover:bg-emerald-900">Add facility</Button></div>
        </form>
        <div className="mt-4 divide-y divide-slate-100">
          {facilities.map((facility) => (
            <div key={facility.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <span className="font-medium">{facility.facility_name} <span className="font-normal text-slate-500">· {facility.provider_name} · {facility.status}</span></span>
              <span>{money(facility.committed_amount)} paid of {money(facility.facility_limit)} · {money(tranches.filter((item) => item.facility_id === facility.id && item.status === "pending_confirmation").reduce((sum, item) => sum + Number(item.amount || 0), 0))} pending confirmation</span>
            </div>
          ))}
          {facilities.length === 0 && <p className="py-3 text-sm text-slate-500">No facilities configured.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2"><Wallet className="h-5 w-5 text-emerald-700" /><h2 className="font-medium">Record a payout instruction</h2></div>
        <form onSubmit={releaseTranche} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Approved application</Label>
              <select required className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={selectedLoan} onChange={(e) => setSelectedLoan(e.target.value)}>
                <option value="">Select application</option>
                {applications.map((item) => <option key={item.id} value={item.id}>{item.farmer_name || item.id} — {money(item.approved_amount)}</option>)}
              </select>
            </div>
            <div><Label>Facility</Label>
              <select required className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={selectedFacility} onChange={(e) => setSelectedFacility(e.target.value)}>
                <option value="">Select active facility</option>
                {facilities.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.facility_name} — {money(Number(item.facility_limit || 0) - Number(item.committed_amount || 0))} available</option>)}
              </select>
            </div>
            <div><Label>Tranche amount (KES)</Label><Input required type="number" min="0.01" max={remainingForLoan} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Payment reference</Label><Input required value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>
          {selectedApplication && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Remaining approved amount: <strong>{money(remainingForLoan)}</strong>.
              Disclosure agreement: {agreements.some((item) => item.financing_request_id === selectedLoan && item.status === "signed" && item.disclosure_acknowledged_at) ? "signed" : "not signed"}.
              Contract signatures and buyer guarantee are verified by the server before release.
            </div>
          )}
          <Button disabled={busy || !selectedFacility || !selectedLoan || remainingForLoan <= 0} className="bg-emerald-800 hover:bg-emerald-900">
            {busy ? "Processing…" : "Record pending payout"}
          </Button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Recent tranche records</h2>
        {tranches.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-3 text-sm">
          <span>Tranche {item.tranche_number} · {item.reference || "No reference"} · {item.status}</span>
          <span>{money(item.amount)} · {item.released_at ? new Date(item.released_at).toLocaleDateString() : "Awaiting confirmation"}</span>
          {item.status === "pending_confirmation" && <span className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => confirmPayout(item)}>Confirm payment sent</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => markPayoutFailed(item)}>Mark failed</Button>
          </span>}
        </div>)}
        {!tranches.length && <p className="text-sm text-slate-500">No tranche records yet.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Monthly interest processing</h2>
        <p className="mt-1 text-sm text-slate-500">Interest is non-compounding and accrues on outstanding released principal at each tranche’s monthly anniversary. The operation is idempotent.</p>
        <Button disabled={busy || !selectedLoan} variant="outline" className="mt-3" onClick={accrueInterest}>Accrue through today for selected application</Button>
        <p className="mt-2 text-xs text-slate-500">For routine processing, schedule `python manage.py accrue_loan_interest` once per month.</p>
      </section>
    </div>
  );
}
