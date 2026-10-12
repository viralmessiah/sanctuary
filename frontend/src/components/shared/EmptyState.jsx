import React from "react";

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
      {Icon && <Icon className="w-10 h-10 text-slate-300 mb-3" strokeWidth={1.5} />}
      <p className="text-slate-700 font-medium">{title}</p>
      {description && <p className="text-sm text-slate-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}