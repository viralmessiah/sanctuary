import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { ShieldCheck, Loader2, UserCheck, FileText, ClipboardCheck, MessageSquare, BadgeDollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { startConversation } from "@/lib/messaging";

export default function AdminApprovals() {
  const [farmers, setFarmers] = useState([]);
  const [farmerProfiles, setFarmerProfiles] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [verifications, setVerifications] = useState([]);
  const [kycs, setKycs] = useState([]);
  const [financing, setFinancing] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loanOfficers, setLoanOfficers] = useState([]);
  const [pendingFieldOfficers, setPendingFieldOfficers] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const navigate = useNavigate();

  const load = async () => {
    const [f, fo, fv, k, fr, c, lo, partnerProfiles] = await Promise.all([
      api.entities.FarmerProfile.filter({}, "-created_date", 500),
      api.entities.FieldOfficerProfile.list("-created_date", 500),
      api.entities.FieldVerification.filter({}, "-created_date", 200),
      api.entities.KYCVerification.filter({}, "-created_date", 200),
      api.entities.FinancingRequest.filter({}, "-created_date", 200),
      api.entities.OfftakeContract.filter({}, "-created_date", 200),
      api.entities.LoanOfficerProfile.filter({}, "-created_date", 200),
      api.entities.PartnerProfile.filter({}, "-created_date", 500),
    ]);
    setFarmerProfiles(f);
    setFarmers(f.filter((x) => x.account_status === "pending"));
    setOfficers(fo.filter((x) => x.status === "active"));
    setPendingFieldOfficers(fo.filter((x) => x.status === "pending_review"));
    setPartners(partnerProfiles.filter((x) => x.status === "pending_review"));
    setVerifications(fv);
    setKycs(k.filter((x) => ["pending", "under_review"].includes(x.status)));
    setFinancing(fr.filter((x) => ["requested", "under_review", "stage1_approved", "returned"].includes(x.status)));
    setContracts(c.filter((x) => x.status === "draft" || x.status === "pending_signature"));
    setLoanOfficers(lo.filter((x) => x.status === "pending_review"));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const pendingFieldFindings = verifications.filter((item) => item.status === "pending_admin_review");

  const assignOfficer = async (farmer) => {
    const officerProfileId = drafts[farmer.id]?.officer_id;
    if (!officerProfileId) return;
    const officer = officers.find((o) => o.id === officerProfileId);
    await api.entities.FieldVerification.create({
      farmer_user_id: farmer.created_by_id,
      farmer_name: farmer.full_name,
      officer_user_id: officer.created_by_id,
      officer_name: officer.full_name,
      status: "assigned",
      assigned_date: new Date().toISOString(),
    });
    await api.entities.FarmerProfile.update(farmer.id, { verification_status: "assigned" });
    await api.entities.AuditLog.create({ action: "FIELD_OFFICER_ASSIGNED", entity_type: "FarmerProfile", entity_id: farmer.id });
    setDrafts({ ...drafts, [farmer.id]: undefined });
    load();
  };

  const messageOfficer = async (officerUserId, officerName) => {
    const conv = await startConversation(officerUserId, officerName);
    navigate(`/messages?conversation_id=${conv.id}`);
  };

  const approveAccount = async (fp) => {
    await api.entities.FarmerProfile.update(fp.id, { account_status: "approved" });
    await api.entities.AuditLog.create({ action: "ACCOUNT_APPROVED", entity_type: "FarmerProfile", entity_id: fp.id });
    load();
  };

  const suspendAccount = async (fp) => {
    await api.entities.FarmerProfile.update(fp.id, { account_status: "suspended" });
    await api.entities.AuditLog.create({ action: "ACCOUNT_SUSPENDED", entity_type: "FarmerProfile", entity_id: fp.id });
    load();
  };

  const approveLoanOfficer = async (profile) => {
    await api.entities.LoanOfficerProfile.update(profile.id, { status: "active" });
    await api.entities.AuditLog.create({ action: "LOAN_OFFICER_APPROVED", entity_type: "LoanOfficerProfile", entity_id: profile.id });
    load();
  };

  const approveFieldOfficer = async (profile) => {
    await api.entities.FieldOfficerProfile.update(profile.id, { status: "active" });
    await api.entities.AuditLog.create({ action: "FIELD_OFFICER_APPROVED", entity_type: "FieldOfficerProfile", entity_id: profile.id });
    load();
  };

  const decideFieldFindings = async (verification, approve) => {
    const reason = drafts[verification.id]?.reason?.trim() || "";
    if (!approve && !reason) return;
    await api.entities.FieldVerification.update(verification.id, {
      status: approve ? "approved" : "rejected",
      rejection_reason: approve ? undefined : reason,
    });
    load();
  };

  const approvePartner = async (profile) => {
    await api.entities.PartnerProfile.update(profile.id, { status: "active" });
    await api.entities.AuditLog.create({ action: "PARTNER_APPROVED", entity_type: "PartnerProfile", entity_id: profile.id });
    load();
  };

  const decideKyc = async (kyc, approve) => {
    const me = await api.auth.me();
    await api.entities.KYCVerification.update(kyc.id, {
      status: approve ? "verified" : "rejected",
      verified_date: approve ? new Date().toISOString() : undefined,
      rejection_reason: approve ? undefined : (drafts[kyc.id]?.reason || "Documents could not be verified."),
      reviewed_by: me.email,
    });
    if (kyc.user_type === "farmer") {
      const profiles = await api.entities.FarmerProfile.filter({ created_by_id: kyc.created_by_id });
      if (profiles[0]) await api.entities.FarmerProfile.update(profiles[0].id, { kyc_status: approve ? "verified" : "rejected" });
    } else if (kyc.user_type === "buyer") {
      const profiles = await api.entities.BuyerProfile.filter({ created_by_id: kyc.created_by_id });
      if (profiles[0]) await api.entities.BuyerProfile.update(profiles[0].id, { kyc_status: approve ? "verified" : "rejected", status: approve ? "active" : "pending_review" });
    } else if (kyc.user_type === "field_officer") {
      const profiles = await api.entities.FieldOfficerProfile.filter({ created_by_id: kyc.created_by_id });
      if (profiles[0]) await api.entities.FieldOfficerProfile.update(profiles[0].id, { kyc_status: approve ? "verified" : "rejected" });
    } else {
      const profiles = await api.entities.VendorProfile.filter({ created_by_id: kyc.created_by_id });
      if (profiles[0]) {
        await api.entities.VendorProfile.update(profiles[0].id, { kyc_status: approve ? "verified" : "rejected", status: approve ? "active" : "pending_review" });
      } else {
        const fieldOfficers = await api.entities.FieldOfficerProfile.filter({ created_by_id: kyc.created_by_id });
        if (fieldOfficers[0]) await api.entities.FieldOfficerProfile.update(fieldOfficers[0].id, { kyc_status: approve ? "verified" : "rejected" });
      }
    }
    await api.entities.AuditLog.create({ action: approve ? "KYC_APPROVED" : "KYC_REJECTED", entity_type: "KYCVerification", entity_id: kyc.id });
    load();
  };

  const stage1Approve = async (fr) => {
    const me = await api.auth.me();
    await api.entities.FinancingRequest.update(fr.id, {
      status: "stage1_approved", stage1_approved_by: me.email, stage1_approved_at: new Date().toISOString(),
      stage1_notes: drafts[fr.id]?.stage1_notes || "Field visit completed.",
    });
    await api.entities.AuditLog.create({ action: "LOAN_STAGE1_APPROVED", entity_type: "FinancingRequest", entity_id: fr.id });
    load();
  };

  const finalApprove = async (fr) => {
    const me = await api.auth.me();
    const draft = drafts[fr.id] || {};
    const approvedAmount = Number(draft.amount || fr.requested_amount);
    await api.entities.FinancingRequest.update(fr.id, {
      status: "approved", approved_amount: approvedAmount, approved_by: me.email,
      approved_at: new Date().toISOString(), agreed_percentage: Number(draft.percentage || 10),
      harvest_terms: draft.terms || fr.harvest_terms,
    });
    const order = await api.entities.Order.get(fr.order_id);
    const agreementNumber = `AGR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const content = `AGRICONNECT HARVEST-LINKED FINANCING AGREEMENT\n\nAgreement No: ${agreementNumber}\nFarmer: ${order.farmer_name || fr.farmer_name || "Farmer"}\nOrder Reference: ${fr.order_id}\nOfftake Contract: ${fr.offtake_contract_id || "N/A"}\nFinancing Amount: KES ${approvedAmount.toLocaleString()}\nAgreed Harvest Share: ${draft.percentage || 10}% of harvest proceeds\nHarvest Terms: ${draft.terms || fr.harvest_terms || "As agreed between the parties"}\n\nBy signing below, the farmer acknowledges receipt of financed agricultural inputs and agrees to settle the above obligation from harvest proceeds according to the terms of this agreement.`;
    await api.entities.Agreement.create({
      agreement_number: agreementNumber, farmer_user_id: order.created_by_id, farmer_name: order.farmer_name,
      financing_request_id: fr.id, offtake_contract_id: fr.offtake_contract_id, order_id: fr.order_id,
      financing_amount: approvedAmount, harvest_terms: draft.terms || fr.harvest_terms,
      agreed_percentage: Number(draft.percentage || 10), content, status: "pending_signature",
    });
    await api.entities.Order.update(fr.order_id, { status: "agreement_pending" });
    await api.entities.AuditLog.create({ action: "FINANCING_APPROVED", entity_type: "FinancingRequest", entity_id: fr.id });
    load();
  };

  const rejectFinancing = async (fr) => {
    await api.entities.FinancingRequest.update(fr.id, { status: "rejected", rejection_reason: drafts[fr.id]?.reason || "Not eligible at this time." });
    await api.entities.Order.update(fr.order_id, { status: "financing_rejected" });
    await api.entities.AuditLog.create({ action: "FINANCING_REJECTED", entity_type: "FinancingRequest", entity_id: fr.id });
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Approvals</h1>
      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts ({farmers.length})</TabsTrigger>
          <TabsTrigger value="field-findings">Field findings ({pendingFieldFindings.length})</TabsTrigger>
          <TabsTrigger value="kyc">KYC ({kycs.length})</TabsTrigger>
          <TabsTrigger value="financing">Financing ({financing.length})</TabsTrigger>
          <TabsTrigger value="contracts">Contracts ({contracts.length})</TabsTrigger>
          <TabsTrigger value="loan-officers">Loan officers ({loanOfficers.length})</TabsTrigger>
          <TabsTrigger value="partners">Partner roles ({partners.length})</TabsTrigger>
          <TabsTrigger value="field-officers">Field officers ({pendingFieldOfficers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4 space-y-3">
          {farmers.length === 0 ? <EmptyState icon={UserCheck} title="No pending accounts" /> : farmers.map((fp) => {
            const fv = verifications.find((v) => v.farmer_user_id === fp.created_by_id);
            return (
              <div key={fp.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{fp.full_name}</p>
                    <p className="text-xs text-slate-400">{fp.region} · {fp.crops?.join(", ") || "No crops listed"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {fp.verification_status === "not_started" && <StatusBadge status="not_started" />}
                    {fp.verification_status === "assigned" && <StatusBadge status="pending" />}
                    {fp.verification_status === "pending_admin_review" && <StatusBadge status="pending_admin_review" />}
                    {fp.verification_status === "verified" && <StatusBadge status="verified" />}
                    {fp.verification_status === "rejected" && <StatusBadge status="rejected" />}
                  </div>
                </div>

                {["not_started", "rejected"].includes(fp.verification_status) && (
                  <div className="flex items-center gap-2">
                    <select className="flex-1 border border-slate-200 rounded-lg h-9 px-3 text-sm bg-white" value={drafts[fp.id]?.officer_id || ""} onChange={(e) => setDrafts({ ...drafts, [fp.id]: { ...drafts[fp.id], officer_id: e.target.value } })}>
                      <option value="">Select a field officer...</option>
                      {officers.map((o) => <option key={o.id} value={o.id}>{o.full_name} — {o.region}</option>)}
                    </select>
                    <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" disabled={!drafts[fp.id]?.officer_id || officers.length === 0} onClick={() => assignOfficer(fp)}><ClipboardCheck className="w-4 h-4" /> {fp.verification_status === "rejected" ? "Reassign Verification" : "Assign Officer"}</Button>
                  </div>
                )}
                {fp.verification_status === "assigned" && fv && (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-amber-600">Pending field verification by {fv.officer_name}. Assigned {new Date(fv.assigned_date).toLocaleDateString()}.</p>
                    <Button size="sm" variant="outline" onClick={() => messageOfficer(fv.officer_user_id, fv.officer_name)}><MessageSquare className="w-4 h-4" /> Message Officer</Button>
                  </div>
                )}
                {fp.verification_status === "verified" && (
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => approveAccount(fp)}>Approve Account</Button>
                    <Button size="sm" variant="outline" onClick={() => suspendAccount(fp)}>Suspend</Button>
                  </div>
                )}
                {fp.verification_status === "rejected" && fv && (
                  <p className="text-xs text-red-600">Verification rejected: {fv.rejection_reason || "No reason provided"}</p>
                )}
                {officers.length === 0 && ["not_started", "rejected"].includes(fp.verification_status) && (
                  <p className="text-xs text-amber-600">No active field officers. Approve a field officer's account first.</p>
                )}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="field-findings" className="mt-4 space-y-3">
          {pendingFieldFindings.length === 0 ? <EmptyState icon={ClipboardCheck} title="No field findings awaiting review" description="Field officers' submitted reports will appear here for comparison with the farmer's profile." /> : pendingFieldFindings.map((verification) => {
            const farmer = farmerProfiles.find((profile) => profile.created_by_id === verification.farmer_user_id);
            const rejectionReason = drafts[verification.id]?.reason || "";
            return (
              <div key={verification.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{verification.farmer_name || farmer?.full_name || "Farmer"}</p>
                    <p className="text-xs text-slate-500">Submitted by {verification.officer_name || "Field officer"} · {verification.completed_date ? new Date(verification.completed_date).toLocaleString() : "Submission date unavailable"}</p>
                  </div>
                  <StatusBadge status={verification.status} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">Farmer's submitted profile</h3>
                    <dl className="space-y-1 text-sm">
                      <div><dt className="inline text-slate-500">Name: </dt><dd className="inline">{farmer?.full_name || "—"}</dd></div>
                      <div><dt className="inline text-slate-500">Region: </dt><dd className="inline">{farmer?.region || "—"}</dd></div>
                      <div><dt className="inline text-slate-500">Farm: </dt><dd className="inline">{farmer?.farm_name || "—"}</dd></div>
                      <div><dt className="inline text-slate-500">Location: </dt><dd className="inline">{farmer?.farm_location || "—"}</dd></div>
                      <div><dt className="inline text-slate-500">Land size: </dt><dd className="inline">{farmer?.acreage ?? "—"} acres</dd></div>
                      <div><dt className="inline text-slate-500">Crops: </dt><dd className="inline">{farmer?.crops?.join(", ") || "—"}</dd></div>
                    </dl>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">Field officer findings</h3>
                    <dl className="space-y-1 text-sm">
                      <div><dt className="inline text-slate-500">Land size observed: </dt><dd className="inline">{verification.land_size_verified ?? "—"} acres</dd></div>
                      <div><dt className="inline text-slate-500">Crops observed: </dt><dd className="inline">{verification.crops_verified?.join(", ") || "—"}</dd></div>
                    </dl>
                    <p className="mt-3 text-xs font-medium text-slate-600">Land and farm findings</p>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{verification.land_verification_notes || "—"}</p>
                    <p className="mt-2 text-xs font-medium text-slate-600">Document checks</p>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{verification.document_verification_notes || "—"}</p>
                  </div>
                </div>
                {verification.field_visit_photos?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {verification.field_visit_photos.map((photo, index) => <a key={`${photo}-${index}`} href={photo} target="_blank" rel="noreferrer"><img src={photo} alt={`Field evidence ${index + 1}`} className="h-20 w-20 rounded-lg object-cover" /></a>)}
                  </div>
                )}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <Input
                    placeholder="Required reason if findings do not match or cannot be approved"
                    value={rejectionReason}
                    onChange={(event) => setDrafts({ ...drafts, [verification.id]: { ...drafts[verification.id], reason: event.target.value } })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => decideFieldFindings(verification, true)}>Approve findings and verify farmer</Button>
                    <Button size="sm" variant="outline" disabled={!rejectionReason.trim()} onClick={() => decideFieldFindings(verification, false)}>Reject findings</Button>
                  </div>
                  <p className="text-xs text-slate-500">Approval marks the farmer's field verification as verified. The field officer cannot approve their own findings.</p>
                </div>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="kyc" className="mt-4 space-y-3">
          {kycs.length === 0 ? <EmptyState icon={ShieldCheck} title="No pending KYC reviews" /> : kycs.map((k) => (
            <div key={k.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{k.applicant_name || "Applicant"}</p>
                  <p className="text-xs text-slate-400 capitalize">
                    {k.user_type === "vendor" && [...officers, ...pendingFieldOfficers].some((profile) => profile.created_by_id === k.created_by_id)
                      ? "field officer (legacy KYC entry)"
                      : k.user_type} · {k.document_type}
                  </p>
                </div>
                <StatusBadge status={k.status} />
              </div>
              {k.document_url && <a href={k.document_url} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">View Document</a>}
              <div className="flex items-center gap-2">
                <Input placeholder="Rejection reason (optional)" className="text-sm" value={drafts[k.id]?.reason || ""} onChange={(e) => setDrafts({ ...drafts, [k.id]: { ...drafts[k.id], reason: e.target.value } })} />
                <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => decideKyc(k, true)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decideKyc(k, false)}>Reject</Button>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="financing" className="mt-4 space-y-3">
          {financing.length === 0 ? <EmptyState icon={ShieldCheck} title="No pending financing requests" /> : financing.map((fr) => (
            <div key={fr.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">Requested: KES {fr.requested_amount?.toLocaleString()}</p>
                  <p className="text-xs text-slate-400">Order {fr.order_id}{fr.credit_limit != null && ` · Limit: KES ${fr.credit_limit.toLocaleString()}`}</p>
                </div>
                <StatusBadge status={fr.status} />
              </div>
              {fr.status === "stage1_approved" && <p className="text-xs text-emerald-700">Stage 1 approved by {fr.stage1_approved_by}</p>}
              <div className="grid sm:grid-cols-3 gap-2">
                <div className="space-y-1"><Label className="text-xs">Approved Amount</Label><Input type="number" placeholder={fr.requested_amount} className="text-sm" onChange={(e) => setDrafts({ ...drafts, [fr.id]: { ...drafts[fr.id], amount: e.target.value } })} /></div>
                <div className="space-y-1"><Label className="text-xs">Harvest Share %</Label><Input type="number" placeholder="10" className="text-sm" onChange={(e) => setDrafts({ ...drafts, [fr.id]: { ...drafts[fr.id], percentage: e.target.value } })} /></div>
                <div className="space-y-1"><Label className="text-xs">Harvest Terms</Label><Input placeholder="e.g. maize" className="text-sm" onChange={(e) => setDrafts({ ...drafts, [fr.id]: { ...drafts[fr.id], terms: e.target.value } })} /></div>
              </div>
              <div className="flex items-center gap-2">
                {fr.status === "requested" || fr.status === "under_review" ? (
                  <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => stage1Approve(fr)}>Stage 1: LO Approve</Button>
                ) : fr.status === "stage1_approved" || fr.status === "returned" ? (
                  <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => finalApprove(fr)}>Stage 2: Final Approve & Generate Agreement</Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => rejectFinancing(fr)}>Reject</Button>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-3">
          {contracts.length === 0 ? <EmptyState icon={FileText} title="No pending contracts" /> : contracts.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{c.contract_number}</p>
                  <p className="text-xs text-slate-400">{c.farmer_name} → {c.buyer_name} · {c.crop} · {c.quantity} {c.unit}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="loan-officers" className="mt-4 space-y-3">
          {loanOfficers.length === 0 ? <EmptyState icon={BadgeDollarSign} title="No pending loan officer approvals" /> : loanOfficers.map((profile) => (
            <div key={profile.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900">{profile.full_name}</p>
                <p className="text-xs text-slate-400">{profile.email || profile.created_by} · {profile.phone}</p>
              </div>
              <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => approveLoanOfficer(profile)}>Approve access</Button>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="partners" className="mt-4 space-y-3">
          {partners.length === 0 ? <EmptyState icon={BadgeDollarSign} title="No partner profiles pending" /> : partners.map((profile) => (
            <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
              <div><p className="font-medium">{profile.organization_name || "Partner organization"}</p><p className="text-xs capitalize text-slate-500">{profile.partner_type.replaceAll("_", " ")} · {profile.contact_email || profile.phone}</p></div>
              <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => approvePartner(profile)}>Approve partner</Button>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="field-officers" className="mt-4 space-y-3">
          {pendingFieldOfficers.length === 0 ? <EmptyState icon={ClipboardCheck} title="No field officers pending" /> : pendingFieldOfficers.map((profile) => (
            <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
              <div><p className="font-medium">{profile.full_name}</p><p className="text-xs text-slate-500">{profile.email} · {profile.region}</p></div>
              <Button size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => approveFieldOfficer(profile)}>Approve field officer</Button>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}