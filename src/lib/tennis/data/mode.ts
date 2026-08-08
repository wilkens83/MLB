/* ============================================================================
   Tennis data-mode model. The UI must always show the ACTIVE mode and must never
   display LIVE unless a credentialed provider was actually verified live.
   ========================================================================== */

export type TennisDataMode = "LIVE" | "FREE_CURRENT" | "HISTORICAL" | "FIXTURE" | "MANUAL";

export interface DataModeAvailability {
  live: boolean; // a credentialed provider is verified (status "ready")
  freeCurrent: boolean; // a permitted no-cost CURRENT source is active
  historical: boolean; // free historical dataset loaded
  manual: boolean; // manual current-match entry available
  fixture: boolean; // deterministic demo fixtures available
}

export interface DataModeSummary {
  modes: TennisDataMode[];
  /** Short label for the header, e.g. "HISTORICAL + MANUAL" or "LIVE". */
  label: string;
  /** True only when a live credentialed provider was verified. */
  liveVerified: boolean;
  availability: DataModeAvailability;
}

const ORDER: TennisDataMode[] = ["LIVE", "FREE_CURRENT", "HISTORICAL", "MANUAL", "FIXTURE"];

export function describeDataMode(a: DataModeAvailability): DataModeSummary {
  const modes: TennisDataMode[] = [];
  if (a.live) modes.push("LIVE");
  if (a.freeCurrent) modes.push("FREE_CURRENT");
  if (a.historical) modes.push("HISTORICAL");
  if (a.manual) modes.push("MANUAL");
  if (a.fixture) modes.push("FIXTURE");
  modes.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));

  // Never present as LIVE unless genuinely verified live.
  const label = a.live
    ? "LIVE"
    : modes.filter((m) => m !== "FIXTURE").length > 0
      ? modes.filter((m) => m !== "FIXTURE").join(" + ")
      : modes.length > 0 ? "DEMO DATA" : "NO DATA";

  return { modes, label, liveVerified: a.live, availability: a };
}
