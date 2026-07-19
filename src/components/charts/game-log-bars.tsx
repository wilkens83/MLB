"use client";

import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PropGameSample } from "@/lib/mlb/series";
import type { Side } from "@/lib/analytics/hitRate";

interface Props {
  samples: PropGameSample[];
  line: number;
  side: Side;
  unit?: string;
}

export function GameLogBars({ samples, line, side, unit }: Props) {
  const data = samples.map((s, i) => ({
    idx: i,
    value: s.value,
    date: s.date,
    opponent: s.opponent,
    isHome: s.isHome,
    hit: side === "over" ? s.value > line : s.value < line,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
        <XAxis dataKey="idx" hide />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={32}
        />
        <ReferenceLine
          y={line}
          stroke="var(--brand-500)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          label={{ value: line.toString(), fill: "var(--brand-500)", fontSize: 11, position: "right" }}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)", opacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            return (
              <div className="glass-strong rounded-lg border border-border px-3 py-2 text-xs shadow-lg">
                <div className="font-semibold">
                  {d.value} {unit ?? ""}
                </div>
                <div className="text-muted">
                  {d.date} · {d.isHome ? "vs" : "@"} {d.opponent ?? "—"}
                </div>
                <div className={d.hit ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                  {d.hit ? `${side} hit` : `${side} miss`}
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={26}>
          {data.map((d) => (
            <Cell key={d.idx} fill={d.hit ? "var(--positive)" : "var(--negative)"} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
