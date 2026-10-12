import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { Sprout, TrendingUp, Target, Award } from "lucide-react";

export default function HarvestYieldCharts({ harvests }) {
  const chartData = useMemo(() => {
    return harvests
      .filter((h) => h.expected_quantity != null || h.actual_quantity != null)
      .map((h) => ({
        crop: h.crop,
        expected: h.expected_quantity || 0,
        actual: h.actual_quantity || 0,
        unit: h.unit || "bags",
      }));
  }, [harvests]);

  const totals = useMemo(() => {
    const expected = harvests.reduce((s, h) => s + (h.expected_quantity || 0), 0);
    const actual = harvests.reduce((s, h) => s + (h.actual_quantity || 0), 0);
    const unit = harvests[0]?.unit || "bags";
    const pct = expected > 0 ? Math.round((actual / expected) * 100) : 0;
    return { expected, actual, unit, pct };
  }, [harvests]);

  if (harvests.length === 0) return null;

  const statCards = [
    { label: "Total Expected", value: `${totals.expected.toLocaleString()} ${totals.unit}`, icon: Target, color: "text-blue-600 bg-blue-50" },
    { label: "Total Harvested", value: `${totals.actual.toLocaleString()} ${totals.unit}`, icon: Sprout, color: "text-emerald-600 bg-emerald-50" },
    { label: "Goal Progress", value: `${totals.pct}%`, icon: TrendingUp, color: totals.pct >= 100 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50" },
    { label: "Crop Cycles", value: harvests.length, icon: Award, color: "text-slate-600 bg-slate-50" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{s.label}</p>
            <p className="text-xl font-semibold text-slate-900 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Overall progress bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Overall Yield vs Goal</h3>
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
          <span>{totals.actual.toLocaleString()} {totals.unit} harvested</span>
          <span>{totals.expected.toLocaleString()} {totals.unit} goal</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${totals.pct >= 100 ? "bg-emerald-600" : totals.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(totals.pct, 100)}%` }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">
          {totals.pct >= 100
            ? "🎉 You've exceeded your production goal!"
            : `You're ${totals.pct}% of the way to your target yield.`}
        </p>
      </div>

      {/* Per-crop comparison chart */}
      {chartData.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Yield by Crop — Expected vs Actual</h3>
          <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 60)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 12, fill: "#94a3b8" }} />
              <YAxis dataKey="crop" type="category" tick={{ fontSize: 12, fill: "#475569" }} width={80} />
              <Tooltip
                formatter={(value, name, props) => [`${value} ${props.payload.unit}`, name === "expected" ? "Expected" : "Actual"]}
                contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
              />
              <Legend formatter={(v) => (v === "expected" ? "Expected" : "Actual")} wrapperStyle={{ fontSize: "12px" }} />
              <Bar dataKey="expected" fill="#94a3b8" radius={[0, 4, 4, 0]} name="expected" />
              <Bar dataKey="actual" fill="#059669" radius={[0, 4, 4, 0]} name="actual">
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.actual >= entry.expected ? "#059669" : entry.actual > 0 ? "#f59e0b" : "#cbd5e1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-600" /> On track / exceeded</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500" /> Below target</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300" /> Not yet harvested</span>
          </div>
        </div>
      )}
    </div>
  );
}