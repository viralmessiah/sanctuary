import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { ArrowLeft, Loader2, Ticket, FileText } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function OrderDetail() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [financing, setFinancing] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [contract, setContract] = useState(null);
  const [loanSettings, setLoanSettings] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [terms, setTerms] = useState("");
  const [disclosureAcknowledged, setDisclosureAcknowledged] = useState(false);

  const load = async () => {
    const o = await api.entities.Order.get(orderId);
    setOrder(o);
    setAmount(o.total || "");
    const [frs, agrs, tokens, contracts, settings] = await Promise.all([
      o.financing_request_id ? api.entities.FinancingRequest.filter({ id: o.financing_request_id }) : [],
      api.entities.Agreement.filter({ order_id: orderId }),
      api.entities.Voucher.filter({ order_id: orderId }),
      api.entities.OfftakeContract.filter({ farmer_user_id: o.created_by_id, status: "active" }),
      api.entities.LoanSettings.filter({}, "-created_date", 100),
    ]);
    setFinancing(frs[0] || null);
    setAgreement(agrs[0] || null);
    setDisclosureAcknowledged(Boolean(agrs[0]?.disclosure_acknowledged_at));
    setToken(tokens[0] || null);
    setContract(contracts[0] || null);
    setLoanSettings(settings.find((item) => item.is_active) || settings[0] || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orderId]);

  const contractValue = Number(contract?.total_value || (Number(contract?.quantity || 0) * Number(contract?.price_per_unit || 0)));
  const configuredCreditLimit = loanSettings
    ? contractValue * Number(loanSettings.advance_percentage || 0) / 100
    : null;
  const creditLimit = configuredCreditLimit == null || !contract
    ? null
    : Math.min(
      configuredCreditLimit,
      loanSettings.maximum_financing_amount == null
        ? Number.POSITIVE_INFINITY
        : Number(loanSettings.maximum_financing_amount),
    );

  const requestFinancing = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const fr = await api.entities.FinancingRequest.create({
        order_id: orderId, offtake_contract_id: contract?.id, farmer_name: order.farmer_name,
        requested_amount: Number(amount), harvest_terms: terms,
        expected_yield: contract?.quantity, contract_price: contract?.price_per_unit,
        credit_limit: creditLimit,
      });
      await api.entities.Order.update(orderId, { status: "financing_pending", financing_request_id: fr.id });
      await load();
    } catch (error) {
      toast({ title: "Unable to request financing", description: error.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const signAgreement = async () => {
    setBusy(true);
    await api.entities.Agreement.update(agreement.id, {
      status: "signed",
      signed_at: new Date().toISOString(),
      disclosure_acknowledged_at: new Date().toISOString(),
    });
    await api.entities.Order.update(orderId, { status: "agreement_signed" });
    await load();
    setBusy(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> Back to Orders
      </Link>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Order — {order.vendor_name}</h1>
            <p className="text-xs text-slate-400">Placed {new Date(order.created_date).toLocaleDateString()}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="divide-y divide-slate-100">
          {order.items?.map((i, idx) => (
            <div key={idx} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-700">{i.product_name} × {i.quantity}</span>
              <span className="text-slate-900 font-medium">KES {i.total?.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-2">
          <span className="font-medium text-slate-900">Total</span>
          <span className="font-semibold text-slate-900">KES {order.total?.toLocaleString()}</span>
        </div>
      </div>

      {contract && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-700" />
            <h2 className="font-medium text-slate-900">Offtake Contract</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-400">Contract:</span> <span className="font-medium text-slate-900">{contract.contract_number}</span></div>
            <div><span className="text-slate-400">Buyer:</span> <span className="font-medium text-slate-900">{contract.buyer_name}</span></div>
            <div><span className="text-slate-400">Crop:</span> <span className="font-medium text-slate-900">{contract.crop}</span></div>
            <div><span className="text-slate-400">Total Value:</span> <span className="font-medium text-slate-900">KES {contract.total_value?.toLocaleString()}</span></div>
          </div>
          {creditLimit != null && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
              <span className="text-emerald-700 font-medium">Credit Limit: KES {creditLimit.toLocaleString()}</span>
              <p className="text-xs text-emerald-600 mt-0.5">Based on contract value × {loanSettings.advance_percentage}% configured advance rate, subject to the financing cap.</p>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Financing</h2>
          {financing && <StatusBadge status={financing.status} />}
        </div>
        {!financing ? (
          order.status === "submitted" ? (
            <form onSubmit={requestFinancing} className="space-y-3">
              {!contract && <p className="text-sm text-amber-600">You need an active offtake contract before requesting financing. <Link to="/farmer/contracts" className="underline">Create one →</Link></p>}
              <div className="space-y-1.5"><Label>Requested Amount (KES)</Label>              <Input type="number" min="0.01" max={creditLimit ?? undefined} required value={amount} onChange={(e) => setAmount(e.target.value)} />
              {creditLimit != null && <p className="text-xs text-slate-500">Maximum contract-backed request: KES {creditLimit.toLocaleString()}</p>}</div>
              <div className="space-y-1.5"><Label>Notes on Expected Harvest (optional)</Label><Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. Expect 40 bags of maize by August" /></div>
              <Button type="submit" disabled={busy || !contract} className="bg-emerald-800 hover:bg-emerald-900">Request Financing</Button>
            </form>
          ) : (
            <p className="text-sm text-slate-400">No financing requested for this order.</p>
          )
        ) : (
          <div className="text-sm space-y-1">
            <p className="text-slate-500">Requested: KES {financing.requested_amount?.toLocaleString()}</p>
            {financing.credit_limit != null && <p className="text-slate-500">Credit Limit: KES {financing.credit_limit?.toLocaleString()}</p>}
            {financing.stage1_approved_by && <p className="text-slate-500">Stage 1 (LO): Approved by {financing.stage1_approved_by}</p>}
            {financing.approved_amount != null && <p className="text-slate-500">Approved: KES {financing.approved_amount?.toLocaleString()}</p>}
            {financing.status === "rejected" && <p className="text-red-600">{financing.rejection_reason}</p>}
          </div>
        )}
      </div>

      {financing?.status === "approved" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-900">Harvest-Linked Agreement</h2>
            {agreement && <StatusBadge status={agreement.status} />}
          </div>
          {!agreement ? (
            <p className="text-sm text-slate-400">Waiting for the platform to generate your agreement.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400">Agreement No. {agreement.agreement_number}</p>
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap max-h-64 overflow-y-auto">{agreement.content}</div>
              {agreement.repayment_schedule?.length > 0 && (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <p><span className="text-slate-500">Financed principal:</span> KES {Number(agreement.financing_amount || 0).toLocaleString()}</p>
                    <p><span className="text-slate-500">Total cost to repay:</span> KES {Number(agreement.total_cost || 0).toLocaleString()}</p>
                    <p><span className="text-slate-500">Simple interest:</span> {agreement.monthly_interest_rate}% per month on outstanding principal; non-compounding</p>
                    <p><span className="text-slate-500">Buyer withholding:</span> {agreement.buyer_withholding_percentage}% of sale proceeds, applied to your balance</p>
                  </div>
                  <p className="text-xs text-slate-500">Projected schedule assumes the approved amount is released together. Actual interest is posted monthly on released principal and may change with tranche dates and repayments.</p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-2">Installment</th><th className="p-2">Due</th><th className="p-2">Principal</th><th className="p-2">Interest</th><th className="p-2">Total</th></tr></thead>
                      <tbody>{agreement.repayment_schedule.map((item) => (
                        <tr key={item.installment} className="border-t border-slate-100">
                          <td className="p-2">{item.installment}</td><td className="p-2">{new Date(`${item.due_date}T00:00:00`).toLocaleDateString()}</td>
                          <td className="p-2">KES {Number(item.principal).toLocaleString()}</td><td className="p-2">KES {Number(item.interest).toLocaleString()}</td><td className="p-2">KES {Number(item.amount).toLocaleString()}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {agreement.status === "pending_signature" ? (
                <>
                  <label className="flex items-start gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={disclosureAcknowledged} onChange={(event) => setDisclosureAcknowledged(event.target.checked)} className="mt-1" />
                    <span>I have reviewed the total cost, repayment schedule, monthly interest, and buyer withholding shown above, and acknowledge these terms before signing.</span>
                  </label>
                  <Button onClick={signAgreement} disabled={busy || !disclosureAcknowledged || !agreement.repayment_schedule?.length} className="bg-emerald-800 hover:bg-emerald-900">{busy ? "Processing..." : "Acknowledge disclosure & sign"}</Button>
                </>
              ) : (
                <p className="text-sm text-emerald-700">{agreement.status === "signed" || agreement.status === "active" ? `Signed ${agreement.disclosure_acknowledged_at ? "with disclosure acknowledged" : ""}. Awaiting financing release.` : agreement.status}</p>
              )}
            </>
          )}
        </div>
      )}

      {token && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-900 flex items-center gap-2"><Ticket className="w-4 h-4" /> Your Redemption Token</h2>
            <StatusBadge status={token.status} />
          </div>
          <div className="bg-emerald-800 text-white rounded-xl p-5 text-center">
            <p className="text-xs text-emerald-200 uppercase tracking-wide">Token Code</p>
            <p className="text-2xl font-mono font-semibold tracking-widest mt-1">{token.voucher_code}</p>
            <p className="text-xs text-emerald-200 mt-2">Valid until {new Date(token.expiry_date).toLocaleDateString()}</p>
          </div>
          <p className="text-xs text-slate-400">Present this code and your verified identity at {token.vendor_name} to collect your products.</p>
        </div>
      )}
    </div>
  );
}