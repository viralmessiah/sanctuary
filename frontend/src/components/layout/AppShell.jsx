import React, { useState } from "react";
import { Outlet, Link, useLocation, matchPath } from "react-router-dom";
import { api } from "@/api/client";
import { ChevronLeft, ChevronRight, LogOut, Leaf, Menu, X } from "lucide-react";
import NotificationsBell from "@/components/shared/NotificationBell";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

export default function AppShell({ navItems, portalLabel }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const isActive = (path) => Boolean(matchPath({ path, end: false }, location.pathname));
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Keep the control usable when browser storage is unavailable.
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex md:flex-col h-full bg-sidebar shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? "w-16" : "w-64"}`}>
        <div className={`flex items-center ${sidebarCollapsed ? "flex-col gap-3 px-2 py-4" : "gap-2 px-5 py-6"}`}>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Leaf className="w-4.5 h-4.5 text-emerald-400" />
          </div>
          {!sidebarCollapsed && <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm tracking-tight">Sanctuary AgriConnect</p>
            <p className="text-white/40 text-[11px]">{portalLabel}</p>
          </div>}
          {!sidebarCollapsed && <NotificationsBell />}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          {sidebarCollapsed && <NotificationsBell />}
        </div>
        <nav aria-label={`${portalLabel} navigation`} className={`sidebar-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1 pb-4 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          {navItems.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={sidebarCollapsed ? item.label : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
                className={`flex items-center ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"} py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className={sidebarCollapsed ? "sr-only" : "truncate"}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => api.auth.logout()}
          title={sidebarCollapsed ? "Log out" : undefined}
          aria-label={sidebarCollapsed ? "Log out" : undefined}
          className={`flex items-center ${sidebarCollapsed ? "justify-center mx-2 px-2" : "gap-3 mx-3 px-3"} py-2.5 mb-4 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors`}
        >
          <LogOut className="w-4 h-4" strokeWidth={1.75} />
          <span className={sidebarCollapsed ? "sr-only" : ""}>Log out</span>
        </button>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden absolute top-0 inset-x-0 z-30 bg-sidebar flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <Leaf className="w-4.5 h-4.5 text-emerald-400" />
          <span className="text-white font-semibold text-sm">Sanctuary AgriConnect</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationsBell />
          <button onClick={() => setMobileOpen(!mobileOpen)} className="text-white p-1">
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden absolute inset-0 top-14 z-20 bg-sidebar flex flex-col py-4">
          <nav aria-label={`${portalLabel} navigation`} className="sidebar-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 space-y-1 pb-4">
            {navItems.map((item) => {
              const active = isActive(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-4 h-4" strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => api.auth.logout()}
            className="flex items-center gap-3 px-3 py-2.5 mx-3 mb-4 rounded-xl text-sm font-medium text-white/60"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      )}

      <main className="h-full flex-1 min-w-0 overflow-y-auto overscroll-contain pt-14 md:pt-0">
        <div className="min-h-full max-w-6xl mx-auto px-4 sm:px-6 py-6 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}