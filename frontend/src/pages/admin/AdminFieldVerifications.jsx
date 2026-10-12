import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import EmptyState from "@/components/shared/EmptyState";
import StatusBadge from "@/components/shared/StatusBadge";
import { ClipboardCheck, Loader2, Search, X } from "lucide-react";

const statuses = ["all", "assigned", "in_progress", "pending_admin_review", "approved", "rejected"];

async function loadAll(entity) {
  const pageSize = 5000;
  const results = [];
  for (let skip = 0; ; skip += pageSize) {
    const page = await api.entities[entity].list("-created_date", pageSize, skip);
    results.push(...page);
    if (page.length < pageSize) return results;
  }
}

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

function Detail({ verification, farmer }) {
  const profileFacts = [
    ["Region", farmer?.region],
    ["Farm", farmer?.farm_name],
    ["Location", farmer?.farm_location],
    ["Declared acreage", farmer?.acreage ? `${farmer.acreage} acres` : ""],
    ["Declared crops", farmer?.crops?.join(", ")],
  ];

  return (
    <section aria-label="Field verification details" className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Verification record</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{verification.farmer_name || farmer?.full_name || "Farmer"}</h2>
          <p className="mt-1 text-sm text-slate-500">Field officer: {verification.officer_name || "Not recorded"}</p>
        </div>
        <StatusBadge status={verification.status} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-medium text-slate-900">Farmer profile on record</h3>
          {profileFacts.map(([label, value]) => (
            <p key={label} className="text-sm text-slate-600">
              <span className="text-slate-400">{label}: </span>{value || "—"}
            </p>
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="font-medium text-slate-900">Officer findings</h3>
          <p className="text-sm text-slate-600"><span className="text-slate-400">Verified land size: </span>{verification.land_size_verified ? `${verification.land_size_verified} acres` : "—"}</p>
          <p className="text-sm text-slate-600"><span className="text-slate-400">Verified crops: </span>{verification.crops_verified?.join(", ") || "—"}</p>
          <p className="text-sm text-slate-600"><span className="text-slate-400">Land notes: </span>{verification.land_verification_notes || "—"}</p>
          <p className="text-sm text-slate-600"><span className="text-slate-400">Document notes: </span>{verification.document_verification_notes || "—"}</p>
        </div>
      </div>

      <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <p><span className="text-slate-400">Assigned: </span>{formatDate(verification.assigned_date)}</p>
        <p><span className="text-slate-400">Visit completed: </span>{formatDate(verification.completed_date)}</p>
        <p><span className="text-slate-400">Record created: </span>{formatDate(verification.created_date)}</p>
        <p><span className="text-slate-400">Last updated: </span>{formatDate(verification.updated_date)}</p>
      </div>

      {verification.rejection_reason && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Admin decision note: {verification.rejection_reason}
        </p>
      )}

      <div>
        <h3 className="mb-3 font-medium text-slate-900">Private field evidence</h3>
        {verification.field_visit_photos?.length ? (
          <div className="flex flex-wrap gap-3">
            {verification.field_visit_photos.map((url, index) => (
              <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={url}
                  alt={`Field evidence ${index + 1} for ${verification.farmer_name || "farmer"}`}
                  className="h-28 w-36 rounded-lg border border-slate-200 object-cover"
                />
                <span className="mt-1 block text-xs text-emerald-700">Open evidence {index + 1}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No field photos were recorded on this visit.</p>
        )}
      </div>
    </section>
  );
}

export default function AdminFieldVerifications() {
  const [records, setRecords] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [verifications, profiles] = await Promise.all([
          loadAll("FieldVerification"),
          loadAll("FarmerProfile"),
        ]);
        setRecords(verifications);
        setFarmers(profiles);
      } catch (loadError) {
        setError(loadError.message || "Could not load field verification records.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const farmerByUserId = useMemo(
    () => new Map(farmers.map((farmer) => [farmer.created_by_id, farmer])),
    [farmers],
  );
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const profile = farmerByUserId.get(record.farmer_user_id);
      const matchesStatus = status === "all" || record.status === status;
      const matchesSearch = !query || [
        record.farmer_name,
        record.officer_name,
        profile?.farm_name,
        profile?.region,
        record.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [farmerByUserId, records, search, status]);
  const selected = records.find((record) => record.id === selectedId);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
          <ClipboardCheck className="h-5 w-5 text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Field Verification Archive</h1>
          <p className="mt-0.5 text-sm text-slate-500">Review submitted findings, evidence, and admin decisions across field visits.</p>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Search field verifications"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search farmer, officer, farm, or region"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600"
          />
        </label>
        <select
          aria-label="Filter by verification status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          {statuses.map((item) => <option key={item} value={item}>{item === "all" ? "All statuses" : item.replaceAll("_", " ")}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      ) : filteredRecords.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="divide-y divide-slate-100">
            {filteredRecords.map((record) => {
              const farmer = farmerByUserId.get(record.farmer_user_id);
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedId(record.id)}
                  className={`flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-slate-50 ${selectedId === record.id ? "bg-emerald-50" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{record.farmer_name || farmer?.full_name || "Farmer"}</span>
                    <span className="mt-1 block truncate text-sm text-slate-500">
                      Officer: {record.officer_name || "Not recorded"} · {farmer?.farm_name || "Farm not specified"} · {formatDate(record.completed_date || record.assigned_date)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={record.status} />
                    <span className="sr-only">Open verification details</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState title="No field verifications found" description="Try a different search or status filter." />
      )}

      {selected && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={() => setSelectedId("")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
              <X className="h-4 w-4" /> Close details
            </button>
          </div>
          <Detail verification={selected} farmer={farmerByUserId.get(selected.farmer_user_id)} />
        </div>
      )}
    </div>
  );
}
