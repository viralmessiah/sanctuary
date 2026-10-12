import React, { useEffect, useState, useMemo } from "react";
import { api } from "@/api/client";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Image } from "@/components/ui/image";
import EmptyState from "@/components/shared/EmptyState";
import { Search, Loader2, Store, PackageSearch, ShoppingCart, ArrowLeft, Check } from "lucide-react";
import { addToCart, getCart } from "@/lib/cart";

export default function Marketplace() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("vendors");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cartCount, setCartCount] = useState(() => getCart()?.items.reduce((sum, item) => sum + item.quantity, 0) || 0);
  const [recentlyAdded, setRecentlyAdded] = useState("");

  useEffect(() => {
    const updateCartCount = () => setCartCount(getCart()?.items.reduce((sum, item) => sum + item.quantity, 0) || 0);
    window.addEventListener("agri-cart-updated", updateCartCount);
    return () => window.removeEventListener("agri-cart-updated", updateCartCount);
  }, []);
  useEffect(() => {
    (async () => {
      const [p, c] = await Promise.all([
        api.entities.Product.filter({ status: "active" }, "-created_date", 200),
        api.entities.Category.filter({ status: "active" }),
      ]);
      setProducts(p);
      setCategories(c);
      setLoading(false);
    })();
  }, []);

  const vendors = useMemo(() => {
    const map = new Map();
    products.forEach((p) => {
      if (!p.vendor_user_id) return;
      if (!map.has(p.vendor_user_id)) {
        map.set(p.vendor_user_id, {
          vendor_user_id: p.vendor_user_id,
          vendor_name: p.vendor_name || "Unknown Vendor",
          product_count: 0,
          categories: new Set(),
          image_url: p.image_url,
        });
      }
      const v = map.get(p.vendor_user_id);
      v.product_count++;
      if (p.category_name) v.categories.add(p.category_name);
      if (!v.image_url && p.image_url) v.image_url = p.image_url;
    });
    return Array.from(map.values()).map((v) => ({ ...v, categories: Array.from(v.categories) }));
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesVendor = !selectedVendor || p.vendor_user_id === selectedVendor;
      const matchesCategory = categoryFilter === "all" || p.category_id === categoryFilter;
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        p.name?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q) ||
        p.vendor_name?.toLowerCase().includes(q) ||
        p.category_name?.toLowerCase().includes(q);
      return matchesVendor && matchesCategory && matchesSearch;
    });
  }, [products, search, categoryFilter, selectedVendor]);

  const quickAdd = (product) => {
    addToCart(product, 1);
    setRecentlyAdded(product.id);
    window.setTimeout(() => setRecentlyAdded((current) => current === product.id ? "" : current), 1500);
  };

  const selectVendor = (vendorUserId) => {
    setSelectedVendor(vendorUserId);
    setSearch("");
    setActiveTab("products");
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const selectedVendorName = vendors.find(v => v.vendor_user_id === selectedVendor)?.vendor_name;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Marketplace</h1>
            <p className="text-slate-500 text-sm mt-1">Browse verified vendors and agricultural inputs.</p>
          </div>
          <Link to="/cart" className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
            <ShoppingCart className="h-4 w-4" /> Cart ({cartCount})
          </Link>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => { setActiveTab("vendors"); setSelectedVendor(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "vendors" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
        >
          Vendors
        </button>
        <button
          onClick={() => setActiveTab("products")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "products" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
        >
          Products
        </button>
      </div>

      {activeTab === "vendors" ? (
        vendors.length === 0 ? (
          <EmptyState icon={Store} title="No vendors yet" description="Vendors will appear here once they list products." />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {vendors.map((v) => (
              <button
                key={v.vendor_user_id}
                onClick={() => selectVendor(v.vendor_user_id)}
                className="bg-white border border-slate-200 rounded-2xl p-5 text-left hover:border-emerald-200 hover:shadow-md transition-all flex flex-col items-start gap-3"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center overflow-hidden">
                  {v.image_url ? (
                    <img src={v.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Store className="w-6 h-6 text-emerald-700" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-slate-900 text-sm">{v.vendor_name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{v.product_count} product{v.product_count !== 1 ? "s" : ""}</p>
                </div>
                {v.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.categories.slice(0, 3).map((c) => (
                      <span key={c} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{c}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          {selectedVendor && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSelectedVendor(null); setSearch(""); }}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
              >
                <ArrowLeft className="w-4 h-4" /> All vendors
              </button>
              <span className="text-slate-300">/</span>
              <span className="text-sm font-medium text-slate-900">{selectedVendorName}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input className="pl-9" placeholder="Search products, brands, vendors..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 text-sm bg-white"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {filteredProducts.length === 0 ? (
            <EmptyState icon={PackageSearch} title="No products found" description="Try a different search term or category." />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProducts.map((p) => (
                <div key={p.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col group hover:shadow-md hover:border-emerald-200 transition-all">
                  <Link to={`/marketplace/${p.id}`} className="block relative aspect-square bg-slate-100 overflow-hidden">
                    {p.image_url ? (
                      <Image src={p.image_url} className="w-full h-full" fittingType="fill" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <PackageSearch className="w-10 h-10" />
                      </div>
                    )}
                    {p.category_name && (
                      <span className="absolute top-2 left-2 bg-white/90 backdrop-blur text-emerald-800 text-[10px] font-medium px-2 py-0.5 rounded-full">
                        {p.category_name}
                      </span>
                    )}
                  </Link>
                  <div className="p-3 flex-1 flex flex-col">
                    <Link to={`/marketplace/${p.id}`} className="font-medium text-slate-900 text-sm leading-snug hover:text-emerald-800 line-clamp-2">{p.name}</Link>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1"><Store className="w-3 h-3" />{p.vendor_name}</p>
                    {p.brand && <p className="text-xs text-slate-400 mt-0.5">{p.brand}</p>}
                    <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-900 text-sm">KES {p.price?.toLocaleString()}</span>
                        {p.unit && <span className="text-xs text-slate-400">/{p.unit}</span>}
                      </div>
                      <button
                        onClick={() => quickAdd(p)}
                        aria-label={`Add ${p.name} to cart`}
                        title={recentlyAdded === p.id ? "Added to cart" : "Add to cart"}
                        className="shrink-0 w-8 h-8 flex items-center justify-center bg-emerald-800 text-white rounded-lg hover:bg-emerald-900"
                      >
                        {recentlyAdded === p.id ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}