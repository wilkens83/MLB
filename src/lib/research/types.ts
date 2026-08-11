/* ============================================================================
   Reddit MLB News & Trend Intelligence — domain contracts.

   Reddit is an EARLY-WARNING / CONTEXT source, never an authoritative statistical
   source. Raw Reddit items are kept strictly separate from interpreted
   ContextEvents, and NOTHING here ever modifies a model probability. A confirmed
   event may LATER be converted, by an explicit deterministic layer, into a model
   feature — sentiment never can. See docs/product/REDDIT_RESEARCH.md.
   ========================================================================== */

/* ------------------------------- raw items -------------------------------- */

export interface RedditItem {
  id: string;
  type: "post" | "comment";
  title?: string;
  body?: string;
  subreddit: string;
  author?: string;
  score?: number;
  commentCount?: number;
  url: string;
  createdAt: number; // epoch ms
  fetchedAt: number; // epoch ms
  query: string;
  /** Whether the item links to an external (non-reddit) source. */
  hasExternalLink?: boolean;
}

/* --------------------------- context events ------------------------------- */

export type ContextEventType =
  | "injury"
  | "scratch"
  | "pitch_limit"
  | "role_change"
  | "velocity_change"
  | "command_issue"
  | "lineup"
  | "opener"
  | "bullpen_game"
  | "fatigue"
  | "return_from_il"
  | "other";

export type ContextEventStatus = "unverified" | "reported" | "confirmed" | "rejected";

export type ContextEventSeverity = "critical" | "high" | "medium" | "info";

export interface ContextEventSourceRef {
  url: string;
  subreddit?: string;
  createdAt?: number;
}

export interface SourceCredibility {
  level: "low" | "medium" | "high";
  reasons: string[];
}

/** An interpreted, deduplicated context signal. Never a probability. */
export interface ContextEvent {
  id: string;
  playerId: number;
  gamePk?: number;
  type: ContextEventType;
  summary: string;
  status: ContextEventStatus;
  /** 0..1 — a CONFIDENCE in the signal's existence/credibility, NOT a game probability. */
  confidence: number;
  severity: ContextEventSeverity;
  sourceType: "reddit";
  reddit: {
    mentions: number;
    subreddits: string[];
    firstSeenAt: number;
    lastSeenAt: number;
    /** Number of distinct discussion clusters supporting this event. */
    uniqueThreads: number;
  };
  credibility: SourceCredibility;
  sources: ContextEventSourceRef[];
  /** Human-readable verification note (what was/ wasn't confirmed). */
  verificationNote?: string;
  fetchedAt: number;
}

/* --------------------------- secondary signals ---------------------------- */

export interface CommunitySentiment {
  morePct?: number;
  lessPct?: number;
  positivePct?: number;
  negativePct?: number;
  neutralPct?: number;
  relevantMentions: number;
  status: "available" | "insufficient_sample";
}

export interface RedditTrend {
  mentions1h: number;
  mentions6h: number;
  mentions24h: number;
  uniqueThreads24h: number;
  trend: "rising" | "stable" | "falling";
}

/* ------------------------------- provider --------------------------------- */

export interface RedditSearchInput {
  playerId: number;
  playerName: string;
  team?: string;
  opponent?: string;
  lookbackHours?: number;
}

/** Raw provider result — items only, plus availability. Interpretation happens
    downstream in the engine. */
export interface RedditResearchResult {
  status: "available" | "unavailable" | "rate_limited";
  items: RedditItem[];
  /** Why unavailable (disabled / no creds / error) — surfaced honestly, never faked. */
  note?: string;
  fetchedAt: number;
}

export interface RedditResearchProvider {
  readonly name: string;
  searchPlayer(input: RedditSearchInput): Promise<RedditResearchResult>;
}

/* ------------------------- engine output (view) --------------------------- */

/** The full research payload the API/UI consume. */
export interface PlayerResearch {
  playerId: number;
  status: "available" | "unavailable" | "rate_limited";
  events: ContextEvent[];
  sentiment: CommunitySentiment;
  trend: RedditTrend;
  note?: string;
  lastUpdated: number;
}

/* --------------------- deterministic feature bridge ----------------------- */

/**
 * The ONLY bridge from research to the model — and it consumes CONFIRMED events
 * only, mapping them to explicit deterministic feature flags. Sentiment, trend,
 * and unverified events can NEVER produce a feature. The deterministic usage
 * engine (not Reddit) decides any numerical consequence.
 */
export interface ContextFeatureFlags {
  playerUnavailable?: boolean; // confirmed scratch
  usagePitchCeiling?: number; // confirmed pitch limit (pitches)
  isOpener?: boolean; // confirmed opener
  returningFromIl?: boolean; // confirmed return_from_il → usage uncertainty
  /** Non-numeric warnings to surface (never a projection change on their own). */
  warnings: string[];
}

/** Severity map — deterministic, not LLM-assigned. */
export const EVENT_SEVERITY: Record<ContextEventType, ContextEventSeverity> = {
  scratch: "critical",
  injury: "high",
  pitch_limit: "high",
  role_change: "medium",
  velocity_change: "medium",
  command_issue: "medium",
  opener: "medium",
  bullpen_game: "medium",
  fatigue: "medium",
  return_from_il: "medium",
  lineup: "info",
  other: "info",
};
