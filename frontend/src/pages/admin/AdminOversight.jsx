import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import StatusBadge from "@/components/shared/StatusBadge";
import { Download, Loader2, ShieldCheck } from "lucide-react";

const money = (value) => `KES ${Number(value || 0).toLocaleString()}`;

async function listAll(entity, pageSize = 5000) {
  const records = [];
  let skip = 0;
  while (true) {
    const page = await entity.list("-created_date", pageSize, skip);
    records.push(...page);
    if (page.length < pageSize) return records;
    skip += page.length;
  }
}

function getUnpaidScheduleRows(schedule, collections, today) {
  let remainingCollections = collections;
  return [...(schedule || [])]
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .map((row) => {
      const scheduledAmount = Number(row.amount ?? (Number(row.principal || 0) + Number(row.interest || 0)));
      const applied = Math.min(scheduledAmount, remainingCollections);
      remainingCollections = Math.max(remainingCollections - applied, 0);
      const outstanding = Math.max(scheduledAmount - applied, 0);
      const dueDate = new Date(`${row.due_date}T00:00:00`);
      const todayDate = new Date(`${today}T00:00:00`);
      const daysPastDue = outstanding > 0 && row.due_date < today
        ? Math.floor((todayDate - dueDate) / 86400000)
        : 0;
      return { ...row, outstanding, daysPastDue };
    })
    .filter((row) => row.outstanding > 0 && row.daysPastDue > 0);
}

export default function AdminOversight() {
  const { user } = useAuth();
  const [financing, setFinancing] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [settings, setSettings] = useState(null);
  const [cases, setCases] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [reconciliations, setReconciliations] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [audit, setAudit] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [f, l, s, c, settlementsData, reconciliationsData, complaintsData, fraud, logs] = await Promise.all([
      listAll(api.entities.FinancingRequest),
      listAll(api.entities.LoanLedgerEntry),
      api.entities.LoanSettings.filter({ is_active: true }, "-created_date", 1),
      api.entities.LoanCase.list("-created_date", 1000),
      api.entities.Settlement.list("-created_date", 1000),
      api.entities.SettlementReconciliation.list("-created_date", 1000),
      api.entities.Complaint.list("-created_date", 1000),
      api.entities.FraudAlert.list("-created_date", 1000),
      api.entities.AuditLog.list("-created_date", 1000),
    ]);
    setFinancing(f); setLedger(l); setSettings(s[0] || null); setCases(c);
    setSettlements(settlementsData); setComplaints(complaintsData);
    setReconciliations(reconciliationsData);
    setFraudAlerts(fraud); setAudit(logs);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message || "Could not load oversight data."))
      .finally(() => setLoading(false));
  }, []);

  const balances = useMemo(() => {
    const totals = new Map();
    for (const entry of ledger) {
      const current = totals.get(entry.financing_request_id) || { principal: 0, interest: 0 };
      current.principal += Number(entry.principal_delta || 0);
      current.interest += Number(entry.interest_delta || 0);
      totals.set(entry.financing_request_id, current);
    }
    return totals;
  }, [ledger]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const cashCollections = new Map();
  for (const entry of ledger) {
    if (!["repayment", "buyer_withholding"].includes(entry.entry_type)) continue;
    const collectionDate = (entry.effective_date || entry.created_date || "").slice(0, 10);
    if (collectionDate > today) continue;
    const current = cashCollections.get(entry.financing_request_id) || 0;
    cashCollections.set(entry.financing_request_id, current + Number(entry.amount || 0));
  }
  const loans = financing.filter((item) => item.status === "approved").map((item) => ({
    ...item,
    ...(balances.get(item.id) || { principal: 0, interest: 0 }),
    unpaidSchedule: getUnpaidScheduleRows(
      item.repayment_schedule,
      cashCollections.get(item.id) || 0,
      today,
    ),
  })).map((item) => ({
    ...item,
    daysPastDue: item.unpaidSchedule.reduce((max, row) => Math.max(max, row.daysPastDue), 0),
  }));
  const atRisk = loans.filter((item) => Number(item.principal) > 0 && item.daysPastDue > 0);
  const totalPrincipal = loans.reduce((sum, item) => sum + Math.max(Number(item.principal), 0), 0);
  const reserve = totalPrincipal * Number(settings?.reserve_percentage || 0) / 100;
  const collectionsThisMonth = ledger.filter((entry) =>
    ["repayment", "buyer_withholding"].includes(entry.entry_type) &&
    (entry.effective_date || entry.created_date || "").slice(0, 10) <= today &&
    (entry.effective_date || entry.created_date || "").slice(0, 7) === today.slice(0, 7)
  ).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const par = (days) => loans
    .filter((item) => item.daysPastDue >= days)
    .reduce((sum, item) => sum + Math.max(Number(item.principal), 0), 0);

  const act = async (id, action) => {
    setBusyId(id); setError("");
    try { await action(); await load(); }
    catch (err) { setError(err.message || "The requested review action failed."); }
    finally { setBusyId(""); }
  };

  const approveCase = (item) => {
    let evidence = item.evidence;
    if (item.case_type === "restructuring") {
      try { evidence = JSON.parse(drafts[`evidence-${item.id}`] || JSON.stringify(item.evidence)); }
      catch { setError("Restructuring evidence must be valid JSON."); return; }
    }
    act(item.id, () => api.entities.LoanCase.update(item.id, {
      status: "approved",
      decision_notes: drafts[item.id] || "Approved after review.",
      ...(item.case_type === "restructuring" ? { evidence } : {}),
    }));
  };

  const reviewReconciliation = (item, status) => {
    act(item.id, () => api.entities.SettlementReconciliation.update(item.id, {
      status,
      ...(status === "rejected" ? { reviewer_notes: drafts[`reconciliation-${item.id}`] || "" } : {}),
    }));
  };

  const exportReport = () => {
    const rows = [
      ["loan_id", "status", "principal_outstanding", "interest_outstanding", "days_past_due", "par_1_plus", "par_30_plus", "par_60_plus", "par_90_plus"],
      ...loans.map((item) => [
        item.id, item.status, Math.max(item.principal, 0).toFixed(2), Math.max(item.interest, 0).toFixed(2),
        item.daysPastDue,
        item.daysPastDue >= 1 ? "yes" : "no",
        item.daysPastDue >= 30 ? "yes" : "no",
        item.daysPastDue >= 60 ? "yes" : "no",
        item.daysPastDue >= 90 ? "yes" : "no",
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "sanctuary-portfolio-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-slate-900">Portfolio oversight</h1><p className="mt-1 text-sm text-slate-500">Risk, collections, reserves, disputes, complaints and audit trail.</p></div>
        <Button variant="outline" onClick={exportReport}><Download className="mr-2 h-4 w-4" />Export loan report CSV</Button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric title="Outstanding principal" value={money(totalPrincipal)} />
        <Metric title="PAR 1+" value={money(par(1))} detail={`${atRisk.length} loans with unpaid overdue installments`} />
        <Metric title="PAR 30+" value={money(par(30))} detail={`PAR 60+ ${money(par(60))} · PAR 90+ ${money(par(90))}`} />
        <Metric title="Collections this month" value={money(collectionsThisMonth)} />
        <Metric title="Policy reserve estimate" value={money(reserve)} detail={`${settings?.reserve_percentage || 0}% of principal; not a booked reserve`} />
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Schedule-based delinquency estimate</h2>
        {atRisk.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-3 text-sm">
          <span>{item.farmer_name || item.id} · {item.daysPastDue} days past due</span><span>Principal {money(item.principal)} · Interest {money(item.interest)}</span>
        </div>)}
        {!atRisk.length && <p className="text-sm text-slate-500">No approved loans currently have a past-due schedule row.</p>}
        <p className="mt-2 text-xs text-slate-400">Collections are allocated to the oldest scheduled installment first. PAR buckets are indicative until repayments are linked to specific due installments and validated against reconciled payment records.</p>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Loan cases & disputes ({cases.length})</h2>
        {cases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3">
          <div><p className="text-sm font-medium capitalize">{item.case_type.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{item.financing_request_id} · {item.status}</p><p className="mt-1 text-xs text-slate-500">{item.evidence?.farmer_report || item.evidence?.notes || ""}</p></div>
          <div className="flex gap-2">
            {item.status === "open" && <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.LoanCase.update(item.id, { status: "under_review" }))}>Start review</Button>}
            {item.status === "under_review" && <><Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.LoanCase.update(item.id, { status: "rejected", decision_notes: drafts[item.id] || "Not approved." }))}>Reject</Button><Button size="sm" disabled={busyId === item.id} className="bg-emerald-800 hover:bg-emerald-900" onClick={() => approveCase(item)}>Approve</Button></>}
            {item.status === "approved" && <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.LoanCase.update(item.id, { status: "resolved" }))}>Resolve</Button>}
          </div>
          {["open", "under_review"].includes(item.status) && <><Textarea className="basis-full" rows={2} value={drafts[item.id] || ""} onChange={(e) => setDrafts({ ...drafts, [item.id]: e.target.value })} placeholder="Decision notes" />
            {item.case_type === "restructuring" && <Textarea className="basis-full font-mono text-xs" rows={5} value={drafts[`evidence-${item.id}`] || JSON.stringify(item.evidence || {}, null, 2)} onChange={(e) => setDrafts({ ...drafts, [`evidence-${item.id}`]: e.target.value })} placeholder='{"total_cost":1200,"repayment_schedule":[{"installment":1,"amount":"600.00"},{"installment":2,"amount":"600.00"}]}' />}
          </>}
        </div>)}
        {!cases.length && <p className="text-sm text-slate-500">No active cases.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Delivery disputes & buyer settlements ({settlements.length})</h2>
        {settlements.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-3 text-sm">
          <span>{item.buyer_name || item.vendor_name || "Buyer"} · {money(item.gross_sale_amount || item.amount)} gross · {money(item.buyer_withholding_amount)} due · {money(item.buyer_verified_received_amount)} verified · farmer paid {money(item.farmer_payment_verified_amount)}</span>
          <StatusBadge status={item.status} />
        </div>)}
        {!settlements.length && <p className="text-sm text-slate-500">No settlements recorded.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-medium">Independent payment verification ({reconciliations.filter((item) => item.status === "pending_verification").length} pending)</h2>
        <p className="mb-3 text-xs text-slate-500">A different administrator must verify every buyer-supplied transaction receipt before it changes the loan ledger or is counted as paid to the farmer.</p>
        {reconciliations.filter((item) => item.status === "pending_verification").map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-3 border-t border-slate-100 py-3">
            <div className="min-w-[14rem] flex-1">
              <p className="text-sm font-medium capitalize">{item.payment_type.replaceAll("_", " ")} · {money(item.amount)}</p>
              <p className="text-xs text-slate-500">Buyer {item.buyer_user_id} · ref {item.external_reference} · settlement {item.settlement_id}</p>
              {item.evidence_url && <a className="text-xs text-emerald-700 underline" href={item.evidence_url} target="_blank" rel="noreferrer">Open transaction evidence</a>}
            </div>
            {String(item.created_by_id) === String(user?.id) ? (
              <p className="text-xs text-amber-700">Another administrator must review this claim.</p>
            ) : (
              <>
                <Textarea rows={1} className="max-w-xs" value={drafts[`reconciliation-${item.id}`] || ""} onChange={(e) => setDrafts({ ...drafts, [`reconciliation-${item.id}`]: e.target.value })} placeholder="Required reason if rejecting" />
                <Button size="sm" variant="outline" disabled={busyId === item.id || !drafts[`reconciliation-${item.id}`]?.trim()} onClick={() => reviewReconciliation(item, "rejected")}>Reject</Button>
                <Button size="sm" disabled={busyId === item.id} className="bg-emerald-800 hover:bg-emerald-900" onClick={() => reviewReconciliation(item, "verified")}>Verify received</Button>
              </>
            )}
          </div>
        ))}
        {!reconciliations.some((item) => item.status === "pending_verification") && <p className="text-sm text-slate-500">No transaction claims are awaiting verification.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Complaints ({complaints.length})</h2>
        {complaints.map((item) => <div key={item.id} className="space-y-2 border-t border-slate-100 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{item.category} · {item.message}</span><StatusBadge status={item.status} /></div>
          {["open", "under_review"].includes(item.status) && <div className="flex flex-wrap gap-2"><Textarea rows={2} className="min-w-[15rem] flex-1" value={drafts[`complaint-${item.id}`] || ""} onChange={(e) => setDrafts({ ...drafts, [`complaint-${item.id}`]: e.target.value })} placeholder="Resolution note" /><Button size="sm" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.Complaint.update(item.id, { status: "resolved", resolution: drafts[`complaint-${item.id}`] || "Reviewed by support." }))}>Resolve privately</Button></div>}
        </div>)}
        {!complaints.length && <p className="text-sm text-slate-500">No complaints submitted.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> Fraud review queue ({fraudAlerts.filter((item) => item.status === "open" || item.status === "under_review").length})</h2>
        {fraudAlerts.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3 text-sm">
          <span>{item.alert_type.replaceAll("_", " ")} · risk {item.risk_score}/100 · user {item.target_user_id}</span>
          <div className="flex items-center gap-2"><StatusBadge status={item.status} />{item.status === "open" && <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.FraudAlert.update(item.id, { status: "under_review" }))}>Review</Button>}{item.status === "under_review" && <><Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.FraudAlert.update(item.id, { status: "cleared" }))}>Clear</Button><Button size="sm" disabled={busyId === item.id} onClick={() => act(item.id, () => api.entities.FraudAlert.update(item.id, { status: "confirmed" }))}>Confirm</Button></>}</div>
        </div>)}
        {!fraudAlerts.length && <p className="text-sm text-slate-500">No automated alerts.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Recent audit events</h2>
        {audit.slice(0, 50).map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-2 text-xs text-slate-600">
          <span>{item.action} · {item.entity_type} · {item.entity_id}</span><span>{item.actor_email} · {new Date(item.created_date).toLocaleString()}</span>
        </div>)}
      </section>
    </div>
  );
}

function Metric({ title, value, detail }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>;
}
