import { describe, it, expect } from "bun:test";
import type { Rng } from "@/lib/math/stats";
import type { TennisMatch, MatchStatLine, Surface } from "../domain";
import {
  TennisFeatureBuilder, TennisRatingEngine, servePointWinProb,
  playGame, playTiebreak, playSet, simulateMatch, simulateMatches, buildDistribution,
  projectMarket, projectMarkets, assess, computeFairLine, probMore, probLessPush,
  DEFAULT_TENNIS_CONFIG, DEFAULT_SCORING, buildModelVersion, configChecksum,
  type SimSides, type ServeParams, type FeatureContext, type MatchProjectionContext,
} from "./index";

// ============================ test fixtures ================================

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Points for a set from a per-game hold/break pattern (love games, 4 pts each). */
function scriptFromHolds(holds: ("hold" | "break")[]): number[] {
  const vals: number[] = [];
  for (const h of holds) for (let p = 0; p < 4; p++) { vals.push(0.99); vals.push(h === "hold" ? 0.1 : 0.9); }
  return vals;
}

function mkStat(playerId: string, s: Partial<MatchStatLine>): MatchStatLine {
  const available = Object.keys(s).filter((k) => k !== "playerId" && (s as Record<string, unknown>)[k] !== undefined);
  return { playerId, availableMetrics: available, ...s };
}

interface MkMatch {
  id: string; date: string; surface?: Surface; season?: number;
  homeId: string; awayId: string; homeWon?: boolean;
  state?: TennisMatch["state"]; format?: "best_of_3" | "best_of_5";
  homeStat?: Partial<MatchStatLine>; awayStat?: Partial<MatchStatLine>;
  awayRank?: number; sets?: TennisMatch["sets"];
}
function mkMatch(o: MkMatch): TennisMatch {
  const homeWon = o.homeWon ?? true;
  const stats: MatchStatLine[] = [];
  if (o.homeStat) stats.push(mkStat(o.homeId, o.homeStat));
  if (o.awayStat) stats.push(mkStat(o.awayId, o.awayStat));
  return {
    id: o.id, tournamentId: "t", season: o.season ?? 2025, surface: o.surface ?? "hard",
    environment: "outdoor", format: o.format ?? "best_of_3", round: "r32",
    state: o.state ?? "completed", startTime: `${o.date}T12:00:00Z`,
    home: { playerId: o.homeId, playerName: o.homeId, side: "home", isWinner: homeWon },
    away: { playerId: o.awayId, playerName: o.awayId, side: "away", isWinner: !homeWon, rankAtMatch: o.awayRank },
    sets: o.sets ?? [{ homeGames: 6, awayGames: 3 }, { homeGames: 6, awayGames: 4 }],
    stats, externalIds: {}, sources: ["test"],
  };
}

/** N matches for `playerId` (as home) with a per-index stat generator. */
function historyFor(playerId: string, n: number, gen: (i: number) => { date: string; surface?: Surface; stat: Partial<MatchStatLine>; won?: boolean }): TennisMatch[] {
  return Array.from({ length: n }, (_, i) => {
    const g = gen(i);
    return mkMatch({ id: `${playerId}-m${i}`, date: g.date, surface: g.surface, homeId: playerId, awayId: `opp${i}`, homeWon: g.won ?? true, homeStat: g.stat });
  });
}

const baseCtx = (over: Partial<FeatureContext> = {}): FeatureContext => ({
  asOf: "2025-07-01", season: 2025, surface: "hard", environment: "outdoor", bestOf: 3, ...over,
});

// ============================ Phase 6: features ============================

describe("TennisFeatureBuilder — windows", () => {
  const matches = historyFor("P", 25, (i) => ({
    date: `2025-${String(1 + (i % 6)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`,
    surface: i % 2 === 0 ? "hard" : "clay",
    stat: { aces: 8 + i, doubleFaults: 2, serviceGamesPlayed: 10, serviceGamesWon: 8, returnGamesPlayed: 10, returnGamesWon: 3, firstServePct: 0.6, firstServeWonPct: 0.72, secondServeWonPct: 0.5 },
  }));

  it("L5/L10/L20 return the right sample sizes", () => {
    const fb = new TennisFeatureBuilder("P", matches, baseCtx({ asOf: "2026-01-01" }));
    expect(fb.serveFeatures("l5").acesPerServiceGame.sampleSize).toBe(50); // 5 matches × 10 svc games
    expect(fb.serveFeatures("l10").acesPerServiceGame.sampleSize).toBe(100);
    expect(fb.serveFeatures("l20").acesPerServiceGame.sampleSize).toBe(200);
  });

  it("same-surface window filters by surface", () => {
    const fb = new TennisFeatureBuilder("P", matches, baseCtx({ asOf: "2026-01-01", surface: "hard" }));
    const hardGames = fb.serveFeatures("same_surface").avgServiceGamesPerMatch.sampleSize;
    expect(hardGames).toBe(13); // even indices 0..24 → 13 hard matches
  });

  it("missing data yields null value + reason, never 0", () => {
    const noStats = [mkMatch({ id: "x", date: "2025-05-01", homeId: "P", awayId: "o" })]; // no homeStat
    const fb = new TennisFeatureBuilder("P", noStats, baseCtx());
    const f = fb.serveFeatures("l5").acesPerServiceGame;
    expect(f.value).toBeNull();
    expect(f.missingReason).toBeDefined();
  });

  it("no future data — matches at/after asOf are excluded", () => {
    const ms = [
      mkMatch({ id: "a", date: "2025-01-10", homeId: "P", awayId: "o", homeStat: { aces: 5, serviceGamesPlayed: 10 } }),
      mkMatch({ id: "b", date: "2025-02-10", homeId: "P", awayId: "o", homeStat: { aces: 5, serviceGamesPlayed: 10 } }),
      mkMatch({ id: "c", date: "2025-06-10", homeId: "P", awayId: "o", homeStat: { aces: 5, serviceGamesPlayed: 10 } }),
    ];
    const fb = new TennisFeatureBuilder("P", ms, baseCtx({ asOf: "2025-03-01" }));
    expect(fb.matchCount()).toBe(2); // Jan + Feb only
  });

  it("exposes raw AND shrunk metrics; shrink pulls toward prior", () => {
    const hot = historyFor("H", 3, () => ({ date: "2025-06-01", stat: { aces: 20, serviceGamesPlayed: 10 } }));
    const fb = new TennisFeatureBuilder("H", hot, baseCtx());
    const raw = fb.serveFeatures("l5").acesPerServiceGame.value!;
    const shrunk = fb.modelServeRates("l5").acesPerServiceGame.value!;
    expect(raw).toBeCloseTo(2.0, 1);
    expect(shrunk).toBeLessThan(raw);
    expect(shrunk).toBeGreaterThan(DEFAULT_TENNIS_CONFIG.priors.acesPerServiceGame);
  });
});

// ============================ Phase 7: Elo ================================

describe("TennisRatingEngine", () => {
  const winA = (date: string, surface: Surface = "hard") =>
    mkMatch({ id: `w-${date}`, date, surface, homeId: "A", awayId: "B", homeWon: true });

  it("winner gains and loser loses rating", () => {
    const e = new TennisRatingEngine();
    e.replay([winA("2025-01-01")]);
    const a = e.getPlayerRatingBefore("A", "2025-02-01");
    const b = e.getPlayerRatingBefore("B", "2025-02-01");
    expect(a.overallElo).toBeGreaterThan(1500);
    expect(b.overallElo).toBeLessThan(1500);
    expect(a.overallElo - 1500).toBeCloseTo(1500 - b.overallElo, 6); // symmetric
  });

  it("surface Elo updates only the played surface", () => {
    const e = new TennisRatingEngine();
    e.replay([winA("2025-01-01", "clay")]);
    const aClay = e.getPlayerRatingBefore("A", "2025-02-01", "clay");
    const aGrass = e.getPlayerRatingBefore("A", "2025-02-01", "grass");
    expect(aClay.surfaceElo).toBeGreaterThan(1500);
    expect(aGrass.surfaceElo).toBe(1500);
  });

  it("never updates ratings for a walkover", () => {
    const e = new TennisRatingEngine();
    e.replay([mkMatch({ id: "wo", date: "2025-01-01", homeId: "A", awayId: "B", homeWon: true, state: "walkover" })]);
    expect(e.getPlayerRatingBefore("A", "2025-02-01").overallElo).toBe(1500);
  });

  it("is deterministic (same input ⇒ same ratings)", () => {
    const ms = [winA("2025-01-01"), winA("2025-02-01"), mkMatch({ id: "z", date: "2025-03-01", homeId: "B", awayId: "A", homeWon: true })];
    const e1 = new TennisRatingEngine(); e1.replay(ms);
    const e2 = new TennisRatingEngine(); e2.replay([...ms].reverse()); // sorted internally
    expect(e1.getPlayerRatingBefore("A", "2025-12-01").overallElo).toBeCloseTo(e2.getPlayerRatingBefore("A", "2025-12-01").overallElo, 9);
  });

  it("no temporal leakage — rating before a date ignores that date's match", () => {
    const e = new TennisRatingEngine();
    e.replay([winA("2025-01-01"), winA("2025-06-01")]);
    // Before the first match everyone is at the initial rating.
    expect(e.getPlayerRatingBefore("A", "2025-01-01").overallElo).toBe(1500);
    // Before the June match, A reflects only the January result.
    const before = new TennisRatingEngine();
    before.replay([winA("2025-01-01")]);
    expect(e.getPlayerRatingBefore("A", "2025-06-01").overallElo).toBeCloseTo(before.getPlayerRatingBefore("A", "2025-05-01").overallElo, 9);
  });

  it("match & set win probabilities behave sensibly", () => {
    const e = new TennisRatingEngine();
    const strong = { overallElo: 1800, surfaceElo: 1800 };
    const weak = { overallElo: 1500, surfaceElo: 1500 };
    const pMatch = e.getMatchWinProbability(strong, weak, { surface: "hard" });
    const pSet = e.getSetWinProbability(strong, weak, { surface: "hard" });
    expect(pMatch).toBeGreaterThan(0.8);
    // A set is a smaller sample → probability compressed toward 0.5.
    expect(pSet).toBeLessThan(pMatch);
    expect(pSet).toBeGreaterThan(0.5);
  });
});

// ============================ Phase 8: scoring ============================

const P = (pServe: number, aceProb = 0, dfProb = 0): ServeParams => ({ pServe, aceProb, dfProb });

describe("game scoring", () => {
  it("love hold — server wins 4 straight", () => {
    const g = playGame(P(0.5), scriptedRng([0.99, 0.1]));
    expect(g.serverWon).toBe(true);
    expect(g.points).toBe(4);
  });
  it("break of serve — returner wins 4 straight", () => {
    const g = playGame(P(0.5), scriptedRng([0.99, 0.9]));
    expect(g.serverWon).toBe(false);
    expect(g.points).toBe(4);
  });
  it("deuce then hold", () => {
    // W W L L (deuce) W W → server holds in 6 points
    const seq = ["W", "W", "L", "L", "W", "W"].flatMap((w) => [0.99, w === "W" ? 0.1 : 0.9]);
    const g = playGame(P(0.5), scriptedRng(seq));
    expect(g.serverWon).toBe(true);
    expect(g.points).toBe(6);
  });
  it("repeated advantages", () => {
    const seq = ["W", "W", "L", "L", "W", "L", "W", "L", "W", "W"].flatMap((w) => [0.99, w === "W" ? 0.1 : 0.9]);
    const g = playGame(P(0.5), scriptedRng(seq));
    expect(g.serverWon).toBe(true);
    expect(g.points).toBe(10);
  });
});

describe("tiebreak scoring", () => {
  it("correct service rotation, win by 2", () => {
    // A always aces on serve; B always double-faults → A wins every point.
    const sides: SimSides = { a: P(1, 1, 0), b: P(0, 0, 1) };
    const tb = playTiebreak(sides, "a", 7, scriptedRng([0.5]));
    expect(tb.winner).toBe("a");
    // Rotation over 7 points: A serves 0,3,4 (3); B serves 1,2,5,6 (4).
    expect(tb.servePointsA).toBe(3);
    expect(tb.servePointsB).toBe(4);
    expect(tb.acesA).toBe(3);
    expect(tb.dfsB).toBe(4);
  });
  it("win-by-2 forces a longer tiebreak", () => {
    const sides: SimSides = { a: P(1), b: P(1) }; // both always hold serve
    const tb = playTiebreak(sides, "a", 7, scriptedRng([0.5]));
    expect(Math.abs((tb.servePointsA + tb.servePointsB))).toBeGreaterThanOrEqual(7);
  });
});

describe("set scoring", () => {
  const rules = DEFAULT_SCORING;
  const evenSides: SimSides = { a: P(0.5), b: P(0.5) };
  it("6-0 (dominant server breaks every game)", () => {
    const set = playSet({ a: P(1), b: P(0) }, "a", rules, true, 7, scriptedRng([0.5]));
    expect(set.gamesA).toBe(6);
    expect(set.gamesB).toBe(0);
    expect(set.tiebreak).toBe(false);
  });
  it("6-4 from a scripted scoreline", () => {
    const holds = ["hold", "hold", "hold", "hold", "hold", "hold", "hold", "hold", "hold", "break"] as const;
    const set = playSet(evenSides, "a", rules, true, 7, scriptedRng(scriptFromHolds([...holds])));
    expect([set.gamesA, set.gamesB]).toEqual([6, 4]);
  });
  it("7-5 from a scripted scoreline", () => {
    const holds = Array(11).fill("hold").concat(["break"]) as ("hold" | "break")[];
    const set = playSet(evenSides, "a", rules, true, 7, scriptedRng(scriptFromHolds(holds)));
    expect([set.gamesA, set.gamesB]).toEqual([7, 5]);
  });
  it("7-6 triggers a tiebreak", () => {
    const set = playSet({ a: P(1), b: P(1) }, "a", rules, true, 7, scriptedRng([0.5]));
    expect(set.tiebreak).toBe(true);
    expect(set.gamesA + set.gamesB).toBe(13);
  });
  it("advantage set (no final tiebreak) can exceed 6-6", () => {
    const holds = Array(12).fill("hold").concat(["hold", "break"]) as ("hold" | "break")[]; // → 8-6
    const set = playSet(evenSides, "a", rules, false, 7, scriptedRng(scriptFromHolds(holds)));
    expect(set.tiebreak).toBe(false);
    expect([set.gamesA, set.gamesB]).toEqual([8, 6]);
  });
});

describe("match scoring", () => {
  it("2-0 in a mismatch (best-of-3)", () => {
    const m = simulateMatch({ a: P(1), b: P(0) }, DEFAULT_SCORING, scriptedRng([0.5]));
    expect(m.winner).toBe("a");
    expect(m.setsWonA).toBe(2);
    expect(m.setsWonB).toBe(0);
    expect(m.totalSets).toBe(2);
  });
  it("3-0 in a best-of-5 mismatch", () => {
    const m = simulateMatch({ a: P(1), b: P(0) }, { ...DEFAULT_SCORING, bestOf: 5 }, scriptedRng([0.5]));
    expect(m.setsWonA).toBe(3);
    expect(m.totalSets).toBe(3);
  });
  it("even matchups produce some 3-set matches", () => {
    const batch = simulateMatches({ a: P(0.62), b: P(0.62) }, DEFAULT_SCORING, { seed: "even", iterations: 500 });
    expect(batch.totalSets.some((s) => s === 3)).toBe(true);
    expect(batch.totalSets.every((s) => s === 2 || s === 3)).toBe(true);
  });
});

// ======================= Phase 8: simulation invariants ===================

describe("simulation invariants", () => {
  it("is deterministic for a given seed", () => {
    const s: SimSides = { a: P(0.66, 0.08, 0.03), b: P(0.6, 0.05, 0.04) };
    const a = simulateMatches(s, DEFAULT_SCORING, { seed: "abc", iterations: 300 });
    const b = simulateMatches(s, DEFAULT_SCORING, { seed: "abc", iterations: 300 });
    expect(a.winnerA).toEqual(b.winnerA);
    expect(a.totalGames).toEqual(b.totalGames);
    expect(a.acesA).toEqual(b.acesA);
  });

  it("More/Less/Push partition to 1", () => {
    const batch = simulateMatches({ a: P(0.65, 0.1), b: P(0.6, 0.05) }, DEFAULT_SCORING, { seed: "p", iterations: 1000 });
    const line = 6;
    const more = probMore(batch.acesA, line);
    const { less, push } = probLessPush(batch.acesA, line);
    expect(more + less + push).toBeCloseTo(1, 9);
  });

  it("serve-point probability stays within realistic bounds", () => {
    const cfg = DEFAULT_TENNIS_CONFIG;
    const extremeServer = servePointWinProb({
      server: { servicePointsWonPct: 0.99, acesPerServiceGame: 3, dfPerServiceGame: 0.1 },
      returner: { returnPointsWonPct: 0.05 }, surface: "grass", serverElo: 2200, returnerElo: 1200, config: cfg,
    });
    expect(extremeServer).toBeLessThanOrEqual(cfg.servePoint.maxP);
    expect(extremeServer).toBeGreaterThanOrEqual(cfg.servePoint.minP);
  });

  it("best-of-5 produces more service opportunities than best-of-3", () => {
    const s: SimSides = { a: P(0.63, 0.06, 0.04), b: P(0.63, 0.06, 0.04) };
    const bo3 = simulateMatches(s, DEFAULT_SCORING, { seed: "len", iterations: 600 });
    const bo5 = simulateMatches(s, { ...DEFAULT_SCORING, bestOf: 5 }, { seed: "len", iterations: 600 });
    expect(mean(bo5.servicePointsA)).toBeGreaterThan(mean(bo3.servicePointsA));
  });

  it("higher ace rate increases the ace distribution", () => {
    const lo = simulateMatches({ a: P(0.64, 0.04, 0.03), b: P(0.62) }, DEFAULT_SCORING, { seed: "ace", iterations: 800 });
    const hi = simulateMatches({ a: P(0.64, 0.18, 0.03), b: P(0.62) }, DEFAULT_SCORING, { seed: "ace", iterations: 800 });
    expect(mean(hi.acesA)).toBeGreaterThan(mean(lo.acesA));
  });

  it("higher hold rates increase tiebreak frequency", () => {
    const moderate = simulateMatches({ a: P(0.6), b: P(0.6) }, DEFAULT_SCORING, { seed: "tb", iterations: 1500 });
    const bigServers = simulateMatches({ a: P(0.78), b: P(0.78) }, DEFAULT_SCORING, { seed: "tb", iterations: 1500 });
    expect(mean(bigServers.tiebreaksPlayed)).toBeGreaterThan(mean(moderate.tiebreaksPlayed));
  });

  it("stronger server wins more matches, and the gap widens monotonically", () => {
    const close = simulateMatches({ a: P(0.64), b: P(0.62) }, DEFAULT_SCORING, { seed: "w", iterations: 1500 });
    const wide = simulateMatches({ a: P(0.72), b: P(0.56) }, DEFAULT_SCORING, { seed: "w", iterations: 1500 });
    expect(mean(close.winnerA)).toBeGreaterThan(0.5);
    expect(mean(wide.winnerA)).toBeGreaterThan(mean(close.winnerA));
  });

  it("distribution quantiles are ordered", () => {
    const d = buildDistribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(d.p10).toBeLessThanOrEqual(d.p50);
    expect(d.p50).toBeLessThanOrEqual(d.p90);
    expect(d.minimum).toBe(1);
    expect(d.maximum).toBe(10);
  });
});

// ======================= Phase 9: markets + fair line =====================

describe("market projections", () => {
  const player = { id: "SERVER", matches: historyFor("SERVER", 20, (i) => ({ date: `2025-0${1 + (i % 5)}-10`, stat: { aces: 12, doubleFaults: 2, serviceGamesPlayed: 11, serviceGamesWon: 10, returnGamesPlayed: 11, returnGamesWon: 2, firstServePct: 0.64, firstServeWonPct: 0.78, secondServeWonPct: 0.55 } })) };
  const opp = { id: "OPP", matches: historyFor("OPP", 20, (i) => ({ date: `2025-0${1 + (i % 5)}-11`, stat: { aces: 4, doubleFaults: 3, serviceGamesPlayed: 11, serviceGamesWon: 8, returnGamesPlayed: 11, returnGamesWon: 3, firstServePct: 0.6, firstServeWonPct: 0.7, secondServeWonPct: 0.5 } })) };
  const ctx: MatchProjectionContext = { asOf: "2025-06-15", season: 2025, surface: "hard", environment: "outdoor", bestOf: 3 };

  it("projects aces from simulated service opportunities", () => {
    const { projection } = projectMarket({ player, opponent: opp, matchContext: ctx, line: 8.5, market: "aces", seed: "acesmk", iterations: 2000 });
    expect(projection.projectedMean).toBeGreaterThan(0);
    expect(projection.probabilityMore + projection.probabilityLess + projection.probabilityPush).toBeCloseTo(1, 6);
    expect(projection.quantiles.sampleCount).toBe(2000);
  });

  it("batch API projects many markets from one simulation", () => {
    const { projections } = projectMarkets({
      player, opponent: opp, matchContext: ctx,
      markets: ["aces", "total_games", "games_won", "total_sets", "tie_breaks"],
      lines: { aces: 8.5, total_games: 21.5 }, seed: "batch", iterations: 1500,
    });
    expect(Object.keys(projections)).toHaveLength(5);
    expect(projections.total_games.projectedMean).toBeGreaterThan(12);
    expect(projections.total_sets.projectedMean).toBeGreaterThanOrEqual(2);
  });

  it("push handling on an integer line", () => {
    const samples = [4, 5, 5, 5, 6, 7];
    const { push } = probLessPush(samples, 5);
    expect(push).toBeCloseTo(3 / 6, 9);
  });

  it("fair-line sensitivity is monotone decreasing in the line", () => {
    const samples = [6, 7, 7, 8, 8, 9, 9, 10, 11, 12];
    const fl = computeFairLine(samples, 8, 8.5, 8.7);
    expect(fl.probabilityAtMinusHalf).toBeGreaterThanOrEqual(fl.probabilityAtLine);
    expect(fl.probabilityAtLine).toBeGreaterThanOrEqual(fl.probabilityAtPlusHalf);
    expect(fl.nearestActionableLine % 1).toBeCloseTo(0.5, 9);
  });

  it("total games comes from the structural simulation (not a normal draw)", () => {
    const { projection } = projectMarket({ player, opponent: opp, matchContext: ctx, line: 20.5, market: "total_games", seed: "tg", iterations: 1500 });
    // Discrete integer games only.
    expect(projection.quantiles.minimum % 1).toBe(0);
    expect(projection.quantiles.maximum % 1).toBe(0);
  });
});

// ======================= Phase 10: assessment =============================

describe("assessment — probability vs confidence vs data quality", () => {
  const richPlayer = { id: "RICH", matches: historyFor("RICH", 30, (i) => ({ date: `2025-0${1 + (i % 5)}-1${i % 9}`, stat: { aces: 14, doubleFaults: 2, serviceGamesPlayed: 11, serviceGamesWon: 10, returnGamesPlayed: 11, returnGamesWon: 2, firstServePct: 0.65, firstServeWonPct: 0.8, secondServeWonPct: 0.55 } })) };
  const opp = { id: "OPP2", matches: historyFor("OPP2", 20, (i) => ({ date: `2025-0${1 + (i % 5)}-12`, stat: { aces: 4, doubleFaults: 4, serviceGamesPlayed: 11, serviceGamesWon: 7, returnGamesPlayed: 11, returnGamesWon: 4 } })) };
  const ctx: MatchProjectionContext = { asOf: "2025-06-20", season: 2025, surface: "hard", environment: "outdoor", bestOf: 3 };

  it("high probability on THIN data never becomes STRONG", () => {
    const thin = { id: "THIN", matches: historyFor("THIN", 2, () => ({ date: "2025-06-01", stat: { aces: 25, serviceGamesPlayed: 10, serviceGamesWon: 10, returnGamesPlayed: 10, returnGamesWon: 0 } })) };
    const { projection, model } = projectMarket({ player: thin, opponent: opp, matchContext: ctx, line: 2.5, market: "aces", seed: "thin", iterations: 1500 });
    const a = assess(projection, model);
    expect(a.recommendation).toBe("AVOID_LOW_DATA");
    expect(a.recommendation).not.toBe("STRONG_MORE");
  });

  it("separates confidence and data-quality as distinct scores", () => {
    const { projection, model } = projectMarket({ player: richPlayer, opponent: opp, matchContext: ctx, line: 8.5, market: "aces", seed: "rich", iterations: 2000 });
    const a = assess(projection, model);
    expect(a.confidenceScore).toBeGreaterThan(0);
    expect(a.dataQualityScore).toBeGreaterThan(0);
    expect(a.confidenceScore).not.toBe(a.dataQualityScore);
    expect(a.reasons.length).toBeGreaterThan(0);
    expect(a.modelVersion.configChecksum).toBe(configChecksum(DEFAULT_TENNIS_CONFIG));
  });

  it("rich history yields higher confidence than thin history", () => {
    const thin = { id: "THIN2", matches: historyFor("THIN2", 4, () => ({ date: "2025-06-01", stat: { aces: 12, serviceGamesPlayed: 10, serviceGamesWon: 8, returnGamesPlayed: 10, returnGamesWon: 2, firstServePct: 0.62, firstServeWonPct: 0.75, secondServeWonPct: 0.5 } })) };
    const rich = projectMarket({ player: richPlayer, opponent: opp, matchContext: ctx, line: 8.5, market: "aces", seed: "c1", iterations: 1200 });
    const thinP = projectMarket({ player: thin, opponent: opp, matchContext: ctx, line: 8.5, market: "aces", seed: "c2", iterations: 1200 });
    expect(assess(rich.projection, rich.model).confidenceScore).toBeGreaterThan(assess(thinP.projection, thinP.model).confidenceScore);
  });

  it("reasons reference real feature values (ace market)", () => {
    const { projection, model } = projectMarket({ player: richPlayer, opponent: opp, matchContext: ctx, line: 8.5, market: "aces", seed: "r", iterations: 1000 });
    const a = assess(projection, model);
    expect(a.reasons.some((r) => r.factor === "surface_ace_rate")).toBe(true);
    expect(a.reasons.some((r) => r.factor === "opponent_return")).toBe(true);
  });
});

// ======================= sanity scenarios A–E =============================

describe("sanity scenarios", () => {
  const R = DEFAULT_SCORING;
  const N = 2500;

  it("A — elite server vs weak returner: elevated aces + holds", () => {
    const a = simulateMatches({ a: P(0.75, 0.16, 0.03), b: P(0.58, 0.05, 0.05) }, R, { seed: "A", iterations: N });
    expect(mean(a.acesA)).toBeGreaterThan(mean(a.acesB));
    expect(mean(a.winnerA)).toBeGreaterThan(0.6);
  });

  it("B — elite returner vs weak server: fewer aces, lower win rate", () => {
    const strongServer = simulateMatches({ a: P(0.75, 0.16), b: P(0.58) }, R, { seed: "B0", iterations: N });
    const weakServer = simulateMatches({ a: P(0.55, 0.05), b: P(0.72) }, R, { seed: "B1", iterations: N });
    expect(mean(weakServer.acesA)).toBeLessThan(mean(strongServer.acesA));
    expect(mean(weakServer.winnerA)).toBeLessThan(0.5);
  });

  it("C vs D — two big servers give more games/tiebreaks than a mismatch", () => {
    const C = simulateMatches({ a: P(0.74), b: P(0.74) }, R, { seed: "C", iterations: N });
    const D = simulateMatches({ a: P(0.80), b: P(0.50) }, R, { seed: "D", iterations: N });
    expect(mean(C.totalGames)).toBeGreaterThan(mean(D.totalGames));
    expect(mean(C.tiebreaksPlayed)).toBeGreaterThan(mean(D.tiebreaksPlayed));
    expect(mean(D.winnerA)).toBeGreaterThan(0.9);       // huge favorite
    expect(mean(D.totalSets)).toBeLessThan(mean(C.totalSets)); // mismatch ends sooner
  });

  it("E — same player projects different aces on hard vs clay", () => {
    const matches = [
      ...historyFor("E", 15, (i) => ({ date: `2025-0${1 + (i % 4)}-0${1 + (i % 8)}`, surface: "hard" as Surface, stat: { aces: 14, doubleFaults: 2, serviceGamesPlayed: 11, serviceGamesWon: 9, returnGamesPlayed: 11, returnGamesWon: 3, firstServePct: 0.64, firstServeWonPct: 0.78, secondServeWonPct: 0.55 } })),
      ...historyFor("Ec", 15, (i) => ({ date: `2025-0${1 + (i % 4)}-1${i % 8}`, surface: "clay" as Surface, stat: { aces: 3, doubleFaults: 2, serviceGamesPlayed: 11, serviceGamesWon: 9, returnGamesPlayed: 11, returnGamesWon: 3, firstServePct: 0.62, firstServeWonPct: 0.72, secondServeWonPct: 0.52 } })).map((m) => ({ ...m, home: { ...m.home, playerId: "E" }, id: m.id.replace("Ec", "E-clay") })),
    ];
    const opp = { id: "Eopp", matches: [] as TennisMatch[] };
    const player = { id: "E", matches };
    const hard = projectMarket({ player, opponent: opp, matchContext: { asOf: "2025-06-01", season: 2025, surface: "hard", environment: "outdoor", bestOf: 3, window: "same_surface" }, line: 8.5, market: "aces", seed: "Eh", iterations: 1500 });
    const clay = projectMarket({ player, opponent: opp, matchContext: { asOf: "2025-06-01", season: 2025, surface: "clay", environment: "outdoor", bestOf: 3, window: "same_surface" }, line: 8.5, market: "aces", seed: "Ec", iterations: 1500 });
    expect(hard.projection.projectedMean).toBeGreaterThan(clay.projection.projectedMean);
  });
});

// ======================= provenance =======================================

describe("model version provenance", () => {
  it("config checksum changes when config changes", () => {
    const v1 = buildModelVersion(DEFAULT_TENNIS_CONFIG);
    const tweaked = { ...DEFAULT_TENNIS_CONFIG, thresholds: { ...DEFAULT_TENNIS_CONFIG.thresholds, strongEdge: 0.5 } };
    const v2 = buildModelVersion(tweaked);
    expect(v1.configChecksum).not.toBe(v2.configChecksum);
    expect(v1.simulator).toBe(v2.simulator);
  });
});

// helper
function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
