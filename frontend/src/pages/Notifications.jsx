import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Bell, Loader2, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const items = await api.entities.Notification.filter(
        { user_id: user.id },
        "-created_date",
        100
      );
      setNotifications(items);
      setError("");
    } catch (err) {
      setError(err.message || "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setError("");
    try {
      await api.entities.Notification.bulkUpdate(
        unread.map((n) => ({ id: n.id, read: true }))
      );
      await load();
    } catch (err) {
      setError(err.message || "Unable to mark notifications as read.");
    }
  };

  const markRead = async (notification) => {
    if (notification.read) return;
    try {
      await api.entities.Notification.update(notification.id, { read: true });
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    } catch (err) {
      setError(err.message || "Unable to mark notification as read.");
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Notifications</h1>
          <p className="text-slate-500 text-sm mt-1">Stay updated on your activity.</p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notifications.some((n) => !n.read) && (
          <button
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <CheckCheck className="w-4 h-4" /> Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet" description="You'll see updates about your orders, financing, and settlements here." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 p-4 ${!n.read ? "bg-emerald-50/30" : ""}`}>
              {!n.read && <span className="w-2 h-2 rounded-full bg-emerald-500 mt-2 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  {n.type && n.type !== "system" && <StatusBadge status={n.type} />}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">{n.message}</p>
                {!n.read && <button onClick={() => markRead(n)} className="text-xs text-slate-500 hover:text-emerald-700 mt-1">Mark as read</button>}
                {n.link && <Link to={n.link} onClick={() => markRead(n)} className="text-xs text-emerald-700 hover:underline mt-1 inline-block">View details</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}