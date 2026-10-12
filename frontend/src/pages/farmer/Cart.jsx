import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/shared/EmptyState";
import { ShoppingCart, Trash2, Minus, Plus, FileText, ArrowLeft } from "lucide-react";
import { getCart, setCart, clearCart } from "@/lib/cart";

export default function Cart() {
  const [cart, setLocalCart] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [creditLimit, setCreditLimit] = useState(null);
  const [creditLimitError, setCreditLimitError] = useState("");
  const [loadingCreditLimit, setLoadingCreditLimit] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    setLocalCart(getCart());
    (async () => {
      try {
        const user = await api.auth.me();
        const [contracts, settingsList] = await Promise.all([
          api.entities.OfftakeContract.filter({ farmer_user_id: user.id, status: "active" }),
          api.entities.LoanSettings.filter({}, "-created_date", 100),
        ]);
        const contract = contracts[0];
        const settings = settingsList.find((item) => item.is_active) || settingsList[0];
        if (contract && settings) {
          const contractValue = Number(contract.total_value || (contract.quantity * contract.price_per_unit));
          const configuredLimit = contractValue * Number(settings.advance_percentage || 0) / 100;
          setCreditLimit(settings.maximum_financing_amount == null
            ? configuredLimit
            : Math.min(configuredLimit, Number(settings.maximum_financing_amount)));
        }
      } catch (error) {
        setCreditLimitError(error.message || "Unable to load your contract-backed credit limit.");
      } finally {
        setLoadingCreditLimit(false);
      }
    })();
  }, []);

  const updateQty = (productId, delta) => {
    const next = { ...cart, items: cart.items.map((i) => i.product_id === productId ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i) };
    setCart(next);
    setLocalCart(next);
  };

  const removeItem = (productId) => {
    const items = cart.items.filter((i) => i.product_id !== productId);
    if (items.length === 0) { clearCart(); setLocalCart(null); return; }
    const next = { ...cart, items };
    setCart(next);
    setLocalCart(next);
  };

  const total = cart?.items?.reduce((sum, i) => sum + i.price * i.quantity, 0) || 0;
  const overLimit = creditLimit != null && total > creditLimit;
  const vendorGroups = useMemo(() => {
    const groups = new Map();
    for (const item of cart?.items || []) {
      const vendorId = item.vendor_user_id || "unknown-vendor";
      if (!groups.has(vendorId)) {
        groups.set(vendorId, { vendor_user_id: vendorId, vendor_name: item.vendor_name || "Vendor", items: [] });
      }
      groups.get(vendorId).items.push(item);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      total: group.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    }));
  }, [cart]);

  const placeOrder = async () => {
    if (overLimit || !cart?.items.length) return;
    setPlacing(true);
    setError("");
    let placedOrders = 0;
    try {
      for (const group of vendorGroups) {
        const items = group.items.map((item) => ({
          product_id: item.product_id,
          product_name: item.name,
          quantity: item.quantity,
          unit_price: item.price,
          total: item.price * item.quantity,
        }));
        await api.entities.Order.create({
          vendor_user_id: group.vendor_user_id,
          vendor_name: group.vendor_name,
          items,
          subtotal: group.total,
          total: group.total,
          status: "submitted",
        });
        placedOrders += 1;
        const orderedIds = new Set(group.items.map((item) => item.product_id));
        const remaining = getCart()?.items.filter((item) => !orderedIds.has(item.product_id)) || [];
        if (remaining.length) setCart({ items: remaining });
        else clearCart();
        setLocalCart(getCart());
      }
      navigate("/orders", { state: { placedOrders } });
    } catch (err) {
      setError(
        placedOrders
          ? `${placedOrders} vendor order(s) were placed. The remaining items are still in your cart. ${err.message || ""}`
          : err.message || "Your order could not be placed.",
      );
      setLocalCart(getCart());
    } finally {
      setPlacing(false);
    }
  };

  if (!cart || !cart.items?.length) {
    return (
      <EmptyState icon={ShoppingCart} title="Your cart is empty" description="Add products from the marketplace to place an order." action={<Link to="/marketplace"><Button className="bg-emerald-800 hover:bg-emerald-900">Go to Marketplace</Button></Link>} />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Your Cart</h1>
        <p className="text-slate-500 text-sm mt-1">Your cart stays saved while you continue shopping.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {creditLimit != null && (
        <div className={`border rounded-xl p-4 text-sm ${overLimit ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">Credit Limit: KES {creditLimit.toLocaleString()}</span>
            <span>Cart Total: KES {total.toLocaleString()}</span>
          </div>
          {overLimit && <p className="mt-1 text-xs">Your cart exceeds your credit limit. Remove items or reduce quantities.</p>}
        </div>
      )}

      {creditLimit == null && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {creditLimitError ? (
            <p>{creditLimitError}</p>
          ) : loadingCreditLimit ? (
            <p>Loading your contract-backed credit limit…</p>
          ) : (
            <>
              <p className="flex items-center gap-2"><FileText className="w-4 h-4" /> You need an active offtake contract and financing settings to place an order on credit.</p>
              <Link to="/farmer/contracts" className="underline text-amber-900 font-medium mt-1 inline-block">Create a contract →</Link>
            </>
          )}
        </div>
      )}

      {vendorGroups.map((group) => (
        <section key={group.vendor_user_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">{group.vendor_name}</h2>
            <span className="text-xs text-slate-500">Order subtotal: KES {group.total.toLocaleString()}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {group.items.map((i) => (
              <div key={i.product_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{i.name}</p>
                  <p className="text-xs text-slate-400">KES {i.price.toLocaleString()} {i.unit && `/ ${i.unit}`}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center rounded-lg border border-slate-200">
                    <button aria-label={`Decrease ${i.name} quantity`} onClick={() => updateQty(i.product_id, -1)} className="p-1.5 text-slate-500"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-8 text-center text-sm">{i.quantity}</span>
                    <button aria-label={`Increase ${i.name} quantity`} onClick={() => updateQty(i.product_id, 1)} className="p-1.5 text-slate-500"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <span className="w-24 text-right text-sm font-medium text-slate-900">KES {(i.price * i.quantity).toLocaleString()}</span>
                  <button aria-label={`Remove ${i.name}`} onClick={() => removeItem(i.product_id)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center justify-between">
        <span className="font-medium text-slate-900">Total</span>
        <span className="text-xl font-semibold text-slate-900">KES {total.toLocaleString()}</span>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Link to="/marketplace" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" /> Continue Shopping
        </Link>
        <Button onClick={placeOrder} disabled={placing || overLimit || creditLimit == null || loadingCreditLimit || Boolean(creditLimitError)} className="flex-1 bg-emerald-800 hover:bg-emerald-900">
          {placing ? "Placing Orders..." : overLimit ? "Cart Exceeds Credit Limit" : creditLimit == null ? "Active Contract Required" : `Proceed · Place ${vendorGroups.length} Order${vendorGroups.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}