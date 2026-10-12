import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { Loader2, ShieldAlert } from "lucide-react";

const categories = ["service", "harassment", "fraud", "dispute", "privacy", "other"];

export default function Complaints() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [category, setCategory] = useState("service");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => setComplaints(await api.entities.Complaint.list("-created_date", 100));
  useEffect(() => {
    load().catch((err) => setError(err.message || "Could not load complaints."))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api.entities.Complaint.create({ category, message: message.trim() });
      setMessage("");
      setNotice("Your complaint has been sent to the independent support and compliance queue. It is not routed through your loan officer.");
      await load();
    } catch (err) { setError(err.message || "Could not submit your complaint."); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Independent complaints channel</h1>
        <p className="mt-1 text-sm text-slate-500">This queue is handled by support and compliance staff, separate from loan officers.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-emerald-700" /><h2 className="font-medium">Submit a complaint</h2></div>
        <div><Label htmlFor="complaint-category">Category</Label><select id="complaint-category" className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></div>
        <div><Label htmlFor="complaint-message">What happened?</Label><Textarea id="complaint-message" required minLength={8} maxLength={5000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        <Button disabled={busy} className="bg-emerald-800 hover:bg-emerald-900">{busy ? "Sending…" : "Send privately"}</Button>
      </form>
      <section className="space-y-3">
        <h2 className="font-medium text-slate-800">Your complaints</h2>
        {complaints.map((complaint) => (
          <article key={complaint.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium capitalize">{complaint.category}</p><StatusBadge status={complaint.status} /></div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{complaint.message}</p>
            {complaint.resolution && <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Resolution: {complaint.resolution}</p>}
            <p className="mt-2 text-xs text-slate-400">Submitted {new Date(complaint.created_date).toLocaleDateString()}</p>
          </article>
        ))}
        {complaints.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">You have not submitted a complaint.</p>}
      </section>
    </div>
  );
}
