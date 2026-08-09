/* ============================================================================
   Recent-performance bar chart. Bars are colored STRICTLY by result vs the
   selected line — green = over, red = under, neutral = push, dashed/outlined =
   upcoming (unplayed). The value sits on top of each bar; the line is drawn as a
   yellow reference. Colors here mean "result relative to the line", nothing else.
   ========================================================================== */

"use client";

import {
  Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";
import type { VmHistoryPoint } from "@/lib/players/prop-analysis/types";

const COLOR = {
  over: "var(--positive)",
  under: "var(--negative)",
  push: "var(--muted)",
} as const;

export function PerformanceChart({
  history,
  line,
  unit,
}: {
  history: VmHistoryPoint[];
  line: number;
  unit: string;
}) {
  const data = history.map((h, i) => ({
    idx: i,
    // upcoming games have no value — render a short ghost bar so the slot shows.
    value: h.upcoming ? line : h.value ?? 0,
    display: h.upcoming ? null : h.value,
    result: h.result,
    upcoming: h.upcoming ?? false,
    opponent: h.opponent,
    date: h.date,
    isHome: h.isHome,
  }));

  const maxV = Math.max(line, ...data.map((d) => (d.upcoming ? 0 : d.value))) * 1.2 || line * 1.5;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 22, right: 8, bottom: 20, left: -20 }} barCategoryGap="18%">
        <YAxis
          domain={[0, Math.ceil(maxV)]}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={34}
        />
        <XAxis
          dataKey="idx"
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          height={28}
          interval={0}
          tick={{ fontSize: 10, fill: "var(--muted-2)" }}
          tickFormatter={(v: number) => {
            const d = data[v];
            if (!d) return "";
            return d.upcoming ? "NEXT" : (d.opponent ?? "").slice(0, 3).toUpperCase();
          }}
        />
        <ReferenceLine
          y={line}
          stroke="var(--warning)"
          strokeWidth={1.75}
          label={{ value: `Line ${line}`, fill: "var(--warning)", fontSize: 11, position: "insideTopRight" }}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)", opacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            if (d.upcoming) {
              return (
                <div className="glass-strong rounded-lg border border-border px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold text-brand-500">Upcoming</div>
                  <div className="text-muted">{d.isHome ? "vs" : "@"} {d.opponent ?? "—"}</div>
                </div>
              );
            }
            return (
              <div className="glass-strong rounded-lg border border-border px-3 py-2 text-xs shadow-lg">
                <div className="font-semibold">{d.display} {unit}</div>
                <div className="text-muted">{d.date} · {d.isHome ? "vs" : "@"} {d.opponent ?? "—"}</div>
                <div className={d.result === "over" ? "text-[var(--positive)]" : d.result === "under" ? "text-[var(--negative)]" : "text-muted"}>
                  {d.result === "push" ? "push" : `${d.result} ${line}`}
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
          <LabelList
            dataKey="display"
            position="top"
            fontSize={11}
            fill="var(--foreground)"
            formatter={(v: unknown) => (v === null || v === undefined ? "" : String(v))}
          />
          {data.map((d) => (
            <Cell
              key={d.idx}
              fill={d.upcoming ? "transparent" : COLOR[d.result ?? "push"]}
              fillOpacity={d.upcoming ? 1 : 0.9}
              stroke={d.upcoming ? "var(--brand-500)" : undefined}
              strokeDasharray={d.upcoming ? "4 3" : undefined}
              strokeWidth={d.upcoming ? 1.5 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
