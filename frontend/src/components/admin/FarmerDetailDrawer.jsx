import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Image } from "@/components/ui/image";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2, Phone, MapPin, Crop, FileText, ShoppingBag, Receipt, Sprout, Calendar } from "lucide-react";

export default function FarmerDetailDrawer({ farmer, open, onClose }) {
  const [orders, setOrders] = useState([]);
  const [kyc, setKyc] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [harvests, setHarvests] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!farmer) return;
    setLoading(true);
    (async () => {
      try {
        const [o, k, a, v, h] = await Promise.all([
          api.entities.Order.filter({ farmer_name: farmer.full_name }, "-created_date", 20),
          api.entities.KYCVerification.filter({ user_type: "farmer" }, "-created_date", 5).then(r => r.find(x => x.created_by_id === farmer.created_by_id) || null),
          api.entities.Agreement.filter({ farmer_name: farmer.full_name }, "-created_date", 20),
          api.entities.Voucher.filter({ farmer_name: farmer.full_name }, "-created_date", 20),
          api.entities.Harvest.list("-created_date", 20),
        ]);
        setOrders(o);
        setKyc(k);
        setAgreements(a);
        setVouchers(v);
        setHarvests(h.filter(x => x.created_by_id === farmer.created_by_id));
      } catch (_) {}
      setLoading(false);
    })();
  }, [farmer]);

  const Field = ({ label, value }) => (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm text-slate-900 mt-0.5">{value || "—"}</p>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            {farmer?.profile_image_url ? (
              <Image src={farmer.profile_image_url} className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold">{farmer?.full_name?.[0]}</div>
            )}
            <div>
              <p>{farmer?.full_name}</p>
              <div className="flex gap-1.5 mt-1">
                <StatusBadge status={farmer?.profile_status} />
                <StatusBadge status={farmer?.kyc_status} />
              </div>
            </div>
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>
        ) : (
          <div className="space-y-6 mt-6">
            {/* Contact */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Contact & Farm</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Phone" value={farmer?.phone} />
                <Field label="National ID" value={farmer?.national_id} />
                <Field label="Farm Name" value={farmer?.farm_name} />
                <Field label="Location" value={farmer?.farm_location} />
                <Field label="Acreage" value={farmer?.acreage ? `${farmer.acreage} acres` : null} />
                <Field label="Production Cycle" value={farmer?.production_cycle} />
              </div>
              {farmer?.crops?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {farmer.crops.map((c, i) => <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full">{c}</span>)}
                </div>
              )}
            </section>

            {/* KYC */}
            {kyc && (
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">KYC Verification</h3>
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Status</span>
                    <StatusBadge status={kyc.status} />
                  </div>
                  <Field label="Document Type" value={kyc.document_type} />
                  {kyc.document_url && <Image src={kyc.document_url} className="w-full h-32 rounded-lg object-cover mt-2" />}
                  {kyc.rejection_reason && <Field label="Rejection Reason" value={kyc.rejection_reason} />}
                </div>
              </section>
            )}

            {/* Orders */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Orders ({orders.length})</h3>
              {orders.length === 0 ? <p className="text-sm text-slate-400">No orders yet.</p> : (
                <div className="space-y-2">
                  {orders.map(o => (
                    <div key={o.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900">{o.vendor_name}</p>
                        <p className="text-xs text-slate-400">{o.items?.length || 0} items · KES {o.total?.toLocaleString()}</p>
                      </div>
                      <StatusBadge status={o.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Agreements */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><FileText className="w-3 h-3" /> Agreements ({agreements.length})</h3>
              {agreements.length === 0 ? <p className="text-sm text-slate-400">No agreements yet.</p> : (
                <div className="space-y-2">
                  {agreements.map(a => (
                    <div key={a.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900">{a.agreement_number}</p>
                        <p className="text-xs text-slate-400">KES {a.financing_amount?.toLocaleString()} · {a.agreed_percentage}% share</p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Vouchers */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Receipt className="w-3 h-3" /> Vouchers ({vouchers.length})</h3>
              {vouchers.length === 0 ? <p className="text-sm text-slate-400">No vouchers yet.</p> : (
                <div className="space-y-2">
                  {vouchers.map(v => (
                    <div key={v.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900 font-mono">{v.voucher_code}</p>
                        <p className="text-xs text-slate-400">KES {v.total_value?.toLocaleString()}</p>
                      </div>
                      <StatusBadge status={v.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Harvests */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Sprout className="w-3 h-3" /> Harvests ({harvests.length})</h3>
              {harvests.length === 0 ? <p className="text-sm text-slate-400">No harvest records yet.</p> : (
                <div className="space-y-2">
                  {harvests.map(h => (
                    <div key={h.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900">{h.crop}</p>
                        <p className="text-xs text-slate-400">{h.actual_quantity || h.expected_quantity || "—"} {h.unit}</p>
                      </div>
                      <StatusBadge status={h.settlement_status} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}