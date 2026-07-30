/* ============================================================================
   MLB season resolver — the single source of truth for "which season is this?"

   The season is NOT hard-coded anywhere; it is derived from a date so the app
   rolls over automatically (July 2026 → 2026) and so a request for a historical
   date resolves to the season that date belonged to, never to "now".

   MLB calendar (approximate, and all we need for season *identity*):
     - Regular season: late March / early April → late September
     - Postseason:      October → early November (still the same season year)
     - Offseason:       November → February

   During the deep offseason (January & February) no games have been played in
   the new calendar year yet, so the most recent *completed / meaningful* season
   is the previous year. From March onward the current calendar year is the
   active season (spring training, then regular season). This keeps live stat
   requests pointed at a season that actually has data.
   ========================================================================== */

/** The first calendar month (1-based) that belongs to the new season. March. */
const SEASON_START_MONTH = 3;

/**
 * Resolve the MLB season year for a given moment.
 *
 * @param date  Any Date; defaults to now. For a historical timestamp this
 *              returns the season that timestamp belonged to, so past game-log
 *              or box-score requests never leak the current season.
 */
export function getMlbSeasonForDate(date: Date = new Date()): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1..12
  // Jan/Feb: the new season hasn't started; use the season that just finished.
  return month < SEASON_START_MONTH ? year - 1 : year;
}

/** The current MLB season (server "now"). Centralizes `new Date().getFullYear()`. */
export function getCurrentMlbSeason(now: Date = new Date()): number {
  return getMlbSeasonForDate(now);
}

/** Coarse phase of the MLB calendar for a date — used for freshness messaging. */
export type SeasonPhase = "offseason" | "spring" | "regular" | "postseason";

export function getSeasonPhase(date: Date = new Date()): SeasonPhase {
  const month = date.getUTCMonth() + 1;
  if (month <= 2) return "offseason";
  if (month === 3) return "spring";
  if (month >= 4 && month <= 9) return "regular";
  if (month === 10) return "postseason";
  // Nov/Dec: World Series has ended; back to offseason.
  return "offseason";
}
