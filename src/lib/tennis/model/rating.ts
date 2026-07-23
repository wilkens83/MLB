/* ============================================================================
   Tennis Elo rating engine — self-contained, deterministic, temporally honest.

   - Maintains an OVERALL Elo plus a per-SURFACE Elo (hard/clay/grass/carpet).
   - Chronological replay: matches are processed in date order; a rating used to
     predict a match is always the rating that existed strictly BEFORE it — the
     engine never uses future results (enforced + tested).
   - Inactivity decay pulls idle players gently toward the mean.
   - Walkovers never update ratings; retirements are configurable.
   - No RNG anywhere: identical inputs ⇒ identical ratings.
   ========================================================================== */

import type { Surface, TennisMatch } from "../domain";
import { RATING_VERSION } from "./version";

export interface EloConfig {
  initialRating: number;
  kOverall: number;
  kSurface: number;
  /** Elo points per day pulled toward the mean during inactivity (0 = none). */
  decayPerDay: number;
  /** Mean toward which idle ratings decay. */
  meanRating: number;
  /** Cap on days of decay applied for a single gap. */
  maxDecayDays: number;
  /** How to treat matches decided by retirement. */
  retirementMode: "normal" | "half_k" | "skip";
}

export const DEFAULT_ELO_CONFIG: EloConfig = {
  initialRating: 1500,
  kOverall: 32,
  kSurface: 24,
  decayPerDay: 0.15,
  meanRating: 1500,
  maxDecayDays: 240,
  retirementMode: "half_k",
};

export interface TennisRatingSnapshot {
  playerId: string;
  date: string; // ISO — the match date AFTER which this rating holds
  overallElo: number;
  surfaceElo: number;
  surface: Surface;
  matchesRated: number;
  sourceVersion: string;
}

interface PlayerState {
  overall: number;
  surface: Record<Surface, number>;
  matches: number;
  surfaceMatches: Record<Surface, number>;
  lastDateMs: number;
  /** Timeline of overall Elo after each rated match (for temporal queries). */
  overallTimeline: { dateMs: number; rating: number; matches: number }[];
  surfaceTimeline: Record<Surface, { dateMs: number; rating: number; matches: number }[]>;
}

const SURFACES: Surface[] = ["hard", "clay", "grass", "carpet"];

export interface MatchWinContext {
  surface: Surface;
  /** Blend weight on surface Elo vs overall (0 = overall only, 1 = surface only). */
  surfaceWeight?: number;
}

export class TennisRatingEngine {
  private readonly cfg: EloConfig;
  private readonly players = new Map<string, PlayerState>();

  constructor(config: EloConfig = DEFAULT_ELO_CONFIG) {
    this.cfg = config;
  }

  private state(id: string): PlayerState {
    let s = this.players.get(id);
    if (!s) {
      s = {
        overall: this.cfg.initialRating,
        surface: { hard: this.cfg.initialRating, clay: this.cfg.initialRating, grass: this.cfg.initialRating, carpet: this.cfg.initialRating },
        matches: 0,
        surfaceMatches: { hard: 0, clay: 0, grass: 0, carpet: 0 },
        lastDateMs: 0,
        overallTimeline: [],
        surfaceTimeline: { hard: [], clay: [], grass: [], carpet: [] },
      };
      this.players.set(id, s);
    }
    return s;
  }

  /** Apply inactivity decay for a player up to `dateMs`, mutating state. */
  private applyDecay(s: PlayerState, dateMs: number) {
    if (s.lastDateMs === 0 || this.cfg.decayPerDay <= 0) return;
    const days = Math.min(this.cfg.maxDecayDays, Math.max(0, (dateMs - s.lastDateMs) / 86_400_000));
    if (days <= 0) return;
    const pull = this.cfg.decayPerDay * days;
    const toward = (r: number) => r + Math.sign(this.cfg.meanRating - r) * Math.min(Math.abs(this.cfg.meanRating - r), pull);
    s.overall = toward(s.overall);
    for (const surf of SURFACES) s.surface[surf] = toward(s.surface[surf]);
  }

  /**
   * Replay a batch of matches. Matches are sorted chronologically internally, so
   * callers cannot accidentally introduce temporal leakage by ordering.
   */
  replay(matches: TennisMatch[]) {
    const sorted = [...matches]
      .filter((m) => m.state === "completed" || m.state === "retired")
      .sort((a, b) => Date.parse(a.startTime ?? "") - Date.parse(b.startTime ?? ""));
    for (const m of sorted) this.processMatch(m);
  }

  private processMatch(m: TennisMatch) {
    if (m.state === "walkover") return; // never rate walkovers
    const dateMs = m.startTime ? Date.parse(m.startTime) : 0;
    const winnerId = m.home.isWinner ? m.home.playerId : m.away.isWinner ? m.away.playerId : null;
    if (!winnerId) return;
    const loserId = winnerId === m.home.playerId ? m.away.playerId : m.home.playerId;
    const surface = m.surface;

    const kMult = m.state === "retired" ? (this.cfg.retirementMode === "skip" ? 0 : this.cfg.retirementMode === "half_k" ? 0.5 : 1) : 1;
    if (kMult === 0) return;

    const w = this.state(winnerId);
    const l = this.state(loserId);
    this.applyDecay(w, dateMs);
    this.applyDecay(l, dateMs);

    // Overall update.
    const expW = expected(w.overall, l.overall);
    const dOverall = this.cfg.kOverall * kMult * (1 - expW);
    w.overall += dOverall;
    l.overall -= dOverall;

    // Surface update (independent ladder).
    const expWs = expected(w.surface[surface], l.surface[surface]);
    const dSurface = this.cfg.kSurface * kMult * (1 - expWs);
    w.surface[surface] += dSurface;
    l.surface[surface] -= dSurface;

    for (const [st, id] of [[w, winnerId], [l, loserId]] as const) {
      st.matches++;
      st.surfaceMatches[surface]++;
      st.lastDateMs = dateMs;
      st.overallTimeline.push({ dateMs, rating: st.overall, matches: st.matches });
      st.surfaceTimeline[surface].push({ dateMs, rating: st.surface[surface], matches: st.surfaceMatches[surface] });
      void id;
    }
  }

  /**
   * Rating for a player STRICTLY BEFORE `date` — the value that would have been
   * used to predict a match on that date. Returns initial rating if the player
   * has no earlier rated match (no future leakage possible).
   */
  getPlayerRatingBefore(playerId: string, date: string, surface?: Surface): { overallElo: number; surfaceElo: number; matchesRated: number } {
    const s = this.players.get(playerId);
    const surf = surface ?? "hard";
    if (!s) return { overallElo: this.cfg.initialRating, surfaceElo: this.cfg.initialRating, matchesRated: 0 };
    const cutoff = Date.parse(date);
    const overall = lastBefore(s.overallTimeline, cutoff);
    const surfEntry = lastBefore(s.surfaceTimeline[surf], cutoff);
    return {
      overallElo: overall ? overall.rating : this.cfg.initialRating,
      surfaceElo: surfEntry ? surfEntry.rating : this.cfg.initialRating,
      matchesRated: overall ? overall.matches : 0,
    };
  }

  /** Current (latest) snapshot for a player. */
  snapshot(playerId: string, surface: Surface, date: string): TennisRatingSnapshot {
    const s = this.state(playerId);
    return {
      playerId,
      date,
      overallElo: s.overall,
      surfaceElo: s.surface[surface],
      surface,
      matchesRated: s.matches,
      sourceVersion: RATING_VERSION,
    };
  }

  /**
   * P(playerA beats playerB). Blends overall + surface Elo by `surfaceWeight`.
   * Ratings must be passed in (typically from getPlayerRatingBefore) so callers
   * control the temporal cut.
   */
  getMatchWinProbability(
    a: { overallElo: number; surfaceElo: number },
    b: { overallElo: number; surfaceElo: number },
    ctx: MatchWinContext,
  ): number {
    const wS = ctx.surfaceWeight ?? 0.5;
    const aBlend = (1 - wS) * a.overallElo + wS * a.surfaceElo;
    const bBlend = (1 - wS) * b.overallElo + wS * b.surfaceElo;
    return expected(aBlend, bBlend);
  }

  /**
   * P(playerA wins a single set. A set is a "smaller" match, so its probability
   * is compressed toward 0.5 relative to the match-win probability. The
   * compression factor is documented and configurable via `dampen`.
   */
  getSetWinProbability(
    a: { overallElo: number; surfaceElo: number },
    b: { overallElo: number; surfaceElo: number },
    ctx: MatchWinContext,
    dampen = 0.62,
  ): number {
    const pMatch = this.getMatchWinProbability(a, b, ctx);
    const lg = Math.log(pMatch / (1 - pMatch));
    const compressed = lg * dampen;
    return 1 / (1 + Math.exp(-compressed));
  }
}

/** Standard Elo expected score. */
export function expected(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function lastBefore(timeline: { dateMs: number; rating: number; matches: number }[], cutoff: number) {
  let out: { dateMs: number; rating: number; matches: number } | null = null;
  for (const e of timeline) {
    if (e.dateMs < cutoff) out = e;
    else break;
  }
  return out;
}
