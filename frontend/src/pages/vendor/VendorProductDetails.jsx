import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "@/api/client";
import { Image } from "@/components/ui/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, UploadCloud, Trash2, Save } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import { Package } from "lucide-react";

export default function VendorProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState(null);

  const load = async () => {
    setLoading(true);
    const [p, cats] = await Promise.all([
      api.entities.Product.get(productId),
      api.entities.Category.filter({ status: "active" }),
    ]);
    setProduct(p);
    setForm({
      name: p.name || "",
      sku: p.sku || "",
      brand: p.brand || "",
      unit: p.unit || "",
      package_size: p.package_size || "",
      price: p.price ?? "",
      stock_quantity: p.stock_quantity ?? "",
      min_order_qty: p.min_order_qty ?? "",
      max_order_qty: p.max_order_qty ?? "",
      description: p.description || "",
      category_name: p.category_name || "",
      image_url: p.image_url || "",
      status: p.status || "active",
    });
    setCategories(cats);
    setLoading(false);
  };

  useEffect(() => { load(); }, [productId]);

  const uploadImage = async (file) => {
    setUploading(true);
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    setForm((f) => ({ ...f, image_url: file_url }));
    setUploading(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const category = categories.find((c) => c.name === form.category_name);
    await api.entities.Product.update(productId, {
      ...form,
      price: Number(form.price),
      stock_quantity: Number(form.stock_quantity) || 0,
      min_order_qty: Number(form.min_order_qty) || 1,
      max_order_qty: form.max_order_qty ? Number(form.max_order_qty) : undefined,
      category_id: category?.id,
      category_name: category?.name || form.category_name,
    });
    await load();
    setSaving(false);
  };

  const remove = async () => {
    if (!window.confirm("Delete this product? This cannot be undone.")) return;
    setDeleting(true);
    await api.entities.Product.delete(productId);
    navigate("/vendor/products");
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;
  if (!product) return <EmptyState icon={Package} title="Product not found" />;

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/vendor/products" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> Back to Products
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Edit Product</h1>
        <Button variant="outline" onClick={remove} disabled={deleting} className="text-red-600 border-red-200 hover:bg-red-50">
          <Trash2 className="w-4 h-4 mr-1" /> {deleting ? "Deleting..." : "Delete"}
        </Button>
      </div>

      <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        {/* Image */}
        <div className="flex items-start gap-4">
          <div className="w-28 h-28 rounded-xl bg-slate-100 overflow-hidden shrink-0">
            {form.image_url ? (
              <Image src={form.image_url} className="w-full h-full" fittingType="fill" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300"><Package className="w-8 h-8" /></div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Product Image</Label>
            <label className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <UploadCloud className="w-4 h-4" />{uploading ? "Uploading..." : form.image_url ? "Change Image" : "Upload Image"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])} disabled={uploading} />
            </label>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <select className="w-full border border-slate-200 rounded-lg h-9 px-3 text-sm bg-white" value={form.category_name} onChange={(e) => setForm({ ...form, category_name: e.target.value })}>
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>Brand</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg, litre..." /></div>
          <div className="space-y-1.5"><Label>Package Size</Label><Input value={form.package_size} onChange={(e) => setForm({ ...form, package_size: e.target.value })} placeholder="50KG" /></div>
          <div className="space-y-1.5"><Label>Price (KES)</Label><Input type="number" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Stock Quantity</Label><Input type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Min Order Qty</Label><Input type="number" value={form.min_order_qty} onChange={(e) => setForm({ ...form, min_order_qty: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Max Order Qty</Label><Input type="number" value={form.max_order_qty} onChange={(e) => setForm({ ...form, max_order_qty: e.target.value })} /></div>
        </div>

        <div className="space-y-1.5">
          <Label>Status</Label>
          <select className="w-full sm:w-48 border border-slate-200 rounded-lg h-9 px-3 text-sm bg-white" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="out_of_stock">Out of Stock</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

        <Button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </form>
    </div>
  );
}