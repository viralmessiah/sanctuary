import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Package, Loader2, Plus, UploadCloud, FileSpreadsheet, ChevronRight } from "lucide-react";
import BulkImportProducts from "@/components/vendor/BulkImportProducts";

const EMPTY = { name: "", sku: "", brand: "", unit: "", package_size: "", price: "", stock_quantity: "", description: "", category_name: "", image_url: "" };

export default function VendorProducts() {
  const [profile, setProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    const me = await api.auth.me();
    const vendorUserId = me.vendor_employment?.vendor_user_id || me.id;
    const [profiles, prods, cats] = await Promise.all([
      api.entities.VendorProfile.filter({ created_by_id: vendorUserId }),
      api.entities.Product.filter({ vendor_user_id: vendorUserId }, "-created_date"),
      api.entities.Category.filter({ status: "active" }),
    ]);
    setProfile(profiles[0] || null);
    setProducts(prods);
    setCategories(cats);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const uploadImage = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    setForm((f) => ({ ...f, image_url: file_url }));
    setUploading(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const category = categories.find((c) => c.name === form.category_name);
    await api.entities.Product.create({
      ...form,
      price: Number(form.price),
      stock_quantity: Number(form.stock_quantity) || 0,
      category_id: category?.id,
      vendor_user_id: profile.created_by_id,
      vendor_name: profile.business_name,
    });
    setForm(EMPTY);
    setShowForm(false);
    await load();
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  if (!profile) {
    return <EmptyState icon={Package} title="Complete your store profile first" description="Set up your vendor profile before listing products." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Products</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your product catalog and stock.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowImport(!showImport)}>
            <FileSpreadsheet className="w-4 h-4 mr-1" /> Import
          </Button>
          <Button onClick={() => setShowForm(!showForm)} className="bg-emerald-800 hover:bg-emerald-900">
            <Plus className="w-4 h-4 mr-1" /> Add Product
          </Button>
        </div>
      </div>

      {showImport && <BulkImportProducts profile={profile} categories={categories} onDone={load} />}

      {showForm && (
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select className="w-full border border-slate-200 rounded-lg h-10 px-3 text-sm bg-white" value={form.category_name} onChange={(e) => setForm({ ...form, category_name: e.target.value })}>
                <option value="">Select category</option>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Brand</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg, litre..." /></div>
            <div className="space-y-1.5"><Label>Package Size</Label><Input value={form.package_size} onChange={(e) => setForm({ ...form, package_size: e.target.value })} placeholder="50KG" /></div>
            <div className="space-y-1.5"><Label>Price (KES)</Label><Input type="number" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Stock Quantity</Label><Input type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>Product Image</Label>
            <label className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <UploadCloud className="w-4 h-4" />{uploading ? "Uploading..." : form.image_url ? "Change Image" : "Upload Image"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])} />
            </label>
          </div>
          <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">{saving ? "Saving..." : "Save Product"}</Button>
        </form>
      )}

      {products.length === 0 ? (
        <EmptyState icon={Package} title="No products listed" description="Add your first product to appear in the marketplace." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {products.map((p) => (
            <Link
              key={p.id}
              to={`/vendor/products/${p.id}`}
              className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden shrink-0">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300"><Package className="w-5 h-5" /></div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 group-hover:text-emerald-800">{p.name}</p>
                  <p className="text-xs text-slate-400">KES {p.price?.toLocaleString()} · Stock: {p.stock_quantity}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={p.status} />
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}