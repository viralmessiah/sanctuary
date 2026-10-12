import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Wallet } from "lucide-react";

const money = (value) => `KES ${Number(value || 0).toLocaleString()}`;

export default function MyLoan() {
  const { user } = useAuth();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cases, setCases] = useState([]);
  const [caseType, setCaseType] = useState("crop_failure");
  const [caseNotes, setCaseNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [interestPortfolio, setInterestPortfolio] = useState(null);

  useEffect(() => {
    Promise.all([
      api.entities.FinancingRequest.list("-created_date", 100),
      api.integrations.Finance.InterestPortfolio(),
    ])
      .then(async ([requests, portfolio]) => {
        setInterestPortfolio(portfolio);
        const active = requests.filter((item) => ["approved", "returned"].includes(item.status));
        const records = await Promise.all(active.map(async (loan) => {
          const [ledger, tranches, sales] = await Promise.all([
            api.entities.LoanLedgerEntry.filter({ financing_request_id: loan.id }, "created_date", 500),
            api.entities.LoanDisbursement.filter({ financing_request_id: loan.id }, "created_date", 100),
            api.entities.Settlement.filter({ offtake_contract_id: loan.offtake_contract_id }, "-created_date", 200),
          ]);
          const principal = ledger.reduce((sum, entry) => sum + Number(entry.principal_delta || 0), 0);
          const interest = ledger.reduce((sum, entry) => sum + Number(entry.interest_delta || 0), 0);
          const lastInterestAccrual = ledger
            .filter((entry) => entry.entry_type === "interest_accrual")
            .reduce((latest, entry) => {
              const date = entry.effective_date || entry.created_date;
              return date && (!latest || date > latest) ? date : latest;
            }, "");
          return { ...loan, ledger, tranches, sales, lastInterestAccrual, principal: Math.max(principal, 0), interest: Math.max(interest, 0) };
        }));
        setLoans(records);
        const caseRecords = await api.entities.LoanCase.list("-created_date", 200);
        setCases(caseRecords);
      })
      .catch((err) => setError(err.message || "Could not load your loan information."))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const submitCase = async (loan, event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api.entities.LoanCase.create({
        financing_request_id: loan.id,
        case_type: caseType,
        evidence: { farmer_report: caseNotes.trim() },
      });
      setCaseNotes("");
      setNotice("Your case was submitted to the review queue.");
      setCases(await api.entities.LoanCase.list("-created_date", 200));
    } catch (err) { setError(err.message || "Could not submit your case."); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My loan</h1>
        <p className="mt-1 text-sm text-slate-500">Released funds, recorded interest, current balance and your repayment schedule. Interest is simple, not compounded, and is posted monthly on outstanding released principal.</p>
      </div>
      {interestPortfolio && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total outstanding</p><p className="mt-1 font-semibold">{money(interestPortfolio.summary.total_owed)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Interest outstanding</p><p className="mt-1 font-semibold">{money(interestPortfolio.summary.interest_balance)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Interest posted this month</p><p className="mt-1 font-semibold">{money(interestPortfolio.summary.monthly_interest)}</p></div>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {loans.length === 0 && !error && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <Wallet className="mx-auto mb-3 h-7 w-7 text-slate-400" />
          <p className="font-medium text-slate-800">No approved loan yet</p>
          <p className="mt-1 text-sm text-slate-500">Approved financing will appear here after it is released.</p>
        </div>
      )}
      {loans.map((loan) => (
        <section key={loan.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Loan application</h2>
              <p className="text-xs text-slate-500">Status: {loan.status} · Approved: {money(loan.approved_amount)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Current balance</p>
              <p className="text-lg font-semibold text-slate-900">{money(loan.principal + loan.interest)}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Principal outstanding</p><p className="font-medium">{money(loan.principal)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Interest outstanding</p><p className="font-medium">{money(loan.interest)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Buyer withholding</p><p className="font-medium">{loan.buyer_withholding_percentage ?? "—"}% of eligible sale</p></div>
          </div>
          <p className="text-xs text-slate-500">
            Last recorded interest accrual: {loan.lastInterestAccrual ? new Date(loan.lastInterestAccrual).toLocaleDateString() : "none"}
          </p>
          {interestPortfolio?.loans.find((item) => item.financing_request_id === loan.id)?.monthly_history?.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Monthly interest posted</h3>
              {interestPortfolio.loans.find((item) => item.financing_request_id === loan.id).monthly_history.map((period) => (
                <div key={period.month} className="flex justify-between border-t border-slate-100 py-2 text-sm">
                  <span>{period.month}</span><span>{money(period.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-medium">Release tranches</h3>
            {loan.tranches.length ? loan.tranches.map((item) => (
              <div key={item.id} className="flex justify-between border-t border-slate-100 py-2 text-sm">
                <span>Tranche {item.tranche_number} · {item.status === "released" && item.released_at ? new Date(item.released_at).toLocaleDateString() : item.status.replaceAll("_", " ")}</span>
                <span>{money(item.amount)}</span>
              </div>
            )) : <p className="text-sm text-slate-500">No funds have been released.</p>}
          </div>
          {loan.repayment_schedule?.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Repayment schedule</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500"><tr><th className="py-2">Installment</th><th>Due date</th><th>Principal</th><th>Interest</th><th>Amount</th></tr></thead>
                  <tbody>{loan.repayment_schedule.map((row) => (
                    <tr key={row.installment} className="border-t border-slate-100">
                      <td className="py-2">{row.installment}</td><td>{row.due_date}</td><td>{money(row.principal)}</td><td>{money(row.interest)}</td><td>{money(row.amount)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-medium">Loan movements</h3>
            {loan.ledger.length ? loan.ledger.map((entry) => (
              <div key={entry.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-2 text-xs text-slate-600">
                <span>{entry.entry_type.replaceAll("_", " ")} · {new Date(entry.created_date).toLocaleDateString()}</span>
                <span>Principal {money(entry.principal_balance)} · Interest {money(entry.interest_balance)}</span>
              </div>
            )) : <p className="text-sm text-slate-500">No loan movements have been recorded.</p>}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Harvest sale and recovery reconciliation</h3>
            {loan.sales.length ? loan.sales.map((sale) => (
              <div key={sale.id} className="space-y-2 border-t border-slate-100 py-3 text-xs text-slate-600">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{sale.delivery_quantity} {sale.unit || "units"} · {sale.crop_grade?.replaceAll("_", " ") || "grade pending"} · sale {sale.status.replaceAll("_", " ")}</span>
                  {sale.delivery_evidence_url && <a className="text-emerald-700 underline" href={sale.delivery_evidence_url} target="_blank" rel="noreferrer">View weigh ticket / receipt</a>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <p>Gross sale: {money(sale.gross_sale_amount)}</p>
                  <p>Contract price per {sale.unit || "unit"}: {money(sale.price_per_unit)}</p>
                  <p>Loan withholding due: {money(sale.buyer_withholding_amount)} ({sale.buyer_remittance_status?.replaceAll("_", " ")})</p>
                  <p>Buyer reported: {money(sale.buyer_remitted_amount)}</p>
                  <p>Withholding verified received: {money(sale.buyer_verified_received_amount)}</p>
                  <p>Farmer payment due: {money(sale.farmer_payment_due_amount)}</p>
                  <p>Farmer payment verified paid: {money(sale.farmer_payment_verified_amount)} ({sale.farmer_payment_status?.replaceAll("_", " ")})</p>
                </div>
                <p className="font-medium text-slate-700">Remaining loan balance now: {money(loan.principal + loan.interest)}</p>
              </div>
            )) : <p className="text-sm text-slate-500">No contracted crop deliveries have been reconciled yet.</p>}
          </div>
          <form onSubmit={(event) => submitCase(loan, event)} className="space-y-3 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-medium">Report a problem or request a review</h3>
            <div><Label>Case type</Label><select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={caseType} onChange={(e) => setCaseType(e.target.value)}>
              <option value="crop_failure">Crop failure</option><option value="buyer_default">Buyer default</option>
              <option value="side_selling">Side-selling concern</option><option value="delivery_dispute">Delivery dispute</option>
              <option value="restructuring">Request restructuring</option>
            </select></div>
            {caseType === "restructuring" && <p className="text-xs text-amber-700">A restructure is only effective after an authorized reviewer approves written revised terms.</p>}
            <Textarea required minLength={8} rows={3} value={caseNotes} onChange={(e) => setCaseNotes(e.target.value)} placeholder="Describe the issue and any evidence you can provide." />
            <Button disabled={busy} variant="outline">{busy ? "Submitting…" : "Submit case"}</Button>
          </form>
          <div className="border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-sm font-medium">Reported cases</h3>
            {cases.filter((item) => item.financing_request_id === loan.id).map((item) => (
              <p key={item.id} className="flex justify-between border-t border-slate-100 py-2 text-sm capitalize"><span>{item.case_type.replaceAll("_", " ")}</span><span className="text-slate-500">{item.status}</span></p>
            ))}
            {!cases.some((item) => item.financing_request_id === loan.id) && <p className="text-sm text-slate-500">No cases reported.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
