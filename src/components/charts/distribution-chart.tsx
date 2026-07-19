"use client";

import {
  Area,
  AreaChart,
  Cell,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DistributionBucket } from "@/lib/prediction/simulate";

interface Props {
  distribution: DistributionBucket[];
  line: number;
  continuous?: boolean;
}

/**
 * Probability distribution from the Monte Carlo simulation. Discrete count props
 * render as a PMF bar chart; continuous props render as a density area.
 */
export function DistributionChart({ distribution, line, continuous }: Props) {
  const data = distribution.map((b) => ({ ...b, over: b.value > line }));

  if (continuous) {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="distFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-500)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--brand-500)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="value" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <ReferenceLine x={line} stroke="var(--brand-500)" strokeDasharray="4 4" />
          <Tooltip content={<DistTooltip />} />
          <Area type="monotone" dataKey="probability" stroke="var(--brand-500)" strokeWidth={2} fill="url(#distFill)" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <XAxis dataKey="value" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <ReferenceLine x={line} stroke="var(--brand-500)" strokeDasharray="4 4" strokeWidth={1.5} />
        <Tooltip cursor={{ fill: "var(--surface-2)", opacity: 0.4 }} content={<DistTooltip />} />
        <Bar dataKey="probability" radius={[3, 3, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.value}
              fill={d.over ? "var(--positive)" : "var(--muted-2)"}
              fillOpacity={d.over ? 0.85 : 0.5}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DistTooltip({ active, payload }: { active?: boolean; payload?: { payload: DistributionBucket }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-strong rounded-lg border border-border px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold">{d.value}</div>
      <div className="text-muted">{(d.probability * 100).toFixed(1)}% probability</div>
    </div>
  );
}
