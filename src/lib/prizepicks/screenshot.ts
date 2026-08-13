/* ============================================================================
   Screenshot (reviewed-image-import) extraction — PURE, DETERMINISTIC parsing of
   the human-transcribed text of a PrizePicks player card into the SAME normalized
   shapes the manual/CSV importers already produce. This module does NOT OCR
   pixels and never scrapes PrizePicks: the uploaded screenshot is kept only as
   visual provenance; the text a user pastes/reviews is what is parsed here. Every
   extracted field is explicit and reviewable — uncertain fields are flagged
   `needsReview`, never silently guessed.

   Goblin / Standard / Demon lines under one market are the SAME canonical market
   at different thresholds — they are grouped, not turned into separate props. The
   PrizePicks-displayed recent history is preserved as SOURCE metadata only and is
   never used as a substitute for official MLB data in the projection.
   ========================================================================== */

import { resolveMarket } from "./market-map";
import { normalizePlayerName, normalizeProjectionType, normalizeTeamAbbr } from "./normalize";
import type { MarketCategory, ProjectionType } from "./types";

/** One threshold parsed from a market block (e.g. "Demon 5.5"). */
export interface ExtractedLine {
  line: number;
  projectionType: ProjectionType;
}

/** One market parsed from a screenshot (all thresholds for that market). */
export interface ExtractedMarket {
  rawMarketLabel: string;
  /** Canonical prop key when the label resolves unambiguously, else "". */
  marketKey: string;
  marketSupported: boolean;
  /** Category if the market resolved (used to disambiguate bare K/BB later). */
  category?: MarketCategory;
  lines: ExtractedLine[];
  needsReview: boolean;
  reviewReasons: string[];
}

/** A player card parsed from a single screenshot. */
export interface ScreenshotExtraction {
  /** Index of the source screenshot/text block this came from. */
  sourceIndex: number;
  playerName: string;
  team?: string;
  position?: string;
  opponent?: string;
  gameTime?: string;
  markets: ExtractedMarket[];
  history: { value: number; opponent?: string; date?: string }[];
  averageL5?: number;
  needsReview: boolean;
  reviewReasons: string[];
}

const LABELS: Record<string, keyof ScreenshotExtraction | "gameTime"> = {
  player: "playerName",
  name: "playerName",
  team: "team",
  position: "position",
  pos: "position",
  opponent: "opponent",
  opp: "opponent",
  "vs": "opponent",
  "game time": "gameTime",
  "game": "gameTime",
  time: "gameTime",
};

const TYPE_RE = /^(standard|std|normal|goblin|green|demon|red)\b/i;
const NUM_RE = /(-?\d+(?:\.\d+)?)/;
const DATE_RE = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Z][a-z]{2}\s+\d{1,2})\b/;
const AVG_RE = /(?:l5|last\s*5|l-?5)\s*(?:avg|average)?|avg(?:erage)?\s*(?:l5|last\s*5)?/i;
const TEAM_TOKEN_RE = /^[A-Z]{2,4}$/;

/** Split a "Label: value" (or "Label" then value on the next line) prefix. */
function labelOf(line: string): { key: string; inlineValue?: string } | null {
  const m = /^([A-Za-z ]{2,20}?)\s*:\s*(.*)$/.exec(line);
  if (m) {
    const key = m[1].trim().toLowerCase();
    if (key in LABELS) return { key, inlineValue: m[2].trim() || undefined };
    return null;
  }
  const key = line.trim().toLowerCase();
  if (key in LABELS) return { key };
  return null;
}

/** Does this line look like an alternative-line row ("Demon 5.5")? */
function parseTypedLine(line: string): ExtractedLine | null {
  const tm = TYPE_RE.exec(line.trim());
  if (!tm) return null;
  const num = NUM_RE.exec(line.slice(tm[0].length));
  if (!num) return null;
  const value = Number(num[1]);
  if (!Number.isFinite(value)) return null;
  return { line: value, projectionType: normalizeProjectionType(tm[1]) };
}

/** A market header is a non-empty line that resolves to a known market label. */
function marketHeader(line: string): { rawMarketLabel: string; marketKey: string; supported: boolean; category?: MarketCategory } | null {
  const raw = line.trim();
  if (!raw || parseTypedLine(raw) || labelOf(raw)) return null;
  const res = resolveMarket(raw);
  if (res.status === "resolved" && res.market) {
    return { rawMarketLabel: raw, marketKey: res.market.canonical, supported: res.market.supported, category: res.market.category };
  }
  // Ambiguous bare markets (e.g. "Strikeouts") are still valid headers — kept for
  // review; the player's role disambiguates them downstream.
  if (res.status === "ambiguous") {
    return { rawMarketLabel: raw, marketKey: "", supported: false };
  }
  return null;
}

/** Parse a PrizePicks recent-history row like "10  DET  7/21" or "3, 5, 5, 3, 10". */
function parseHistoryList(text: string): number[] {
  // A comma/space separated list of numbers (the displayed L5 line).
  const nums = text.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return [];
  return nums.map(Number).filter((n) => Number.isFinite(n));
}

/**
 * Parse ONE screenshot's transcribed text into a structured, reviewable
 * extraction. Deterministic and side-effect-free.
 */
export function parseScreenshotText(text: string, sourceIndex = 0): ScreenshotExtraction {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out: ScreenshotExtraction = {
    sourceIndex,
    playerName: "",
    markets: [],
    history: [],
    needsReview: false,
    reviewReasons: [],
  };

  let current: ExtractedMarket | null = null;
  let sawAvgLabel = false;

  const setField = (field: keyof ScreenshotExtraction | "gameTime", value: string) => {
    const v = value.trim();
    if (!v) return;
    if (field === "team") out.team = normalizeTeamAbbr(v);
    else if (field === "opponent") out.opponent = normalizeTeamAbbr(v) ?? v;
    else if (field === "position") out.position = v.toUpperCase();
    else if (field === "gameTime") out.gameTime = v;
    else if (field === "playerName") out.playerName = v;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1) Labeled fields ("Player:", "Team:", …), value inline or on next line.
    const lab = labelOf(line);
    if (lab) {
      const field = LABELS[lab.key];
      let value = lab.inlineValue;
      if (!value && i + 1 < lines.length && !labelOf(lines[i + 1]) && !marketHeader(lines[i + 1]) && !parseTypedLine(lines[i + 1])) {
        value = lines[i + 1];
        i++;
      }
      if (value) setField(field, value);
      continue;
    }

    // 2) Recent-history average ("L5 Avg 5.2" / "Average 5.2"). Use the LAST
    //    number so tokens like "L5" don't get mistaken for the value.
    if (AVG_RE.test(line)) {
      const nums = line.match(/-?\d+(?:\.\d+)?/g);
      if (nums && nums.length) out.averageL5 = Number(nums[nums.length - 1]);
      sawAvgLabel = true;
      continue;
    }

    // 3) Alternative-line rows ("Standard 4.5", "Goblin 3.5", "Demon 5.5").
    const typed = parseTypedLine(line);
    if (typed) {
      if (!current) {
        // A typed line with no market header — flag for review, don't guess.
        current = { rawMarketLabel: "", marketKey: "", marketSupported: false, lines: [], needsReview: true, reviewReasons: ["line without a market header"] };
        out.markets.push(current);
      }
      current.lines.push(typed);
      continue;
    }

    // 4) Market header ("Pitcher Strikeouts", "Hits Allowed", …).
    const head = marketHeader(line);
    if (head) {
      current = {
        rawMarketLabel: head.rawMarketLabel,
        marketKey: head.marketKey,
        marketSupported: head.supported,
        category: head.category,
        lines: [],
        needsReview: head.marketKey === "",
        reviewReasons: head.marketKey === "" ? [`market "${head.rawMarketLabel}" needs role/review`] : [],
      };
      out.markets.push(current);
      continue;
    }

    // 5) Player name — the first free-standing line before any market, when no
    //    "Player:" label was present.
    if (!out.playerName && out.markets.length === 0 && /[A-Za-z]/.test(line) && !TEAM_TOKEN_RE.test(line)) {
      out.playerName = line;
      continue;
    }

    // 5b) Bare team abbreviation ("NYY") before any market, when unlabeled — the
    //     first such token is taken as the player's team; ambiguous extras are
    //     left for review rather than guessed as opponent.
    if (!out.team && out.markets.length === 0 && TEAM_TOKEN_RE.test(line)) {
      out.team = normalizeTeamAbbr(line);
      continue;
    }

    // 6) Recent-history row(s): a run of numbers (optionally opponent + date).
    if (sawAvgLabel || out.markets.length > 0) {
      const nums = parseHistoryList(line);
      if (nums.length >= 5 && !line.includes(":")) {
        for (const value of nums) out.history.push({ value });
        continue;
      }
      if (nums.length === 1) {
        const opp = line.replace(NUM_RE, "").replace(DATE_RE, "").trim() || undefined;
        const dm = DATE_RE.exec(line);
        out.history.push({ value: nums[0], opponent: opp ? normalizeTeamAbbr(opp) ?? opp : undefined, date: dm?.[1] });
        continue;
      }
    }
  }

  // Finalize per-market review flags: every market needs at least one line.
  for (const m of out.markets) {
    if (m.lines.length === 0) {
      m.needsReview = true;
      m.reviewReasons.push("no thresholds parsed");
    }
  }

  // Card-level review reasons.
  if (!out.playerName) out.reviewReasons.push("player name not found");
  if (out.markets.length === 0) out.reviewReasons.push("no markets found");
  out.needsReview = out.reviewReasons.length > 0 || out.markets.some((m) => m.needsReview);

  return out;
}

/** Identity used to merge screenshots that describe the same player/game. */
function identityKey(e: ScreenshotExtraction): string {
  return [normalizePlayerName(e.playerName), e.team ?? "", e.opponent ?? ""].join("|");
}

/**
 * Merge multiple screenshot extractions that belong to the same player/game into
 * one logical card. Ambiguous identities (same player name but conflicting team
 * or opponent) are NOT merged — they stay separate and flagged for review.
 */
export function mergeScreenshots(extractions: ScreenshotExtraction[]): ScreenshotExtraction[] {
  const byKey = new Map<string, ScreenshotExtraction>();
  const result: ScreenshotExtraction[] = [];

  for (const e of extractions) {
    if (!e.playerName) {
      result.push(e);
      continue;
    }
    const key = identityKey(e);
    const existing = byKey.get(key);
    if (!existing) {
      const clone: ScreenshotExtraction = { ...e, markets: [...e.markets], history: [...e.history], reviewReasons: [...e.reviewReasons] };
      byKey.set(key, clone);
      result.push(clone);
      continue;
    }
    // Same identity → merge markets + history; fill missing scalar fields.
    existing.team ??= e.team;
    existing.position ??= e.position;
    existing.opponent ??= e.opponent;
    existing.gameTime ??= e.gameTime;
    existing.averageL5 ??= e.averageL5;
    for (const m of e.markets) {
      const dup = existing.markets.find((x) => x.rawMarketLabel.toLowerCase() === m.rawMarketLabel.toLowerCase() && m.rawMarketLabel !== "");
      if (dup) {
        for (const ln of m.lines) {
          if (!dup.lines.some((x) => x.line === ln.line && x.projectionType === ln.projectionType)) dup.lines.push(ln);
        }
      } else {
        existing.markets.push(m);
      }
    }
    if (existing.history.length === 0) existing.history.push(...e.history);
    existing.needsReview = existing.reviewReasons.length > 0 || existing.markets.some((x) => x.needsReview) || !existing.playerName;
  }

  return result;
}

/** Parse many transcribed screenshots and merge by identity in one call. */
export function extractScreenshots(texts: string[]): ScreenshotExtraction[] {
  const parsed = texts.map((t, i) => parseScreenshotText(t, i)).filter((e) => e.playerName || e.markets.length > 0);
  return mergeScreenshots(parsed);
}

/**
 * Pick the primary threshold for a market: the Standard line when present, else
 * the first parsed line. The remaining thresholds become alternativeLines.
 */
export function splitPrimaryAndAlternatives(lines: ExtractedLine[]): {
  primary?: ExtractedLine;
  alternatives: ExtractedLine[];
} {
  if (lines.length === 0) return { alternatives: [] };
  const standardIdx = lines.findIndex((l) => l.projectionType === "standard");
  const primaryIdx = standardIdx >= 0 ? standardIdx : 0;
  return {
    primary: lines[primaryIdx],
    alternatives: lines.filter((_, i) => i !== primaryIdx),
  };
}
