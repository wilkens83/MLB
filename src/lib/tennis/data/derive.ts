/* ============================================================================
   Derivation layer — turns normalized `TennisMatch` history into per-market
   numeric series (`TennisMatchSample[]`), the tennis analogue of MLB's
   `extractPropSeries`. These series feed the SHARED analytics engine
   (`analyzeStat` in @/lib/analytics/hitRate) and projection unchanged, which is
   the whole point of the multi-sport core: tennis produces `number[]`, the pure
   engine does the rest.

   Availability rule: a market whose underlying stat is absent for a match yields
   NO sample for that match (the series is shorter), never a fabricated 0.
   ========================================================================== */

import type { TennisMatch, TennisMatchSample, TennisMarketKey } from "../domain";

/** The player's own side of a match, or undefined if they didn't play it. */
function sideFor(match: TennisMatch, playerId: string): "home" | "away" | undefined {
  if (match.home.playerId === playerId) return "home";
  if (match.away.playerId === playerId) return "away";
  return undefined;
}

function statLineFor(match: TennisMatch, playerId: string) {
  return match.stats.find((s) => s.playerId === playerId);
}

/** Games won by a given side across all completed sets. */
function gamesWon(match: TennisMatch, side: "home" | "away"): number {
  return match.sets.reduce((sum, s) => sum + (side === "home" ? s.homeGames : s.awayGames), 0);
}

/** Total games in a match (both sides). */
export function totalGames(match: TennisMatch): number {
  return match.sets.reduce((sum, s) => sum + s.homeGames + s.awayGames, 0);
}

/** Whether any set reached a tiebreak (either tiebreak field populated). */
export function hadTiebreak(match: TennisMatch): boolean {
  return match.sets.some((s) => s.homeTiebreak !== undefined || s.awayTiebreak !== undefined);
}

/**
 * Extract a player's per-match series for a market. Only completed matches with
 * the required underlying stat contribute a sample.
 */
export function derivePlayerSeries(
  matches: TennisMatch[],
  playerId: string,
  market: TennisMarketKey,
): TennisMatchSample[] {
  const out: TennisMatchSample[] = [];
  // oldest → newest for recency weighting downstream
  const ordered = [...matches].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  for (const m of ordered) {
    if (m.state !== "completed") continue;
    const side = sideFor(m, playerId);
    if (!side) continue;
    const opp = side === "home" ? m.away : m.home;
    const line = statLineFor(m, playerId);

    let value: number | undefined;
    const stat: Record<string, number> = {};

    switch (market) {
      case "aces":
        if (line?.aces !== undefined) { value = line.aces; stat.aces = line.aces; }
        break;
      case "double_faults":
        if (line?.doubleFaults !== undefined) { value = line.doubleFaults; stat.doubleFaults = line.doubleFaults; }
        break;
      case "player_games_won":
        value = gamesWon(m, side); stat.gamesWon = value; break;
      case "total_games":
        value = totalGames(m); stat.totalGames = value; break;
      case "total_sets":
        value = m.sets.length; stat.sets = value; break;
      case "match_winner":
        value = (side === "home" ? m.home.isWinner : m.away.isWinner) ? 1 : 0; stat.won = value; break;
      case "tiebreak_in_match":
        value = hadTiebreak(m) ? 1 : 0; stat.tiebreak = value; break;
      default:
        // set_winner / set_handicap / exact_score are structural-sim only —
        // they have no direct per-match scalar and yield no historical series.
        value = undefined;
    }

    if (value === undefined) continue;
    out.push({
      matchId: m.id,
      date: m.startTime,
      opponentId: opp.playerId,
      opponentName: opp.playerName,
      surface: m.surface,
      value,
      stat,
    });
  }
  return out;
}

/** Plain numeric series (oldest→newest) for the shared engine. */
export function seriesValues(samples: TennisMatchSample[]): number[] {
  return samples.map((s) => s.value);
}

/**
 * Estimate a player's serve/return point-win rates from match history for the
 * structural simulator (Phase 6). Uses service/return games won as a proxy when
 * point-level data is unavailable. Returns undefined fields rather than guessing
 * when nothing is available.
 */
export function estimateServeReturn(
  matches: TennisMatch[],
  playerId: string,
): { servePointWinProb?: number; returnPointWinProb?: number; sampleSize: number } {
  let svcWon = 0, svcPlayed = 0, retWon = 0, retPlayed = 0, n = 0;
  for (const m of matches) {
    if (m.state !== "completed") continue;
    const line = statLineFor(m, playerId);
    if (!line) continue;
    if (line.serviceGamesWon !== undefined && line.serviceGamesPlayed) {
      svcWon += line.serviceGamesWon; svcPlayed += line.serviceGamesPlayed; n++;
    }
    if (line.returnGamesWon !== undefined && line.returnGamesPlayed) {
      retWon += line.returnGamesWon; retPlayed += line.returnGamesPlayed;
    }
  }
  return {
    // Hold% and break% are game-level proxies for point dominance; the structural
    // sim converts these to point-win probabilities via the hold↔point identity.
    servePointWinProb: svcPlayed > 0 ? gamesToPointProb(svcWon / svcPlayed) : undefined,
    returnPointWinProb: retPlayed > 0 ? gamesToPointProb(retWon / retPlayed) : undefined,
    sampleSize: n,
  };
}

/**
 * Invert the serve-hold probability to an approximate per-point serve-win prob.
 * A standard result: P(hold) is a monotone function of p (point-win-on-serve).
 * We invert numerically over p∈[0.5,0.85] (the realistic band) via bisection.
 */
export function gamesToPointProb(holdRate: number): number {
  const target = Math.min(0.995, Math.max(0.005, holdRate));
  let lo = 0.30, hi = 0.95;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (holdProbFromPoint(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Closed-form probability of holding serve given per-point serve-win prob p. */
export function holdProbFromPoint(p: number): number {
  const q = 1 - p;
  // Probability server wins a game to love/15/30, plus deuce branch.
  // Win from 40-0,40-15,40-30 and deuce. Standard formula.
  const pWin40_0 = p ** 4;
  const pWin40_15 = 4 * p ** 4 * q;
  const pWin40_30 = 10 * p ** 4 * q ** 2;
  const pDeuce = 20 * p ** 3 * q ** 3;
  const pWinDeuce = (p * p) / (p * p + q * q); // win from deuce
  return pWin40_0 + pWin40_15 + pWin40_30 + pDeuce * pWinDeuce;
}
