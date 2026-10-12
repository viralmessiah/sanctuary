import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/api/client";
import { Image } from "@/components/ui/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, PackageSearch, Store, ShoppingCart, Tag, Boxes, Package, Check } from "lucide-react";
import { addToCart } from "@/lib/cart";

export default function ProductDetail() {
  const { productId } = useParams();
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.entities.Product.get(productId).then(async (p) => {
      setProduct(p);
      setQty(p.min_order_qty || 1);
      let rel = [];
      if (p.category_id) {
        rel = await api.entities.Product.filter({ status: "active", category_id: p.category_id }, "-created_date", 6);
        rel = rel.filter((r) => r.id !== p.id);
      }
      if (rel.length < 4 && p.vendor_user_id) {
        const vendorProducts = await api.entities.Product.filter({ status: "active", vendor_user_id: p.vendor_user_id }, "-created_date", 8);
        const existingIds = new Set(rel.map((r) => r.id));
        existingIds.add(p.id);
        for (const vp of vendorProducts) {
          if (!existingIds.has(vp.id)) {
            rel.push(vp);
            existingIds.add(vp.id);
          }
          if (rel.length >= 4) break;
        }
      }
      setRelated(rel.slice(0, 4));
      setLoading(false);
    });
  }, [productId]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  if (!product) return <p className="text-slate-500">Product not found.</p>;

  const addAndGo = () => {
    addToCart(product, Number(qty));
    setAdded(true);
  };

  const specs = [
    product.brand && { label: "Brand", value: product.brand, icon: Tag },
    product.package_size && { label: "Package Size", value: product.package_size, icon: Package },
    product.unit && { label: "Unit", value: product.unit, icon: Boxes },
    product.sku && { label: "SKU", value: product.sku, icon: Tag },
  ].filter(Boolean);

  return (
    <div className="max-w-5xl space-y-6">
      <Link to="/marketplace" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> Back to Marketplace
      </Link>

      <div className="grid sm:grid-cols-2 gap-6 bg-white border border-slate-200 rounded-2xl p-6">
        <div className="aspect-square bg-slate-100 rounded-xl overflow-hidden">
          {product.image_url ? (
            <Image src={product.image_url} className="w-full h-full" fittingType="fill" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300"><PackageSearch className="w-16 h-16" /></div>
          )}
        </div>
        <div className="flex flex-col">
          {product.category_name && (
            <span className="self-start bg-emerald-50 text-emerald-700 text-xs font-medium px-2.5 py-0.5 rounded-full mb-3">{product.category_name}</span>
          )}
          <p className="text-xs text-slate-400 flex items-center gap-1 mb-1"><Store className="w-3 h-3" />{product.vendor_name}</p>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{product.name}</h1>
          <p className="text-slate-600 text-sm mt-3 leading-relaxed">{product.description}</p>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {specs.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-slate-600">
                <s.icon className="w-4 h-4 text-slate-400" />
                <span className="text-slate-400">{s.label}:</span>
                <span className="font-medium text-slate-700">{s.value}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-slate-600">
              <Boxes className="w-4 h-4 text-slate-400" />
              <span className="text-slate-400">Stock:</span>
              <span className="font-medium text-slate-700">{product.stock_quantity ?? "—"}</span>
            </div>
          </div>

          <p className="text-3xl font-bold text-slate-900 mt-6">KES {product.price?.toLocaleString()}</p>
          {product.unit && <p className="text-sm text-slate-400 mt-0.5">per {product.unit}</p>}

          <div className="flex items-center gap-3 mt-5">
            <Input type="number" min={product.min_order_qty || 1} value={qty} onChange={(e) => setQty(e.target.value)} className="w-24" />
            <Button onClick={addAndGo} className="bg-emerald-800 hover:bg-emerald-900 flex-1">
              {added ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
              {added ? "Added to Cart" : "Add to Cart"}
            </Button>
          </div>
          {added && (
            <p className="mt-3 text-sm text-emerald-800">
              Item added. Your cart is saved while you keep shopping. <Link to="/cart" className="font-medium underline">View cart</Link>
            </p>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Related Products</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {related.map((p) => (
              <Link key={p.id} to={`/marketplace/${p.id}`} className="bg-white border border-slate-200 rounded-2xl overflow-hidden group hover:shadow-md hover:border-emerald-200 transition-all">
                <div className="aspect-square bg-slate-100 overflow-hidden">
                  {p.image_url ? (
                    <Image src={p.image_url} className="w-full h-full" fittingType="fill" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300"><PackageSearch className="w-8 h-8" /></div>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-medium text-slate-900 text-sm line-clamp-2 group-hover:text-emerald-800">{p.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{p.vendor_name}</p>
                  <p className="font-semibold text-slate-900 text-sm mt-1">KES {p.price?.toLocaleString()}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}