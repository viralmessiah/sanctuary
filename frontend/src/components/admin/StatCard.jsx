import React from "react";

const ICON_COLORS = {
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
  cyan: "bg-cyan-50 text-cyan-600",
  indigo: "bg-indigo-50 text-indigo-600",
};

export default function StatCard({ icon: Icon, label, value, sub, accent = "emerald", onClick }) {
  return (
    <button
      onClick={onClick}
      className="group text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer w-full"
    >
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${ICON_COLORS[accent]}`}>
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
        {sub && (
          <span className="text-xs font-medium text-slate-400 bg-slate-50 px-2 py-1 rounded-md">
            {sub}
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-slate-900 mt-4 tracking-tight">{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </button>
  );
}