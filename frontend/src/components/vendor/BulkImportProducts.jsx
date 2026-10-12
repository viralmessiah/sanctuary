import React, { useState } from "react";
import { api } from "@/api/client";
import * as XLSX from "xlsx";
import { UploadCloud, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";

export default function BulkImportProducts({ profile, categories, onDone }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (rows.length === 0) {
        setResult({ ok: false, message: "No products found in the file." });
        setImporting(false);
        return;
      }

      const me = await api.auth.me();
      const products = rows.map((r) => {
        const cat = categories.find(
          (c) => c.name.toLowerCase() === String(r.category_name || "").toLowerCase()
        );
        return {
          name: String(r.name || "").trim(),
          sku: String(r.sku || "").trim(),
          brand: String(r.brand || "").trim(),
          unit: String(r.unit || "").trim(),
          package_size: String(r.package_size || "").trim(),
          price: Number(r.price) || 0,
          stock_quantity: Number(r.stock_quantity) || 0,
          description: String(r.description || "").trim(),
          category_id: cat?.id,
          category_name: String(r.category_name || cat?.name || "").trim(),
          image_url: String(r.image_url || "").trim(),
          vendor_user_id: me.id,
          vendor_name: profile.business_name,
          status: "active",
        };
      }).filter((p) => p.name);

      if (products.length === 0) {
        setResult({ ok: false, message: "No valid products found — each row needs at least a name." });
        setImporting(false);
        return;
      }

      const created = await api.entities.Product.bulkCreate(products);
      setResult({ ok: true, count: created.length, total: rows.length });
      onDone();
    } catch (err) {
      setResult({ ok: false, message: err.message || "Import failed." });
    }
    setImporting(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
        <h2 className="font-medium text-slate-900">Bulk Import Products</h2>
      </div>
      <p className="text-sm text-slate-500">
        Upload an Excel or CSV file with columns: <span className="font-mono text-xs">name, sku, brand, unit, package_size, price, stock_quantity, description, category_name, image_url</span>
      </p>
      <label className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
        {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
        {importing ? "Importing..." : "Choose Excel/CSV File"}
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          disabled={importing}
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
        />
      </label>
      {result && (
        <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>
            {result.ok
              ? `Imported ${result.count} of ${result.total} products successfully.`
              : result.message}
          </span>
        </div>
      )}
    </div>
  );
}