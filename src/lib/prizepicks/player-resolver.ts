/* ============================================================================
   Player + game resolution (server). Resolves an imported raw player name to a
   REAL MLB player id (reusing the existing MLB search), then connects it to the
   correct scheduled game for the board date. Never auto-picks between plausible
   players or between doubleheader games — those are surfaced for review.

   Read-only over the protected MLB data layer.
   ========================================================================== */

import { searchPlayers, getSchedule, getPlayer } from "@/lib/mlb/api";
import { mapGame } from "@/lib/providers/mlbStats";
import { normalizePlayerName, normalizePlayerNameLoose } from "./normalize";
import type { MarketCategory, PlayerCandidate, PrizePicksPlayerResolution } from "./types";

export interface ResolveInput {
  rawPlayerName: string;
  boardDate: string;
  teamAbbreviation?: string;
  categoryHint?: MarketCategory; // pitcher market requires a pitcher, etc.
  /** Canonical MLB id from an autocomplete pick — trusted over a name re-search. */
  mlbPlayerId?: number;
}

export interface GameResolution {
  status: "resolved" | "ambiguous" | "no-game";
  gamePk?: number;
  gameNumber?: number;
  opponentName?: string;
  gameStartTime?: string;
  reason: string;
}

async function candidatesFor(rawName: string): Promise<PlayerCandidate[]> {
  const people = await searchPlayers(rawName).catch(() => []);
  const target = normalizePlayerName(rawName);
  const targetLoose = normalizePlayerNameLoose(rawName);

  const scored = people
    .map((p) => {
      const norm = normalizePlayerName(p.fullName);
      const loose = normalizePlayerNameLoose(p.fullName);
      let match = 0;
      if (norm === target) match = 3;
      else if (loose === targetLoose) match = 2;
      else if (norm.includes(target) || target.includes(norm)) match = 1;
      return { p, match };
    })
    .filter((x) => x.match > 0)
    .sort((a, b) => b.match - a.match);

  // Keep only the best match tier so weaker partials don't create false ambiguity.
  const best = scored[0]?.match ?? 0;
  return scored
    .filter((x) => x.match === best)
    .map(({ p }) => ({
      mlbPlayerId: p.id,
      fullName: p.fullName,
      position: p.primaryPosition?.abbreviation ?? "",
      isPitcher: p.primaryPosition?.abbreviation === "P",
      teamId: p.currentTeam?.id,
      teamName: p.currentTeam?.name,
    }));
}

/** Fetch a single player by canonical id and connect their scheduled game. */
async function resolveByPlayerId(
  mlbPlayerId: number,
  boardDate: string,
): Promise<PrizePicksPlayerResolution | null> {
  const person = await getPlayer(mlbPlayerId).catch(() => null);
  if (!person) return null;
  const chosen: PlayerCandidate = {
    mlbPlayerId: person.id,
    fullName: person.fullName,
    position: person.primaryPosition?.abbreviation ?? "",
    isPitcher: person.primaryPosition?.abbreviation === "P",
    teamId: person.currentTeam?.id,
    teamName: person.currentTeam?.name,
  };
  const game = await resolveGame(chosen, boardDate);
  const withGame: PlayerCandidate = { ...chosen, gamePk: game.gamePk, opponentName: game.opponentName };
  return { status: "resolved", candidates: [withGame], chosen: withGame, reason: "canonical player id" };
}

/** Resolve the raw name to a player, applying role + team compatibility. */
export async function resolvePlayer(input: ResolveInput): Promise<PrizePicksPlayerResolution> {
  // A canonical id from the autocomplete is authoritative — trust it and only
  // resolve the game, never re-searching by (possibly ambiguous) name.
  if (input.mlbPlayerId) {
    const byId = await resolveByPlayerId(input.mlbPlayerId, input.boardDate);
    if (byId) return byId;
    // Fall through to name resolution if the id lookup failed (stale/unknown id).
  }

  let candidates = await candidatesFor(input.rawPlayerName);

  if (candidates.length === 0) {
    return { status: "not-found", candidates: [], reason: `no MLB player matched "${input.rawPlayerName}"` };
  }

  // Role compatibility: a pitcher market requires a pitcher; hitter market a non-pitcher.
  if (input.categoryHint) {
    const wantPitcher = input.categoryHint === "pitcher";
    const roleMatched = candidates.filter((c) => c.isPitcher === wantPitcher);
    if (roleMatched.length > 0 && roleMatched.length < candidates.length) {
      candidates = roleMatched;
    } else if (roleMatched.length === 0) {
      return {
        status: "conflicting",
        candidates,
        reason: `market is ${input.categoryHint} but matched player(s) have the opposite role`,
      };
    }
  }

  // Team hint as a tiebreaker (not a hard filter — handles trades).
  if (input.teamAbbreviation && candidates.length > 1) {
    const abbr = input.teamAbbreviation.toUpperCase();
    const byTeam = candidates.filter((c) => (c.teamName ?? "").toUpperCase().includes(abbr));
    if (byTeam.length === 1) candidates = byTeam;
  }

  if (candidates.length === 1) {
    const chosen = candidates[0];
    const game = await resolveGame(chosen, input.boardDate);
    const withGame: PlayerCandidate = {
      ...chosen,
      gamePk: game.gamePk,
      opponentName: game.opponentName,
    };
    return { status: "resolved", candidates: [withGame], chosen: withGame, reason: "single match" };
  }

  return { status: "ambiguous", candidates, reason: `${candidates.length} plausible players — needs review` };
}

/** Connect a resolved player to their scheduled game on the board date. */
export async function resolveGame(player: PlayerCandidate, boardDate: string): Promise<GameResolution> {
  if (!player.teamId) return { status: "no-game", reason: "player has no current team" };
  const games = (await getSchedule(boardDate).catch(() => [])).map(mapGame);
  const mine = games.filter((g) => g.home.teamId === player.teamId || g.away.teamId === player.teamId);

  if (mine.length === 0) return { status: "no-game", reason: `no game for ${player.teamName} on ${boardDate}` };
  if (mine.length > 1) {
    return {
      status: "ambiguous",
      reason: `doubleheader — ${mine.length} games for ${player.teamName}; pick the correct game`,
    };
  }
  const g = mine[0];
  const isHome = g.home.teamId === player.teamId;
  const opp = isHome ? g.away : g.home;
  return {
    status: "resolved",
    gamePk: g.gamePk,
    opponentName: opp.teamName,
    gameStartTime: g.date,
    reason: "single scheduled game",
  };
}
