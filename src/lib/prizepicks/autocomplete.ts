/* ============================================================================
   Pure, offline-testable helpers for the PrizePicks manual-entry Player
   autocomplete. No React and no network live here, so the role-preference
   sort, market→role hint, keyboard navigation, and canonical-selection shape
   can be unit-tested deterministically (the component is a thin shell over
   these). Reuses the existing MLB player search — never a static player list.
   ========================================================================== */

import type { MarketCategory } from "./types";

/** A player row as returned by /api/players/search (mirrors the route shape). */
export interface AutocompletePlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  teamId?: number;
  bats?: string;
  throws?: string;
  isPitcher: boolean;
}

/** Role preference sent to the search endpoint (MLB roles: pitcher vs batter). */
export type SearchRole = "pitcher" | "batter";

/** The canonical identity captured when a user picks a result. Stored additively
 *  on the manual row so a later resolve step never re-resolves incorrectly. */
export interface SelectedPlayer {
  playerId: number;
  playerName: string;
  teamId?: number;
  teamName?: string;
  position?: string;
}

/**
 * Map a prop-market category to the role the search should PREFER. This only
 * biases ordering — it never filters — so a two-way / mislabeled player stays
 * selectable for either market.
 */
export function marketRoleHint(category: MarketCategory | undefined): SearchRole | undefined {
  if (category === "pitcher") return "pitcher";
  if (category === "hitter") return "batter";
  return undefined;
}

/**
 * Stable-sort matching-role players first. NEVER removes a result — requirement:
 * "do not silently remove valid ambiguous cases unless the market category makes
 * the role impossible" (here the market never makes a role impossible, so all
 * matches are retained and only re-ordered).
 */
export function sortByRolePreference<T extends { isPitcher: boolean }>(
  players: T[],
  role: SearchRole | undefined,
): T[] {
  if (!role) return players;
  const wantPitcher = role === "pitcher";
  return players
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        Number(b.p.isPitcher === wantPitcher) - Number(a.p.isPitcher === wantPitcher) || a.i - b.i,
    )
    .map((x) => x.p);
}

/** Active-index reducer for keyboard navigation of the dropdown. */
export function nextActiveIndex(key: string, active: number, count: number): number {
  if (count <= 0) return 0;
  switch (key) {
    case "ArrowDown":
      return Math.min(active + 1, count - 1);
    case "ArrowUp":
      return Math.max(active - 1, 0);
    default:
      return active;
  }
}

/** Build the canonical selection payload from a chosen search row. */
export function toSelectedPlayer(p: AutocompletePlayer): SelectedPlayer {
  return {
    playerId: p.id,
    playerName: p.name,
    teamId: p.teamId,
    teamName: p.team || undefined,
    position: p.position || undefined,
  };
}
