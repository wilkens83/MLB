"use client";

/* Renders validated ChatResponseBlock unions into trusted components. This is
   the ONLY place blocks become DOM — no raw HTML is ever rendered. */

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import Image from "next/image";
import { pct, formatSigned, formatAmerican, initials, hashHue, cn } from "@/lib/utils";
import { StatPill } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/primitives";
import { SafeMarkdown } from "./safe-markdown";
import type { ChatResponseBlock } from "../schemas/blocks";

const SERIES_COLORS = ["var(--brand-500)", "var(--info)", "var(--positive)", "var(--warning)"];

function fmtCell(value: unknown, format?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (format === "percent") return pct(value);
    if (format === "american") return formatAmerican(value);
    if (format === "signed") return formatSigned(value);
    if (format === "number") return String(Math.round(value * 100) / 100);
    return String(value);
  }
  return String(value);
}

export function ResponseBlock({ block }: { block: ChatResponseBlock }) {
  switch (block.type) {
    case "markdown":
      return <SafeMarkdown content={block.content} />;

    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-border">
          {block.title && (
            <div className="border-b border-border bg-surface-2/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {block.title}
            </div>
          )}
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-2">
                {block.columns.map((c) => (
                  <th key={c.key} className={cn("px-3 py-2 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-surface-hover/50">
                  {block.columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2 tabular-nums", c.align === "right" ? "text-right" : "text-left")}>
                      {fmtCell(row[c.key], c.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "metric-grid":
      return (
        <div>
          {block.title && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{block.title}</div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {block.metrics.map((m, i) => (
              <StatPill key={i} label={m.label} value={m.value} hint={m.hint} tone={m.tone ?? "default"} />
            ))}
          </div>
        </div>
      );

    case "player-card": {
      const d = block.data;
      return (
        <div className="flex gap-3 rounded-xl border border-border bg-surface-2/40 p-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: `hsl(${hashHue(d.name)} 55% 45%)` }}
          >
            {d.headshotId ? (
              <Image src={`/api/headshot/${d.headshotId}`} alt={d.name} width={48} height={48} className="h-full w-full object-cover" unoptimized />
            ) : (
              initials(d.name)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold">{d.name}</span>
              {d.position && <Badge variant="outline">{d.position}</Badge>}
            </div>
            {(d.team || d.opponent) && (
              <div className="text-[11px] text-muted">{[d.team, d.opponent && `vs ${d.opponent}`].filter(Boolean).join(" · ")}</div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.metrics.map((m, i) => (
                <span key={i} className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px]">
                  <span className="text-muted-2">{m.label}: </span>
                  <span className="font-semibold tabular-nums">{m.value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case "game-card": {
      const d = block.data;
      return (
        <div className="rounded-xl border border-border bg-surface-2/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{d.away} @ {d.home}</span>
            <Badge variant={/final/i.test(d.status) ? "outline" : /progress|live/i.test(d.status) ? "positive" : "info"}>{d.status}</Badge>
          </div>
          <div className="mt-1 text-[11px] text-muted">{[d.venue, d.startTime && new Date(d.startTime).toLocaleString()].filter(Boolean).join(" · ")}</div>
          {(d.awayProbable || d.homeProbable) && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div><span className="text-muted-2">Away SP: </span>{d.awayProbable ?? "TBD"}</div>
              <div><span className="text-muted-2">Home SP: </span>{d.homeProbable ?? "TBD"}</div>
            </div>
          )}
          {d.note && <div className="mt-1 text-[11px] text-muted">{d.note}</div>}
        </div>
      );
    }

    case "bar-chart":
    case "line-chart": {
      const d = block.data;
      const rows = d.labels.map((label, i) => {
        const row: Record<string, string | number> = { label };
        d.series.forEach((s) => (row[s.name] = s.values[i] ?? 0));
        return row;
      });
      return (
        <div className="rounded-xl border border-border p-2">
          {d.title && <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{d.title}</div>}
          <ResponsiveContainer width="100%" height={220}>
            {block.type === "bar-chart" ? (
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <Tooltip contentStyle={{ background: "var(--background-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                {d.series.map((s, i) => (
                  <Bar key={s.name} dataKey={s.name} fill={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <Tooltip contentStyle={{ background: "var(--background-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {d.series.map((s, i) => (
                  <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      );
    }

    default:
      return null;
  }
}
