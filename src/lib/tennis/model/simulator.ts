/* ============================================================================
   Structural tennis match simulator: service-point → point → game → tiebreak →
   set → match → prop outcomes. This is the model — totals, games, sets and
   tiebreaks are NEVER drawn from a single normal distribution; they emerge from
   simulating real tennis scoring.

   Determinism: uses the shared seeded RNG (mulberry32). Same seed ⇒ identical
   result. No hidden global RNG state — the rng is threaded explicitly.

   Aces / double faults are drawn per service point, so their totals scale with
   the number of service opportunities (i.e. match length), exactly as required.
   ========================================================================== */

import { mulberry32, seedFromString, mean, median as med, stdDev, quantile, type Rng } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import type { TennisScoringRules } from "./config";
import { SIMULATOR_VERSION } from "./version";

/** Per-service-point probabilities for one server, vs a specific returner. */
export interface ServeParams {
  /** P(win a service point). */
  pServe: number;
  /** P(ace) on a service point. */
  aceProb: number;
  /** P(double fault) on a service point. */
  dfProb: number;
}

export interface SimSides {
  /** A serving vs B returning. */
  a: ServeParams;
  /** B serving vs A returning. */
  b: ServeParams;
}

export interface MatchOutcome {
  winner: "a" | "b";
  setScores: { a: number; b: number; tiebreak: boolean }[];
  totalSets: number;
  totalGames: number;
  gamesWonA: number;
  gamesWonB: number;
  setsWonA: number;
  setsWonB: number;
  serviceGamesA: number;
  serviceGamesB: number;
  returnGamesA: number;
  returnGamesB: number;
  tiebreaksPlayed: number;
  tiebreaksWonA: number;
  tiebreaksWonB: number;
  servicePointsA: number;
  servicePointsB: number;
  returnPointsA: number;
  returnPointsB: number;
  acesA: number;
  acesB: number;
  doubleFaultsA: number;
  doubleFaultsB: number;
}

/** Result of one service point from the server's perspective. */
export interface PointResult { serverWon: boolean; ace: boolean; df: boolean; }

export function playPoint(p: ServeParams, rng: Rng): PointResult {
  const u = rng();
  if (u < p.dfProb) return { serverWon: false, ace: false, df: true };
  if (u < p.dfProb + p.aceProb) return { serverWon: true, ace: true, df: false };
  // Normal point: solve pNormal so overall serve-win prob === pServe.
  const denom = 1 - p.aceProb - p.dfProb;
  const pNormal = denom > 0 ? clamp((p.pServe - p.aceProb) / denom, 0, 1) : 0.5;
  return { serverWon: rng() < pNormal, ace: false, df: false };
}

export interface GameTally { serverWon: boolean; aces: number; dfs: number; points: number; }

/** Standard game to 4 points, win by 2 (deuce/advantage). Exported for testing. */
export function playGame(p: ServeParams, rng: Rng): GameTally {
  let s = 0, r = 0, aces = 0, dfs = 0, points = 0;
  // Safety cap on deuces (astronomically unlikely to hit).
  for (let i = 0; i < 1000; i++) {
    const pt = playPoint(p, rng);
    points++;
    if (pt.ace) aces++;
    if (pt.df) dfs++;
    if (pt.serverWon) s++; else r++;
    if ((s >= 4 || r >= 4) && Math.abs(s - r) >= 2) break;
  }
  return { serverWon: s > r, aces, dfs, points };
}

export interface TiebreakTally {
  winner: "a" | "b";
  acesA: number; acesB: number; dfsA: number; dfsB: number;
  servePointsA: number; servePointsB: number;
}

/**
 * Tiebreak with correct service rotation: the starter serves point 1, then
 * service alternates every 2 points. First to `target`, win by 2. Exported for testing.
 */
export function playTiebreak(sides: SimSides, starter: "a" | "b", target: number, rng: Rng): TiebreakTally {
  let a = 0, b = 0;
  const t: TiebreakTally = { winner: "a", acesA: 0, acesB: 0, dfsA: 0, dfsB: 0, servePointsA: 0, servePointsB: 0 };
  for (let i = 0; i < 5000; i++) {
    // Server for point i: starter serves point 0; then groups of 2 alternate.
    const grp = Math.floor((i + 1) / 2);
    const serverIsStarter = grp % 2 === 0;
    const server: "a" | "b" = serverIsStarter ? starter : other(starter);
    const params = server === "a" ? sides.a : sides.b;
    const pt = playPoint(params, rng);
    if (server === "a") { t.servePointsA++; if (pt.ace) t.acesA++; if (pt.df) t.dfsA++; }
    else { t.servePointsB++; if (pt.ace) t.acesB++; if (pt.df) t.dfsB++; }
    const serverWon = pt.serverWon;
    const winnerOfPoint: "a" | "b" = serverWon ? server : other(server);
    if (winnerOfPoint === "a") a++; else b++;
    if ((a >= target || b >= target) && Math.abs(a - b) >= 2) break;
  }
  t.winner = a > b ? "a" : "b";
  return t;
}

function other(s: "a" | "b"): "a" | "b" { return s === "a" ? "b" : "a"; }

export interface SetTally {
  winner: "a" | "b";
  gamesA: number; gamesB: number;
  tiebreak: boolean; tiebreakWinner?: "a" | "b";
  serviceGamesA: number; serviceGamesB: number;
  acesA: number; acesB: number; dfsA: number; dfsB: number;
  servePointsA: number; servePointsB: number;
  /** Who serves the first game of the NEXT set (continuous rotation). */
  nextServer: "a" | "b";
}

/**
 * Play a set. `firstServer` serves game 1; service alternates each game. If the
 * set reaches tiebreakAt-all and this set uses a tiebreak, a tiebreak decides it;
 * otherwise it is an advantage set (win by 2), with a safety cap.
 */
export function playSet(sides: SimSides, firstServer: "a" | "b", rules: TennisScoringRules, useTiebreak: boolean, tiebreakPoints: number, rng: Rng): SetTally {
  let gamesA = 0, gamesB = 0;
  let serviceGamesA = 0, serviceGamesB = 0;
  let acesA = 0, acesB = 0, dfsA = 0, dfsB = 0, spA = 0, spB = 0;
  let server = firstServer;
  const target = rules.gamesPerSet;

  for (let g = 0; g < 100; g++) {
    // Tiebreak trigger.
    if (useTiebreak && gamesA === rules.tiebreakAt && gamesB === rules.tiebreakAt) {
      const tb = playTiebreak(sides, server, tiebreakPoints, rng);
      acesA += tb.acesA; acesB += tb.acesB; dfsA += tb.dfsA; dfsB += tb.dfsB;
      spA += tb.servePointsA; spB += tb.servePointsB;
      if (tb.winner === "a") gamesA++; else gamesB++;
      // Tiebreak counts as a service "game" for rotation; next set server flips.
      return {
        winner: tb.winner, gamesA, gamesB, tiebreak: true, tiebreakWinner: tb.winner,
        serviceGamesA, serviceGamesB, acesA, acesB, dfsA, dfsB, servePointsA: spA, servePointsB: spB,
        nextServer: other(server),
      };
    }

    const params = server === "a" ? sides.a : sides.b;
    const gt = playGame(params, rng);
    if (server === "a") { serviceGamesA++; acesA += gt.aces; dfsA += gt.dfs; spA += gt.points; }
    else { serviceGamesB++; acesB += gt.aces; dfsB += gt.dfs; spB += gt.points; }

    const gameWinner: "a" | "b" = gt.serverWon ? server : other(server);
    if (gameWinner === "a") gamesA++; else gamesB++;

    server = other(server);

    const decided = (gamesA >= target || gamesB >= target) && Math.abs(gamesA - gamesB) >= 2;
    if (decided) break;
    if (!useTiebreak && g >= 98) break; // advantage-set safety cap
  }

  return {
    winner: gamesA > gamesB ? "a" : "b",
    gamesA, gamesB, tiebreak: false,
    serviceGamesA, serviceGamesB, acesA, acesB, dfsA, dfsB, servePointsA: spA, servePointsB: spB,
    nextServer: server,
  };
}

/** Simulate a single match. */
export function simulateMatch(sides: SimSides, rules: TennisScoringRules, rng: Rng): MatchOutcome {
  const setsNeeded = rules.bestOf === 5 ? 3 : 2;
  let setsWonA = 0, setsWonB = 0;
  const setScores: MatchOutcome["setScores"] = [];
  let totalGames = 0, gamesWonA = 0, gamesWonB = 0;
  let serviceGamesA = 0, serviceGamesB = 0;
  let tiebreaksPlayed = 0, tiebreaksWonA = 0, tiebreaksWonB = 0;
  let spA = 0, spB = 0, acesA = 0, acesB = 0, dfsA = 0, dfsB = 0;

  let firstServer: "a" | "b" = "a";
  for (let setIdx = 0; setIdx < rules.bestOf; setIdx++) {
    const isDecider = setsWonA === setsNeeded - 1 && setsWonB === setsNeeded - 1;
    const useTiebreak = isDecider ? rules.finalSetTiebreak : true;
    const tbPoints = isDecider ? rules.finalSetTiebreakPoints : rules.tiebreakPoints;

    const set = playSet(sides, firstServer, rules, useTiebreak, tbPoints, rng);
    setScores.push({ a: set.gamesA, b: set.gamesB, tiebreak: set.tiebreak });
    if (set.winner === "a") setsWonA++; else setsWonB++;
    gamesWonA += set.gamesA; gamesWonB += set.gamesB;
    totalGames += set.gamesA + set.gamesB;
    serviceGamesA += set.serviceGamesA; serviceGamesB += set.serviceGamesB;
    acesA += set.acesA; acesB += set.acesB; dfsA += set.dfsA; dfsB += set.dfsB;
    spA += set.servePointsA; spB += set.servePointsB;
    if (set.tiebreak) { tiebreaksPlayed++; if (set.tiebreakWinner === "a") tiebreaksWonA++; else tiebreaksWonB++; }
    firstServer = set.nextServer;

    if (setsWonA === setsNeeded || setsWonB === setsNeeded) break;
  }

  return {
    winner: setsWonA > setsWonB ? "a" : "b",
    setScores,
    totalSets: setsWonA + setsWonB,
    totalGames,
    gamesWonA, gamesWonB,
    setsWonA, setsWonB,
    serviceGamesA, serviceGamesB,
    returnGamesA: serviceGamesB, // A returns every game B serves
    returnGamesB: serviceGamesA,
    tiebreaksPlayed, tiebreaksWonA, tiebreaksWonB,
    servicePointsA: spA, servicePointsB: spB,
    returnPointsA: spB, returnPointsB: spA,
    acesA, acesB, doubleFaultsA: dfsA, doubleFaultsB: dfsB,
  };
}

// ---- Batch simulation + distributions -------------------------------------

export interface SimulationDistribution {
  mean: number;
  median: number;
  standardDeviation: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  minimum: number;
  maximum: number;
  sampleCount: number;
}

export function buildDistribution(samples: number[]): SimulationDistribution {
  if (samples.length === 0) {
    return { mean: 0, median: 0, standardDeviation: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, minimum: 0, maximum: 0, sampleCount: 0 };
  }
  return {
    mean: mean(samples),
    median: med(samples),
    standardDeviation: stdDev(samples),
    p10: quantile(samples, 0.1),
    p25: quantile(samples, 0.25),
    p50: quantile(samples, 0.5),
    p75: quantile(samples, 0.75),
    p90: quantile(samples, 0.9),
    minimum: Math.min(...samples),
    maximum: Math.max(...samples),
    sampleCount: samples.length,
  };
}

/** All per-iteration sample arrays a batch run produces, keyed for the markets. */
export interface BatchSamples {
  winnerA: number[]; // 1 if A won
  totalGames: number[];
  gamesWonA: number[];
  gamesWonB: number[];
  totalSets: number[];
  setsWonA: number[];
  setsWonB: number[];
  tiebreaksPlayed: number[];
  acesA: number[];
  acesB: number[];
  doubleFaultsA: number[];
  doubleFaultsB: number[];
  servicePointsA: number[];
  iterations: number;
  seed: string;
  simulatorVersion: string;
}

export interface BatchConfig {
  iterations?: number;
  seed?: string;
}

/** Run N deterministic simulations, collecting every market's samples. */
export function simulateMatches(sides: SimSides, rules: TennisScoringRules, cfg: BatchConfig = {}): BatchSamples {
  const iterations = cfg.iterations ?? 10000;
  const seed = cfg.seed ?? `${sides.a.pServe}:${sides.b.pServe}:${rules.bestOf}`;
  const rng = mulberry32(seedFromString(seed));

  const out: BatchSamples = {
    winnerA: [], totalGames: [], gamesWonA: [], gamesWonB: [], totalSets: [], setsWonA: [], setsWonB: [],
    tiebreaksPlayed: [], acesA: [], acesB: [], doubleFaultsA: [], doubleFaultsB: [], servicePointsA: [],
    iterations, seed, simulatorVersion: SIMULATOR_VERSION,
  };
  for (let i = 0; i < iterations; i++) {
    const m = simulateMatch(sides, rules, rng);
    out.winnerA.push(m.winner === "a" ? 1 : 0);
    out.totalGames.push(m.totalGames);
    out.gamesWonA.push(m.gamesWonA);
    out.gamesWonB.push(m.gamesWonB);
    out.totalSets.push(m.totalSets);
    out.setsWonA.push(m.setsWonA);
    out.setsWonB.push(m.setsWonB);
    out.tiebreaksPlayed.push(m.tiebreaksPlayed);
    out.acesA.push(m.acesA);
    out.acesB.push(m.acesB);
    out.doubleFaultsA.push(m.doubleFaultsA);
    out.doubleFaultsB.push(m.doubleFaultsB);
    out.servicePointsA.push(m.servicePointsA);
  }
  return out;
}
