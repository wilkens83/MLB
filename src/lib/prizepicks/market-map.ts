/* ============================================================================
   Market normalization — map external PrizePicks market labels to ONE canonical
   internal prop identifier (must exist in props/catalog.ts). Ambiguous cases
   (hitter K vs pitcher K; hitter walks vs pitcher walks-allowed) are resolved
   only by explicit, exhaustive rules — never by loose partial matching.
   Unknown labels return null and are routed to a review queue, never guessed.
   ========================================================================== */

import type { MarketCategory, PrizePicksMarket } from "./types";

interface MarketDef {
  canonical: string;
  category: MarketCategory;
  label: string;
  supported: boolean;
  /** Exact normalized aliases (lowercased, punctuation-stripped, spaced). */
  aliases: string[];
}

/** Normalize a label for matching: lowercase, collapse punctuation/space. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[+&/]/g, " ")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKET_DEFS: MarketDef[] = [
  // ---- Pitcher ----
  {
    canonical: "strikeouts", category: "pitcher", label: "Pitcher Strikeouts", supported: true,
    aliases: ["pitcher strikeouts", "pitcher ks", "pitcher k", "p strikeouts", "strikeouts pitcher"],
  },
  {
    canonical: "pitcher_outs", category: "pitcher", label: "Pitcher Outs", supported: true,
    aliases: ["pitcher outs", "outs", "p outs", "outs recorded"],
  },
  {
    canonical: "hits_allowed", category: "pitcher", label: "Hits Allowed", supported: true,
    aliases: ["hits allowed", "pitcher hits allowed", "hits allowed pitcher"],
  },
  {
    canonical: "earned_runs", category: "pitcher", label: "Earned Runs Allowed", supported: true,
    aliases: ["earned runs", "earned runs allowed", "er", "earned runs allowed pitcher"],
  },
  {
    canonical: "pitcher_walks", category: "pitcher", label: "Walks Allowed", supported: true,
    aliases: ["walks allowed", "pitcher walks", "pitcher walks allowed", "bb allowed"],
  },
  {
    canonical: "home_runs_allowed", category: "pitcher", label: "Home Runs Allowed", supported: true,
    aliases: ["home runs allowed", "hr allowed", "pitcher home runs allowed", "homeruns allowed"],
  },
  {
    // Not a player-level game-log field in the current engine -> supported:false.
    canonical: "first_inning_runs", category: "pitcher", label: "First Inning Runs Allowed", supported: false,
    aliases: ["first inning runs allowed", "1st inning runs allowed", "first inning run allowed"],
  },
  {
    canonical: "pitcher_fantasy_score", category: "pitcher", label: "Pitcher Fantasy Score", supported: false,
    aliases: ["pitcher fantasy score", "pitcher fantasy", "pitcher fantasy points"],
  },

  // ---- Hitter ----
  { canonical: "hits", category: "hitter", label: "Hits", supported: true, aliases: ["hits", "hitter hits", "h"] },
  { canonical: "singles", category: "hitter", label: "Singles", supported: true, aliases: ["singles", "1b"] },
  { canonical: "doubles", category: "hitter", label: "Doubles", supported: true, aliases: ["doubles", "2b"] },
  { canonical: "triples", category: "hitter", label: "Triples", supported: true, aliases: ["triples", "3b"] },
  { canonical: "home_runs", category: "hitter", label: "Home Runs", supported: true, aliases: ["home runs", "hr", "homeruns", "hitter home runs"] },
  { canonical: "total_bases", category: "hitter", label: "Total Bases", supported: true, aliases: ["total bases", "tb", "bases"] },
  { canonical: "runs", category: "hitter", label: "Runs", supported: true, aliases: ["runs", "runs scored", "r"] },
  { canonical: "rbis", category: "hitter", label: "RBIs", supported: true, aliases: ["rbis", "rbi", "runs batted in"] },
  {
    canonical: "hits_runs_rbis", category: "hitter", label: "Hits + Runs + RBIs", supported: true,
    aliases: ["hits runs rbis", "h r rbi", "hits runs rbi", "hrr", "pra"],
  },
  { canonical: "walks", category: "hitter", label: "Walks", supported: true, aliases: ["hitter walks", "walks drawn", "batter walks"] },
  {
    canonical: "batter_strikeouts", category: "hitter", label: "Batter Strikeouts", supported: true,
    aliases: ["batter strikeouts", "hitter strikeouts", "batter ks", "hitter ks"],
  },
  { canonical: "steals", category: "hitter", label: "Stolen Bases", supported: true, aliases: ["stolen bases", "steals", "sb"] },
  {
    canonical: "fantasy_points", category: "hitter", label: "Hitter Fantasy Score", supported: true,
    aliases: ["hitter fantasy score", "fantasy score", "fantasy points", "hitter fantasy", "fantasy"],
  },
];

/** Bare terms that must stay ambiguous (hitter vs pitcher) — never auto-indexed. */
const RESERVED_AMBIGUOUS = new Set(["walks", "strikeouts", "ks", "bb", "so", "k"]);

const ALIAS_INDEX = new Map<string, MarketDef>();
for (const def of MARKET_DEFS) {
  for (const a of def.aliases) {
    const key = normalizeLabel(a);
    if (!RESERVED_AMBIGUOUS.has(key)) ALIAS_INDEX.set(key, def);
  }
  const labelKey = normalizeLabel(def.label);
  if (!RESERVED_AMBIGUOUS.has(labelKey)) ALIAS_INDEX.set(labelKey, def);
}

/**
 * Bare "strikeouts" / "walks" are ambiguous between hitter and pitcher. Resolve
 * ONLY with an explicit category hint (from the player's role); otherwise return
 * null so the caller routes it to review.
 */
function resolveAmbiguousBare(norm: string, categoryHint?: MarketCategory): MarketDef | null {
  if (norm === "strikeouts" || norm === "ks" || norm === "k" || norm === "so") {
    if (categoryHint === "pitcher") return byCanonical("strikeouts");
    if (categoryHint === "hitter") return byCanonical("batter_strikeouts");
    return null; // ambiguous — do not guess
  }
  if (norm === "walks" || norm === "bb") {
    if (categoryHint === "pitcher") return byCanonical("pitcher_walks");
    if (categoryHint === "hitter") return byCanonical("walks");
    return null;
  }
  return null;
}

function byCanonical(canonical: string): MarketDef {
  return MARKET_DEFS.find((m) => m.canonical === canonical)!;
}

function toMarket(def: MarketDef): PrizePicksMarket {
  return { canonical: def.canonical, category: def.category, label: def.label, supported: def.supported };
}

export interface MarketResolution {
  status: "resolved" | "ambiguous" | "unknown";
  market?: PrizePicksMarket;
  reason: string;
}

/**
 * Resolve an external market label to a canonical market. `categoryHint` is the
 * player's role when known (pitcher/hitter), used only to disambiguate bare
 * "strikeouts"/"walks".
 */
export function resolveMarket(rawLabel: string, categoryHint?: MarketCategory): MarketResolution {
  const norm = normalizeLabel(rawLabel);
  if (!norm) return { status: "unknown", reason: "empty label" };

  const exact = ALIAS_INDEX.get(norm);
  if (exact) return { status: "resolved", market: toMarket(exact), reason: "exact alias" };

  const bare = resolveAmbiguousBare(norm, categoryHint);
  if (bare) return { status: "resolved", market: toMarket(bare), reason: "resolved with role hint" };
  if (norm === "strikeouts" || norm === "walks" || norm === "ks" || norm === "bb") {
    return { status: "ambiguous", reason: `"${rawLabel}" is ambiguous (hitter vs pitcher) — needs player role` };
  }

  return { status: "unknown", reason: `unrecognized market "${rawLabel}" — sent to review queue` };
}

export function marketByCanonical(canonical: string): PrizePicksMarket | undefined {
  const def = MARKET_DEFS.find((m) => m.canonical === canonical);
  return def ? toMarket(def) : undefined;
}

export function allMarkets(): PrizePicksMarket[] {
  return MARKET_DEFS.map(toMarket);
}
