import React, { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function FieldOfficerAssignments() {
  const { user } = useAuth();
  const [verifications, setVerifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visitFor, setVisitFor] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  const [photo, setPhoto] = useState(null);
  const [sideSelling, setSideSelling] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [visitError, setVisitError] = useState("");
  const [visitNotice, setVisitNotice] = useState("");

  useEffect(() => {
    (async () => {
      const v = await api.entities.FieldVerification.filter({ officer_user_id: user.id }, "-created_date", 200);
      setVerifications(v);
      setLoading(false);
    })();
  }, []);

  const recordVisit = async (assignment) => {
    setSavingVisit(true); setVisitError(""); setVisitNotice("");
    try {
      if (!navigator.geolocation) throw new Error("This device does not provide GPS location.");
      if (!photo) throw new Error("Choose a field photo before submitting the visit.");
      const location = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        () => reject(new Error("GPS permission is needed to record this visit.")),
        { enableHighAccuracy: true, timeout: 15000 },
      ));
      const uploaded = await api.integrations.Core.UploadPublicFile({ file: photo });
      await api.entities.FarmVisit.create({
        farmer_user_id: assignment.farmer_user_id,
        officer_user_id: user.id,
        visit_date: new Date().toISOString(),
        latitude: location.latitude,
        longitude: location.longitude,
        notes: visitNotes.trim(),
        photos: [uploaded.file_url],
        side_selling_flag: sideSelling,
      });
      setVisitFor(""); setVisitNotes(""); setPhoto(null); setSideSelling(false);
      setVisitNotice("Visit saved with GPS and photo evidence.");
    } catch (err) { setVisitError(err.message || "Could not record the farm visit."); }
    finally { setSavingVisit(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  const pending = verifications.filter((v) => v.status === "assigned" || v.status === "in_progress");
  const submitted = verifications.filter((v) => v.status === "pending_admin_review");
  const completed = verifications.filter((v) => v.status === "approved" || v.status === "rejected");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Verification Assignments</h1>
        <p className="text-slate-500 text-sm mt-1">Visit farmers, verify land and documents, then submit your report.</p>
      </div>
      {visitError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{visitError}</p>}
      {visitNotice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{visitNotice}</p>}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Pending ({pending.length})</h2>
          {pending.map((v) => (
            <div key={v.id} className="bg-white border border-slate-200 rounded-2xl p-5">
              <Link to={`/fieldofficer/verification/${v.id}`} className="flex items-center justify-between hover:text-emerald-800">
                <div><p className="font-medium">{v.farmer_name}</p><p className="text-xs text-slate-400">Assigned {new Date(v.assigned_date).toLocaleDateString()}</p></div>
                <StatusBadge status={v.status} />
              </Link>
              {visitFor === v.id ? (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <label className="block text-sm font-medium">Photo evidence<input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></label>
                  <Textarea rows={2} value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} placeholder="Field observations" />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sideSelling} onChange={(e) => setSideSelling(e.target.checked)} /> Flag suspected side-selling</label>
                  <div className="flex gap-2"><Button disabled={savingVisit || !photo} size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => recordVisit(v)}>{savingVisit ? "Saving…" : "Capture GPS & submit visit"}</Button><Button size="sm" variant="outline" onClick={() => setVisitFor("")}>Cancel</Button></div>
                </div>
              ) : <Button size="sm" variant="outline" className="mt-3" onClick={() => setVisitFor(v.id)}>Record crop visit</Button>}
            </div>
          ))}
        </div>
      )}
      {submitted.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Awaiting admin review ({submitted.length})</h2>
          {submitted.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5">
              <div>
                <p className="font-medium text-slate-900">{v.farmer_name}</p>
                <p className="text-xs text-slate-400">Findings submitted {v.completed_date ? new Date(v.completed_date).toLocaleDateString() : ""}</p>
              </div>
              <StatusBadge status={v.status} />
            </div>
          ))}
        </div>
      )}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">Completed ({completed.length})</h2>
          {completed.map((v) => (
            <div key={v.id} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{v.farmer_name}</p>
                  <p className="text-xs text-slate-400">Completed {v.completed_date ? new Date(v.completed_date).toLocaleDateString() : ""}</p>
                </div>
                <StatusBadge status={v.status} />
              </div>
            </div>
          ))}
        </div>
      )}
      {pending.length === 0 && submitted.length === 0 && completed.length === 0 && (
        <EmptyState icon={ClipboardCheck} title="No assignments yet" description="You'll see farmer verification assignments here once the admin assigns them." />
      )}
    </div>
  );
}