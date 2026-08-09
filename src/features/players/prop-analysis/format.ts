import type { VmMetric } from "@/lib/players/prop-analysis/types";

export function formatMetric(m: VmMetric): string {
  if (m.value === null) return "—";
  switch (m.format) {
    case "pct": return `${m.value.toFixed(1)}%`;
    case "one": return m.value.toFixed(m.value >= 100 ? 0 : m.value < 10 ? 2 : 1);
    case "era": return m.value.toFixed(2);
    case "int": return String(Math.round(m.value));
  }
}

export function formatDelta(m: VmMetric): { text: string; good: boolean } | null {
  if (m.delta === undefined || m.delta === null) return null;
  const sign = m.delta > 0 ? "+" : "";
  const good = m.deltaGood === "down" ? m.delta < 0 : m.delta > 0;
  return { text: `${sign}${m.delta.toFixed(1)}`, good };
}

export function pctStr(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function timeAgo(ts?: number | string): string {
  if (ts === undefined) return "—";
  const ms = Date.now() - (typeof ts === "string" ? new Date(ts).getTime() : ts);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}
