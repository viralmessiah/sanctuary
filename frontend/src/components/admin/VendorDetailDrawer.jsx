import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Image } from "@/components/ui/image";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Loader2, Package, ShoppingBag, Users, Receipt, Ban, CheckCircle } from "lucide-react";

export default function VendorDetailDrawer({ vendor, open, onClose }) {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vendor) return;
    setLoading(true);
    (async () => {
      try {
        const [p, o, emp, s] = await Promise.all([
          api.entities.Product.filter({ vendor_name: vendor.business_name }, "-created_date", 50),
          api.entities.Order.filter({ vendor_name: vendor.business_name }, "-created_date", 20),
          api.entities.VendorEmployee.filter({ vendor_name: vendor.business_name }, "-created_date", 20),
          api.entities.Settlement.filter({ vendor_name: vendor.business_name }, "-created_date", 20),
        ]);
        setProducts(p);
        setOrders(o);
        setEmployees(emp);
        setSettlements(s);
      } catch (_) {}
      setLoading(false);
    })();
  }, [vendor]);

  const toggleStatus = async (status) => {
    await api.entities.VendorProfile.update(vendor.id, { status });
    onClose();
  };

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
          <div className="flex items-center gap-3 w-full pr-8">
            {vendor?.profile_image_url ? (
              <Image src={vendor.profile_image_url} className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold">{vendor?.business_name?.[0]}</div>
            )}
            <div className="flex-1">
              <SheetTitle className="text-left">{vendor?.business_name}</SheetTitle>
              <div className="flex gap-1.5 mt-1">
                <StatusBadge status={vendor?.status} />
                <StatusBadge status={vendor?.kyc_status} />
              </div>
            </div>
            {vendor && (vendor.status !== "suspended" ? (
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 shrink-0" onClick={() => toggleStatus("suspended")}>
                <Ban className="w-3.5 h-3.5 mr-1" /> Suspend
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 shrink-0" onClick={() => toggleStatus("active")}>
                <CheckCircle className="w-3.5 h-3.5 mr-1" /> Reactivate
              </Button>
            ))}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>
        ) : (
          <div className="space-y-6 mt-6">
            {/* Business Details */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Business Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Phone" value={vendor?.phone} />
                <Field label="Email" value={vendor?.email} />
                <Field label="Address" value={vendor?.address} />
                <Field label="Store Location" value={vendor?.store_location} />
                <Field label="National ID" value={vendor?.id_number} />
                <Field label="Payout Details" value={vendor?.payout_details} />
              </div>
              {vendor?.categories?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {vendor.categories.map((c, i) => <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full">{c}</span>)}
                </div>
              )}
            </section>

            {/* Products */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Package className="w-3 h-3" /> Products ({products.length})</h3>
              {products.length === 0 ? <p className="text-sm text-slate-400">No products listed.</p> : (
                <div className="space-y-2">
                  {products.map(p => (
                    <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        {p.image_url && <Image src={p.image_url} className="w-8 h-8 rounded object-cover" />}
                        <div>
                          <p className="text-sm text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-400">KES {p.price?.toLocaleString()} · {p.stock_quantity} in stock</p>
                        </div>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Orders */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Orders ({orders.length})</h3>
              {orders.length === 0 ? <p className="text-sm text-slate-400">No orders yet.</p> : (
                <div className="space-y-2">
                  {orders.map(o => (
                    <div key={o.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900">{o.farmer_name}</p>
                        <p className="text-xs text-slate-400">{o.items?.length || 0} items · KES {o.total?.toLocaleString()}</p>
                      </div>
                      <StatusBadge status={o.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Employees */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Users className="w-3 h-3" /> Employees ({employees.length})</h3>
              {employees.length === 0 ? <p className="text-sm text-slate-400">No employees.</p> : (
                <div className="space-y-2">
                  {employees.map(emp => (
                    <div key={emp.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900">{emp.employee_name}</p>
                        <p className="text-xs text-slate-400">{emp.employee_email}</p>
                      </div>
                      <StatusBadge status={emp.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Settlements */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Receipt className="w-3 h-3" /> Settlements ({settlements.length})</h3>
              {settlements.length === 0 ? <p className="text-sm text-slate-400">No settlements yet.</p> : (
                <div className="space-y-2">
                  {settlements.map(s => (
                    <div key={s.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-slate-900">KES {s.amount?.toLocaleString()}</p>
                        <p className="text-xs text-slate-400">{s.payment_reference || "No reference"}</p>
                      </div>
                      <StatusBadge status={s.status} />
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