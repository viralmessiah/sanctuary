import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

const money = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminInterest() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const canAccrue = user?.role === "admin" || user?.user_type === "collections";
      setPortfolio(canAccrue
        ? await api.integrations.Finance.AccruePortfolioInterest()
        : await api.integrations.Finance.InterestPortfolio());
    } catch (err) {
      setError(err.message || "Could not calculate the monthly interest portfolio.");
    } finally {
      setLoading(false);
    }
  }, [user?.role, user?.user_type]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Monthly interest</h1>
          <p className="mt-1 text-sm text-slate-500">
            Current loan balances and monthly interest posted to the append-only ledger. Interest is simple and applies to outstanding released principal.
          </p>
        </div>
        {(user?.role === "admin" || user?.user_type === "collections") && <Button variant="outline" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Update monthly accrual
        </Button>}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && !portfolio && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>}

      {portfolio && (
        <>
          <p className="text-xs text-slate-500">Calculated through {portfolio.as_of} · Current month: {portfolio.month}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Borrowers with outstanding loans", portfolio.summary.individuals, Wallet],
              ["Principal outstanding", money(portfolio.summary.principal_balance), Wallet],
              ["Interest outstanding", money(portfolio.summary.interest_balance), TrendingUp],
              ["Interest posted this month", money(portfolio.summary.monthly_interest), TrendingUp],
            ].map(([label, value, Icon]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm text-slate-500"><Icon className="h-4 w-4 text-emerald-700" />{label}</div>
                <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Borrower balances</h2>
              <p className="mt-1 text-xs text-slate-500">Totals combine each farmer’s approved loans with released funds.</p>
            </div>
            {portfolio.individuals.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Farmer</th><th className="px-4 py-3">Loans</th>
                      <th className="px-4 py-3">Principal outstanding</th><th className="px-4 py-3">Interest outstanding</th>
                      <th className="px-4 py-3">Interest this month</th><th className="px-4 py-3">Total owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.individuals.map((person) => (
                      <tr key={person.borrower_user_id || person.farmer_name} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{person.farmer_name}</td>
                        <td className="px-4 py-3">{person.loans_count}</td>
                        <td className="px-4 py-3">{money(person.principal_balance)}</td>
                        <td className="px-4 py-3">{money(person.interest_balance)}</td>
                        <td className="px-4 py-3">{money(person.monthly_interest)}</td>
                        <td className="px-4 py-3 font-semibold">{money(person.total_owed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-slate-500">No outstanding released loans found.</p>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Monthly accruals by loan</h2>
              <p className="mt-1 text-xs text-slate-500">A month appears after its scheduled accrual date and is recorded once.</p>
            </div>
            {portfolio.loans.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-4 py-3">Farmer</th><th className="px-4 py-3">Monthly rate</th><th className="px-4 py-3">Month</th><th className="px-4 py-3">Interest accrued</th><th className="px-4 py-3">Loan balance</th></tr>
                  </thead>
                  <tbody>
                    {portfolio.loans.flatMap((loan) => loan.monthly_history.map((period) => (
                      <tr key={`${loan.financing_request_id}-${period.month}`} className="border-t border-slate-100">
                        <td className="px-4 py-3">{loan.farmer_name}</td>
                        <td className="px-4 py-3">{loan.monthly_interest_rate}%</td>
                        <td className="px-4 py-3">{period.month}</td>
                        <td className="px-4 py-3">{money(period.amount)}</td>
                        <td className="px-4 py-3">{money(loan.total_owed)}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-slate-500">No interest has accrued yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
