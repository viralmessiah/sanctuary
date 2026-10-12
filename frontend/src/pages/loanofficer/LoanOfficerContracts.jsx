import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { FileSignature, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function LoanOfficerContracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const requests = await api.entities.FinancingRequest.filter({}, "-created_date", 500);
    const contractIds = [...new Set(requests.map((request) => request.offtake_contract_id).filter(Boolean))];
    const linked = contractIds.length
      ? await api.entities.OfftakeContract.filter({ id: { $in: contractIds } }, "-created_date", 500)
      : [];
    setContracts(linked);
  };
  useEffect(() => { load(); }, [user.id]);

  const sign = async (contract) => {
    setBusyId(contract.id);
    try {
      await api.entities.OfftakeContract.update(contract.id, { loan_officer_signed_at: new Date().toISOString() });
      await api.entities.AuditLog.create({ action: "LOAN_OFFICER_OFFTAKE_CONTRACT_SIGNED", entity_type: "OfftakeContract", entity_id: contract.id });
      await load();
    } catch (error) {
      toast({ title: "Unable to sign contract", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (!contracts) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  const linked = contracts.filter((contract) => contract.status === "active");
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Contract Signing</h1><p className="text-slate-500 text-sm mt-1">Review the same buyer-farmer offtake contract and sign as the loan officer.</p></div>
      {linked.length === 0 ? <EmptyState icon={FileSignature} title="No active financing contracts" /> : (
        <div className="space-y-3">
          {linked.map((contract) => (
            <div key={contract.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="font-medium text-slate-900">{contract.contract_number}</p><p className="text-xs text-slate-400">{contract.farmer_name} · {contract.buyer_name} · {contract.crop} · {contract.quantity} {contract.unit}</p></div>
                <StatusBadge status={contract.status} />
              </div>
              <p className="text-sm text-slate-600">Farmer: {contract.farmer_signed_at ? "signed" : "awaiting signature"} · Buyer: {contract.buyer_signed_at ? "signed" : "awaiting signature"}</p>
              {contract.loan_officer_signed_at ? <p className="text-sm text-emerald-700">You signed this contract {new Date(contract.loan_officer_signed_at).toLocaleString()}.</p> : (
                <Button className="bg-emerald-800 hover:bg-emerald-900" disabled={busyId === contract.id || !contract.farmer_signed_at || !contract.buyer_signed_at} onClick={() => sign(contract)}>
                  Sign shared offtake contract
                </Button>
              )}
              {(!contract.farmer_signed_at || !contract.buyer_signed_at) && <p className="text-xs text-amber-700">Both farmer and buyer must sign before you can countersign.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
