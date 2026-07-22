/* ============================================================================
   Text normalization for player names and projection types. Deterministic,
   accent/suffix-aware, so imported names match the MLB player system reliably.
   ========================================================================== */

import type { ProjectionType } from "./types";

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Strip accents/diacritics (José -> jose). */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Normalize a player name for matching: strip accents, lowercase, drop
 * punctuation, remove common suffixes, collapse whitespace.
 * "José Ramírez Jr." -> "jose ramirez"
 */
export function normalizePlayerName(name: string): string {
  const base = stripAccents(name)
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = base.split(" ").filter((p) => !SUFFIXES.has(p.replace(/-/g, "")));
  return parts.join(" ").trim();
}

/** Normalized name WITHOUT hyphens too, for looser secondary matching. */
export function normalizePlayerNameLoose(name: string): string {
  return normalizePlayerName(name).replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** Normalize a projection-type label. Unknown -> "unknown" (never guessed). */
export function normalizeProjectionType(raw: string | undefined): ProjectionType {
  if (!raw) return "standard";
  const n = raw.toLowerCase().trim();
  if (n === "standard" || n === "std" || n === "normal" || n === "") return "standard";
  if (n === "goblin" || n === "green") return "goblin";
  if (n === "demon" || n === "red") return "demon";
  return "unknown";
}

/** Team abbreviation normalization to upper-case, trimmed. */
export function normalizeTeamAbbr(abbr?: string): string | undefined {
  const a = abbr?.trim().toUpperCase();
  return a && a.length > 0 ? a : undefined;
}
