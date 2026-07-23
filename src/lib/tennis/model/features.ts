/* ============================================================================
   TennisFeatureBuilder — turns a player's normalized match history into the
   serve/return/context features the rating + simulation engines consume.

   Design rules (from the spec):
   - Operates ONLY on normalized tennis domain objects.
   - Every feature returns { value, sampleSize, source, freshness, missingReason? }
     — missing data is NEVER collapsed to zero.
   - Supports multiple windows (L5/L10/L20/season/rolling-52w/same-surface/
     same-environment/same-tour-level/similar-opponent-strength).
   - Exposes BOTH raw observed metrics and Bayesian-shrunk model-ready metrics.
   - Recency weighting is available without destroying the raw windows.
   - No future data: only matches strictly before `asOf` are ever considered.
   ========================================================================== */

import { ewma } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import type {
  TennisMatch, MatchStatLine, Surface, Environment, TournamentLevel, DrawRound,
} from "../domain";
import type { TennisModelConfig } from "./config";
import { DEFAULT_TENNIS_CONFIG } from "./config";
import { FEATURE_VERSION } from "./version";

/** A single feature observation with full provenance. */
export interface FeatureValue {
  /** null when unavailable — callers must handle, never treat as 0. */
  value: number | null;
  /** Effective sample size behind the estimate (games/matches as noted). */
  sampleSize: number;
  /** Provenance: "observed" | "estimated:…" | "shrunk" | "context" | "elo". */
  source: string;
  /** Age in days of the most recent contributing match (0 if none / n/a). */
  freshness: number;
  missingReason?: string;
}

export type FeatureWindow =
  | "l5" | "l10" | "l20" | "season" | "r52"
  | "same_surface" | "same_environment" | "same_tour_level" | "similar_opponent";

/** Context describing the match being projected. */
export interface FeatureContext {
  asOf: string; // ISO datetime — the projection "now"; nothing at/after is used
  season: number;
  surface: Surface;
  environment: Environment;
  tourLevel?: TournamentLevel;
  round?: DrawRound;
  bestOf: 3 | 5;
  /** Opponent strength bucket (0 strongest … n) for the similar-opponent window. */
  opponentStrengthBucket?: number;
  /** Optional Elo inputs (populated by the rating engine when available). */
  overallElo?: number;
  surfaceElo?: number;
  opponentOverallElo?: number;
  opponentSurfaceElo?: number;
  /** Player's current ranking + prior ranking for the change feature. */
  ranking?: number;
  previousRanking?: number;
}

/** Per-match projection of the player's own side, pre-filtered and typed. */
interface PlayerMatchRow {
  match: TennisMatch;
  stat?: MatchStatLine;
  date: number; // epoch ms
  surface: Surface;
  environment: Environment;
  level?: TournamentLevel;
  season: number;
  won: boolean;
  retired: boolean;
  walkover: boolean;
  opponentRank?: number;
}

const DAY_MS = 86_400_000;

function bucketOfRank(rank?: number): number {
  if (rank === undefined) return 3;
  if (rank <= 10) return 0;
  if (rank <= 30) return 1;
  if (rank <= 70) return 2;
  return 3;
}

export class TennisFeatureBuilder {
  private readonly rows: PlayerMatchRow[];
  private readonly asOfMs: number;
  private readonly cfg: TennisModelConfig;

  constructor(
    private readonly playerId: string,
    matches: TennisMatch[],
    private readonly ctx: FeatureContext,
    config: TennisModelConfig = DEFAULT_TENNIS_CONFIG,
  ) {
    this.cfg = config;
    this.asOfMs = Date.parse(ctx.asOf);
    this.rows = matches
      .map((m) => this.toRow(m))
      .filter((r): r is PlayerMatchRow => r !== null)
      // NO FUTURE DATA: strictly before asOf.
      .filter((r) => r.date < this.asOfMs)
      .sort((a, b) => a.date - b.date); // oldest → newest
  }

  private toRow(m: TennisMatch): PlayerMatchRow | null {
    const isHome = m.home.playerId === this.playerId;
    const isAway = m.away.playerId === this.playerId;
    if (!isHome && !isAway) return null;
    const side = isHome ? m.home : m.away;
    const opp = isHome ? m.away : m.home;
    return {
      match: m,
      stat: m.stats.find((s) => s.playerId === this.playerId),
      date: m.startTime ? Date.parse(m.startTime) : 0,
      surface: m.surface,
      environment: m.environment,
      level: m.tournament?.level,
      season: m.season,
      won: side.isWinner === true,
      retired: m.state === "retired",
      walkover: m.state === "walkover",
      opponentRank: opp.rankAtMatch,
    };
  }

  /** Rows in a window, newest-first ordering preserved from the sorted base. */
  private window(w: FeatureWindow): PlayerMatchRow[] {
    const completed = this.rows.filter((r) => r.match.state === "completed" || r.match.state === "retired");
    const newestFirst = [...completed].reverse();
    switch (w) {
      case "l5": return newestFirst.slice(0, 5);
      case "l10": return newestFirst.slice(0, 10);
      case "l20": return newestFirst.slice(0, 20);
      case "season": return newestFirst.filter((r) => r.season === this.ctx.season);
      case "r52": return newestFirst.filter((r) => this.asOfMs - r.date <= 364 * DAY_MS);
      case "same_surface": return newestFirst.filter((r) => r.surface === this.ctx.surface);
      case "same_environment": return newestFirst.filter((r) => r.environment === this.ctx.environment);
      case "same_tour_level": return newestFirst.filter((r) => r.level !== undefined && r.level === this.ctx.tourLevel);
      case "similar_opponent":
        return newestFirst.filter((r) => bucketOfRank(r.opponentRank) === (this.ctx.opponentStrengthBucket ?? bucketOfRank(this.ctx.ranking)));
    }
  }

  private freshness(rows: PlayerMatchRow[]): number {
    let newest = 0;
    for (const r of rows) if (r.date > newest) newest = r.date;
    return newest ? Math.max(0, Math.round((this.asOfMs - newest) / DAY_MS)) : 0;
  }

  /** Ratio Σnum / Σden over rows where both fields are present. */
  private ratio(
    rows: PlayerMatchRow[],
    num: (s: MatchStatLine) => number | undefined,
    den: (s: MatchStatLine) => number | undefined,
    source = "observed",
    unit = "games",
  ): FeatureValue {
    let n = 0, d = 0, present = 0;
    for (const r of rows) {
      if (!r.stat) continue;
      const nv = num(r.stat), dv = den(r.stat);
      if (nv === undefined || dv === undefined) continue;
      n += nv; d += dv; present++;
    }
    if (present === 0 || d === 0) {
      return { value: null, sampleSize: 0, source, freshness: this.freshness(rows), missingReason: `no ${unit} data in window` };
    }
    return { value: n / d, sampleSize: d, source, freshness: this.freshness(rows) };
  }

  /** Mean of a per-match rate, weighted by a denominator (default: equal). */
  private weightedMean(
    rows: PlayerMatchRow[],
    val: (s: MatchStatLine) => number | undefined,
    weight: (s: MatchStatLine) => number | undefined = () => 1,
    source = "observed",
  ): FeatureValue {
    let acc = 0, wsum = 0, present = 0;
    for (const r of rows) {
      if (!r.stat) continue;
      const v = val(r.stat);
      if (v === undefined) continue;
      const w = weight(r.stat) ?? 1;
      acc += v * w; wsum += w; present++;
    }
    if (present === 0 || wsum === 0) {
      return { value: null, sampleSize: 0, source, freshness: this.freshness(rows), missingReason: "field absent in window" };
    }
    return { value: acc / wsum, sampleSize: present, source, freshness: this.freshness(rows) };
  }

  // ---- SERVE FEATURES ------------------------------------------------------

  serveFeatures(w: FeatureWindow): Record<string, FeatureValue> {
    const rows = this.window(w);
    const svcGames = (s: MatchStatLine) => s.serviceGamesPlayed;
    const pointsPerGame = this.cfg.aceDf.pointsPerServiceGame;

    const acesPerGame = this.ratio(rows, (s) => s.aces, svcGames, "observed", "service games");
    const dfPerGame = this.ratio(rows, (s) => s.doubleFaults, svcGames, "observed", "service games");
    const firstServePct = this.weightedMean(rows, (s) => s.firstServePct, svcGames);
    const firstServeWon = this.weightedMean(rows, (s) => s.firstServeWonPct, svcGames);
    const secondServeWon = this.weightedMean(rows, (s) => s.secondServeWonPct, svcGames);

    // Service points won% derived from first/second when both present.
    const spw = deriveServicePointsWon(firstServePct, firstServeWon, secondServeWon, this.freshness(rows));

    return {
      acesPerServiceGame: acesPerGame,
      // aces per service point: estimate service points from games (documented constant).
      acesPerServicePoint: perPointFrom(acesPerGame, pointsPerGame, "estimated:points_per_service_game"),
      doubleFaultsPerServiceGame: dfPerGame,
      // DF per second serve: second serves ≈ points × (1 − firstServe%).
      doubleFaultsPerSecondServe: dfPerSecondServe(dfPerGame, firstServePct, pointsPerGame),
      firstServePct,
      firstServePointsWonPct: firstServeWon,
      secondServePointsWonPct: secondServeWon,
      servicePointsWonPct: spw,
      holdPct: this.ratio(rows, (s) => s.serviceGamesWon, svcGames, "observed", "service games"),
      breakPointsFacedPerServiceGame: this.ratio(rows, (s) => s.breakPointsFaced, svcGames, "observed", "service games"),
      breakPointsSavedPct: this.ratio(rows, (s) => s.breakPointsSaved, (s) => s.breakPointsFaced, "observed", "break points"),
      avgServiceGamesPerMatch: avgPerMatch(rows, (s) => s.serviceGamesPlayed, this.freshness(rows)),
    };
  }

  // ---- RETURN FEATURES -----------------------------------------------------

  returnFeatures(w: FeatureWindow): Record<string, FeatureValue> {
    const rows = this.window(w);
    const retGames = (s: MatchStatLine) => s.returnGamesPlayed;
    const fresh = this.freshness(rows);

    // break% (return games won / return games) IS derivable and is our core proxy.
    const breakPct = this.ratio(rows, (s) => s.returnGamesWon, retGames, "observed", "return games");

    return {
      breakPct,
      // opponent hold suppression = how often the player breaks = breakPct.
      opponentHoldSuppression: { ...breakPct, source: breakPct.value === null ? breakPct.source : "observed" },
      avgReturnGamesPerMatch: avgPerMatch(rows, (s) => s.returnGamesPlayed, fresh),
      breakPointConversionPct: this.ratio(rows, (s) => s.breakPointsConverted, (s) => s.breakPointsConverted, "observed", "break points")
        .value === null
        ? unavailable("break-point conversion needs BP-created data", fresh)
        : this.ratio(rows, (s) => s.breakPointsConverted, (s) => s.breakPointsConverted, "observed", "break points"),
      // Point-level return metrics are not in the normalized stat line → honest missing.
      returnPointsWonPct: unavailable("return point-level data unavailable", fresh),
      firstServeReturnPointsWonPct: unavailable("return point-level data unavailable", fresh),
      secondServeReturnPointsWonPct: unavailable("return point-level data unavailable", fresh),
      breakPointsCreatedPerReturnGame: unavailable("break-points-created not in stat line", fresh),
    };
  }

  // ---- CONTEXT FEATURES ----------------------------------------------------

  contextFeatures(): Record<string, FeatureValue> {
    const all = this.rows.filter((r) => r.match.state !== "scheduled");
    const fresh = this.freshness(all);
    const daysRest = this.daysRest();
    const scalar = (v: number | null, source: string, reason?: string): FeatureValue =>
      ({ value: v, sampleSize: all.length, source, freshness: fresh, missingReason: reason });

    return {
      surface: scalar(surfaceCode(this.ctx.surface), "context"),
      indoor: scalar(this.ctx.environment === "indoor" ? 1 : this.ctx.environment === "outdoor" ? 0 : null, "context", this.ctx.environment === "unknown" ? "indoor/outdoor unavailable" : undefined),
      tourLevel: scalar(this.ctx.tourLevel ? levelCode(this.ctx.tourLevel) : null, "context", this.ctx.tourLevel ? undefined : "tour level unavailable"),
      bestOf: scalar(this.ctx.bestOf, "context"),
      daysRest: daysRest === null ? scalar(null, "context", "no prior match on record") : scalar(daysRest, "context"),
      matchesLast7: scalar(this.matchesWithin(7), "context"),
      matchesLast14: scalar(this.matchesWithin(14), "context"),
      minutesLast7: scalar(null, "context", "match duration not in normalized data"),
      ranking: scalar(this.ctx.ranking ?? null, "context", this.ctx.ranking === undefined ? "ranking unavailable" : undefined),
      rankingChange: scalar(
        this.ctx.ranking !== undefined && this.ctx.previousRanking !== undefined ? this.ctx.previousRanking - this.ctx.ranking : null,
        "context",
        this.ctx.previousRanking === undefined ? "no prior ranking" : undefined,
      ),
      overallElo: scalar(this.ctx.overallElo ?? null, "elo", this.ctx.overallElo === undefined ? "elo not supplied" : undefined),
      surfaceElo: scalar(this.ctx.surfaceElo ?? null, "elo", this.ctx.surfaceElo === undefined ? "surface elo not supplied" : undefined),
      opponentElo: scalar(this.ctx.opponentOverallElo ?? null, "elo", this.ctx.opponentOverallElo === undefined ? "opponent elo not supplied" : undefined),
      projectedCompetitiveness: scalar(this.competitiveness(), "elo", this.ctx.overallElo === undefined || this.ctx.opponentOverallElo === undefined ? "needs both Elo ratings" : undefined),
      retirementHistory: scalar(all.filter((r) => r.retired).length, "context"),
      recentWalkovers: scalar(this.rows.filter((r) => r.walkover && this.asOfMs - r.date <= 60 * DAY_MS).length, "context"),
      dataCompleteness: scalar(this.dataCompleteness(all), "context"),
    };
  }

  private daysRest(): number | null {
    const completed = this.rows.filter((r) => r.date > 0);
    if (completed.length === 0) return null;
    const last = completed[completed.length - 1].date;
    return Math.max(0, Math.round((this.asOfMs - last) / DAY_MS));
  }

  private matchesWithin(days: number): number {
    return this.rows.filter((r) => r.date > 0 && this.asOfMs - r.date <= days * DAY_MS).length;
  }

  private competitiveness(): number | null {
    const a = this.ctx.overallElo, b = this.ctx.opponentOverallElo;
    if (a === undefined || b === undefined) return null;
    // 1 when evenly matched, →0 as the gap widens.
    const pA = 1 / (1 + 10 ** ((b - a) / 400));
    return clamp(1 - 2 * Math.abs(pA - 0.5), 0, 1);
  }

  private dataCompleteness(rows: PlayerMatchRow[]): number {
    if (rows.length === 0) return 0;
    const required = ["aces", "doubleFaults", "firstServePct", "serviceGamesPlayed", "serviceGamesWon", "returnGamesPlayed", "returnGamesWon"];
    let present = 0, total = 0;
    for (const r of rows) {
      for (const f of required) {
        total++;
        if (r.stat && (r.stat as unknown as Record<string, unknown>)[f] !== undefined) present++;
      }
    }
    return total ? present / total : 0;
  }

  // ---- RECENCY + SHRINKAGE -------------------------------------------------

  /** Recency-weighted per-match value of a serve/return count rate. */
  recencyWeighted(
    w: FeatureWindow,
    val: (s: MatchStatLine) => number | undefined,
    den: (s: MatchStatLine) => number | undefined,
  ): FeatureValue {
    const rows = this.window(w).slice().reverse(); // oldest→newest for ewma
    const perMatch: number[] = [];
    for (const r of rows) {
      if (!r.stat) continue;
      const v = val(r.stat), d = den(r.stat);
      if (v === undefined || d === undefined || d === 0) continue;
      perMatch.push(v / d);
    }
    if (perMatch.length === 0) {
      return { value: null, sampleSize: 0, source: "recency", freshness: this.freshness(rows), missingReason: "no data in window" };
    }
    return { value: ewma(perMatch, this.cfg.recencyAlpha), sampleSize: perMatch.length, source: `recency:a${this.cfg.recencyAlpha}`, freshness: this.freshness(rows) };
  }

  /**
   * Bayesian shrinkage toward a prior: shrunk = (n·obs + k·prior)/(n+k). The
   * result is model-ready; the raw observed value stays available separately.
   */
  shrink(fv: FeatureValue, prior: number, k: number): FeatureValue {
    if (fv.value === null) {
      return { value: prior, sampleSize: fv.sampleSize, source: `shrunk:prior(${round3(prior)})`, freshness: fv.freshness, missingReason: `no data → prior ${round3(prior)}` };
    }
    const n = fv.sampleSize;
    const shrunk = (n * fv.value + k * prior) / (n + k);
    return { value: shrunk, sampleSize: n, source: `shrunk:k${k}`, freshness: fv.freshness };
  }

  /** Model-ready serve rates for the simulator (shrunk toward priors). */
  modelServeRates(w: FeatureWindow) {
    const serve = this.serveFeatures(w);
    const p = this.cfg.priors;
    const k = this.cfg.shrink;
    return {
      servicePointsWonPct: this.shrink(serve.servicePointsWonPct, p.servicePointsWon, k.serveK),
      holdPct: this.shrink(serve.holdPct, p.holdPct, k.serveK),
      acesPerServiceGame: this.shrink(serve.acesPerServiceGame, p.acesPerServiceGame, k.countK * 8),
      dfPerServiceGame: this.shrink(serve.doubleFaultsPerServiceGame, p.dfPerServiceGame, k.countK * 8),
      firstServePct: this.shrink(serve.firstServePct, p.firstServePct, k.serveK),
    };
  }

  modelReturnRates(w: FeatureWindow) {
    const ret = this.returnFeatures(w);
    const p = this.cfg.priors;
    const k = this.cfg.shrink;
    return {
      breakPct: this.shrink(ret.breakPct, p.breakPct, k.returnK),
      // Return-points-won proxy from break rate isn't reliable; expose prior-backed value flagged.
      returnPointsWonPct: this.shrink(ret.returnPointsWonPct, p.returnPointsWon, k.returnK),
    };
  }

  /** Stable id for the exact feature inputs behind a projection. */
  snapshotId(w: FeatureWindow): string {
    const serve = this.modelServeRates(w);
    const ret = this.modelReturnRates(w);
    const key = JSON.stringify({
      p: this.playerId, w, v: FEATURE_VERSION,
      s: round3(serve.servicePointsWonPct.value), h: round3(serve.holdPct.value),
      a: round3(serve.acesPerServiceGame.value), d: round3(serve.dfPerServiceGame.value),
      b: round3(ret.breakPct.value), n: this.rows.length,
    });
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    return `fs_${(hash >>> 0).toString(16)}`;
  }

  matchCount(): number {
    return this.rows.filter((r) => r.match.state === "completed" || r.match.state === "retired").length;
  }

  surfaceMatchCount(): number {
    return this.window("same_surface").length;
  }
}

// ---- module-private helpers -----------------------------------------------

function unavailable(reason: string, freshness: number): FeatureValue {
  return { value: null, sampleSize: 0, source: "observed", freshness, missingReason: reason };
}

function perPointFrom(perGame: FeatureValue, pointsPerGame: number, source: string): FeatureValue {
  if (perGame.value === null) return { ...perGame, source, missingReason: perGame.missingReason };
  return { value: perGame.value / pointsPerGame, sampleSize: perGame.sampleSize, source, freshness: perGame.freshness };
}

function dfPerSecondServe(dfPerGame: FeatureValue, firstServePct: FeatureValue, pointsPerGame: number): FeatureValue {
  if (dfPerGame.value === null || firstServePct.value === null) {
    return { value: null, sampleSize: 0, source: "estimated:second_serves", freshness: dfPerGame.freshness, missingReason: "needs DF + first-serve%" };
  }
  const secondServesPerGame = pointsPerGame * (1 - firstServePct.value);
  if (secondServesPerGame <= 0) return { value: null, sampleSize: 0, source: "estimated:second_serves", freshness: dfPerGame.freshness, missingReason: "no second serves" };
  return { value: dfPerGame.value / secondServesPerGame, sampleSize: dfPerGame.sampleSize, source: "estimated:second_serves", freshness: dfPerGame.freshness };
}

function deriveServicePointsWon(
  firstPct: FeatureValue, firstWon: FeatureValue, secondWon: FeatureValue, freshness: number,
): FeatureValue {
  if (firstPct.value === null || firstWon.value === null || secondWon.value === null) {
    return { value: null, sampleSize: 0, source: "derived:serve_split", freshness, missingReason: "needs first%, first-won%, second-won%" };
  }
  const v = firstPct.value * firstWon.value + (1 - firstPct.value) * secondWon.value;
  return { value: v, sampleSize: Math.min(firstWon.sampleSize, secondWon.sampleSize), source: "derived:serve_split", freshness };
}

function avgPerMatch(rows: PlayerMatchRow[], field: (s: MatchStatLine) => number | undefined, freshness: number): FeatureValue {
  let sum = 0, present = 0;
  for (const r of rows) {
    if (!r.stat) continue;
    const v = field(r.stat);
    if (v === undefined) continue;
    sum += v; present++;
  }
  if (present === 0) return { value: null, sampleSize: 0, source: "observed", freshness, missingReason: "field absent" };
  return { value: sum / present, sampleSize: present, source: "observed", freshness };
}

function surfaceCode(s: Surface): number {
  return { hard: 0, clay: 1, grass: 2, carpet: 3 }[s];
}
function levelCode(l: TournamentLevel): number {
  const order: TournamentLevel[] = ["grand_slam", "atp_1000", "wta_1000", "atp_500", "wta_500", "atp_250", "wta_250", "challenger", "itf", "other"];
  const i = order.indexOf(l);
  return i < 0 ? order.length : i;
}
function round3(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}
