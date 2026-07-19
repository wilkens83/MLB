import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Round to a fixed number of decimals without floating point cruft. */
export function round(value: number, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Format a 0..1 probability as a percentage string. */
export function pct(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${round(value * 100, decimals)}%`;
}

/** Format American odds with an explicit sign. */
export function formatAmerican(odds: number | null | undefined) {
  if (odds === null || odds === undefined || !Number.isFinite(odds)) return "—";
  const v = Math.round(odds);
  return v > 0 ? `+${v}` : `${v}`;
}

/** Signed number formatting for deltas (e.g. line movement, edge). */
export function formatSigned(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return "—";
  const r = round(value, decimals);
  return r > 0 ? `+${r}` : `${r}`;
}

/** Compact numeric formatting (1.2k, 3.4M). */
export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatUSD(value: number) {
  return USD.format(value);
}

/** Deterministic hue from a string — used for avatars / team fallbacks. */
export function hashHue(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) % 360;
  return h;
}

/** Initials for an athlete/team display name. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
