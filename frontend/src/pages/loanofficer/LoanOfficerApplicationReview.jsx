import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import StatusBadge from "@/components/shared/StatusBadge";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function LoanOfficerApplicationReview() {
  const { applicationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [contract, setContract] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ amount: "", terms: "" });

  const load = async () => {
    const current = await api.entities.FinancingRequest.get(applicationId);
    const contracts = await api.entities.OfftakeContract.filter({ id: current.offtake_contract_id });
    setRequest(current);
    setContract(contracts[0] || null);
    setDraft({ amount: current.approved_amount || current.requested_amount || "", terms: current.harvest_terms || "" });
  };

  useEffect(() => { load(); }, [applicationId]);

  const runAction = async (action) => {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      if (action === "review") {
        await api.entities.FinancingRequest.update(request.id, { status: "under_review" });
      } else if (action === "stage1") {
        await api.entities.FinancingRequest.update(request.id, {
          status: "stage1_approved",
          stage1_approved_by: user.email,
          stage1_approved_at: now,
          stage1_notes: request.stage1_notes || "Initial review completed.",
        });
      } else if (action === "approve") {
        const amount = Number(draft.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > Number(request.requested_amount)) {
          throw new Error("Enter an approved amount greater than zero and no more than the amount requested.");
        }
        await api.entities.FinancingRequest.update(request.id, {
          status: "approved",
          approved_amount: amount,
          approved_by: user.email,
          approved_at: now,
          harvest_terms: draft.terms,
        });
        const agreementNumber = `AGR-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const content = `HARVEST-LINKED FINANCING AGREEMENT\n\nAgreement No: ${agreementNumber}\nFarmer: ${request.farmer_name || "Farmer"}\nOrder: ${request.order_id}\nOfftake Contract: ${request.offtake_contract_id}\nFinancing Amount: KES ${amount.toLocaleString()}\n\n${draft.terms || "Repayment and other terms are subject to the signed agreement."}`;
        await api.entities.Agreement.create({
          agreement_number: agreementNumber,
          farmer_user_id: request.created_by_id,
          farmer_name: request.farmer_name,
          financing_request_id: request.id,
          offtake_contract_id: request.offtake_contract_id,
          order_id: request.order_id,
          financing_amount: amount,
          harvest_terms: draft.terms,
          content,
          status: "pending_signature",
        });
        await api.entities.AuditLog.create({ action: "LOAN_OFFICER_UNDERWRITING_APPROVED", entity_type: "FinancingRequest", entity_id: request.id });
        navigate("/loanofficer/contracts");
        return;
      } else if (action === "reject") {
        await api.entities.FinancingRequest.update(request.id, {
          status: "rejected",
          rejection_reason: draft.terms || "Not eligible at this time.",
        });
      }
      await load();
    } catch (error) {
      toast({ title: "Unable to update application", description: error.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!request) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/loanofficer/applications" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /> Applications</Link>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-semibold text-slate-900">{request.farmer_name || "Farmer application"}</h1><p className="text-sm text-slate-500">Application {request.id}</p></div>
          <StatusBadge status={request.status} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <p><span className="text-slate-400">Requested:</span> KES {Number(request.requested_amount || 0).toLocaleString()}</p>
          <p><span className="text-slate-400">Order:</span> {request.order_id}</p>
          <p><span className="text-slate-400">Buyer contract:</span> {contract?.contract_number || "Linked contract unavailable"}</p>
          <p><span className="text-slate-400">Buyer:</span> {contract?.buyer_name || "—"}</p>
          <p><span className="text-slate-400">Crop:</span> {contract?.crop || "—"}</p>
          <p><span className="text-slate-400">Expected yield:</span> {request.expected_yield || contract?.quantity || "—"} {contract?.unit || ""}</p>
        </div>
        {request.stage1_notes && <p className="text-sm text-slate-600">Review notes: {request.stage1_notes}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h2 className="font-medium text-slate-900">Underwriting decision</h2>
        {request.status === "approved" ? (
          <p className="text-sm text-emerald-700">Approved for KES {Number(request.approved_amount || 0).toLocaleString()}. The agreement is in the contract signing queue.</p>
        ) : ["rejected", "returned"].includes(request.status) ? (
          <p className="text-sm text-slate-600">{request.rejection_reason || `Application ${request.status}.`}</p>
        ) : (
          <>
            <div className="space-y-1.5"><Label>Approved amount (KES)</Label><Input type="number" min="1" max={request.requested_amount} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></div>
            <div className="space-y-1.5"><Label>Underwriting notes / terms</Label><Textarea rows={3} value={draft.terms} onChange={(event) => setDraft({ ...draft, terms: event.target.value })} /></div>
            <div className="flex flex-wrap gap-2">
              {request.status === "requested" && <Button variant="outline" disabled={busy} onClick={() => runAction("review")}>Start review</Button>}
              {["requested", "under_review"].includes(request.status) && <Button variant="outline" disabled={busy} onClick={() => runAction("stage1")}>Complete initial review</Button>}
              {["stage1_approved", "returned"].includes(request.status) && <Button className="bg-emerald-800 hover:bg-emerald-900" disabled={busy || !contract} onClick={() => runAction("approve")}>Approve & prepare contract</Button>}
              <Button variant="outline" disabled={busy} onClick={() => runAction("reject")}>Reject application</Button>
            </div>
            {!contract && <p className="text-sm text-red-600">Cannot approve: the financing request's buyer contract is not visible.</p>}
          </>
        )}
      </div>
    </div>
  );
}
