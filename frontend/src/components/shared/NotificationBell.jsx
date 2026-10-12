import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { Bell } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function NotificationsBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popoverTop, setPopoverTop] = useState(56);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  const load = async () => {
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
      setError(err.message || "Unable to refresh notifications.");
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setLoading(true);
    try {
      await api.entities.Notification.bulkUpdate(
        unread.map((n) => ({ id: n.id, read: true }))
      );
      await load();
    } catch (err) {
      setError(err.message || "Unable to mark notifications as read.");
    } finally {
      setLoading(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const unreadNotifications = notifications.filter((n) => !n.read);
  const togglePopover = () => {
    if (!open && buttonRef.current) {
      setPopoverTop(Math.min(buttonRef.current.getBoundingClientRect().bottom + 8, window.innerHeight - 120));
    }
    setOpen(!open);
  };

  const openNotification = async (notification) => {
    if (!notification.read) {
      try {
        await api.entities.Notification.update(notification.id, { read: true });
        setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, read: true } : item));
      } catch (err) {
        setError(err.message || "Unable to mark notification as read.");
      }
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        onClick={togglePopover}
        className="relative p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px] px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed right-3 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-[60] overflow-hidden"
          style={{ top: popoverTop }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="font-semibold text-sm text-slate-900">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {error && <p role="alert" className="px-4 py-2 text-xs text-red-700">{error}</p>}
            {unreadNotifications.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No new notifications</p>
            ) : (
              unreadNotifications.map((n) => (
                <Link
                  key={n.id}
                  to={n.link || "/notifications"}
                  onClick={() => openNotification(n)}
                  className={`block px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                    !n.read ? "bg-emerald-50/40" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{n.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 font-medium border-t border-slate-100"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}