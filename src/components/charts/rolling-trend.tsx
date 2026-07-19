"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  values: number[];
  rolling5: number[];
  rolling10: number[];
  line: number;
}

export function RollingTrend({ values, rolling5, rolling10, line }: Props) {
  const data = values.map((v, i) => ({
    idx: i + 1,
    game: v,
    r5: rolling5[i],
    r10: rolling10[i],
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="idx" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
        <ReferenceLine y={line} stroke="var(--brand-500)" strokeDasharray="4 4" />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="glass-strong rounded-lg border border-border px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 font-semibold">Game {label}</div>
                {payload.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-3">
                    <span style={{ color: p.color as string }}>{labelFor(p.name as string)}</span>
                    <span className="tabular-nums">{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</span>
                  </div>
                ))}
              </div>
            );
          }}
        />
        <Line type="monotone" dataKey="game" stroke="var(--muted-2)" strokeWidth={1} dot={false} opacity={0.5} />
        <Line type="monotone" dataKey="r10" stroke="var(--info)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="r5" stroke="var(--brand-500)" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function labelFor(key: string) {
  return key === "game" ? "Game" : key === "r5" ? "5-game avg" : "10-game avg";
}
