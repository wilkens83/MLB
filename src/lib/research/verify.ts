/* ============================================================================
   Verification node. A Reddit candidate is checked against MORE AUTHORITATIVE,
   deterministic facts (Statcast, confirmed lineup, official confirmation) and its
   status is set to confirmed / reported / unverified / rejected. This is what
   keeps an unverified rumor from ever influencing anything numerical: only a
   `confirmed` event may later be converted into a deterministic model feature.
   ========================================================================== */

import type { ContextEvent, ContextEventStatus, SourceCredibility } from "./types";

/** Deterministic authoritative facts available at verification time. */
export interface VerificationContext {
  /** True when Statcast shows a real velocity decline vs the player's baseline. */
  veloDeclineDetected?: boolean;
  /** True when Statcast velocity is stable (no decline). */
  veloStable?: boolean;
  /** MLB has posted a confirmed lineup for this game. */
  lineupConfirmed?: boolean;
  /** The player appears in that confirmed lineup. */
  playerInConfirmedLineup?: boolean;
  /** An explicit official confirmation keyed by event type (transactions, team). */
  officialConfirmations?: Partial<Record<ContextEvent["type"], boolean>>;
}

const BASE_CONFIDENCE: Record<ContextEventStatus, number> = {
  rejected: 0.12,
  unverified: 0.4,
  reported: 0.7,
  confirmed: 0.95,
};

function credibilityNudge(level: SourceCredibility["level"]): number {
  return level === "high" ? 0.08 : level === "medium" ? 0.03 : -0.03;
}

export interface Verdict {
  status: ContextEventStatus;
  confidence: number;
  note: string;
}

/**
 * Verify a single candidate event against authoritative facts. Unknown/absent
 * facts leave the event `unverified` (never silently confirmed).
 */
export function verifyEvent(
  type: ContextEvent["type"],
  credibility: SourceCredibility,
  ctx: VerificationContext = {},
): Verdict {
  let status: ContextEventStatus = "unverified";
  let note = "No authoritative confirmation available.";

  // Official confirmation (transactions / team) wins for any type.
  if (ctx.officialConfirmations?.[type]) {
    status = "confirmed";
    note = "Confirmed by an official/authoritative source.";
  } else if (type === "velocity_change") {
    if (ctx.veloStable) { status = "rejected"; note = "Statcast velocity is stable — concern not supported."; }
    else if (ctx.veloDeclineDetected) { status = "reported"; note = "Statcast shows a velocity decline consistent with the report."; }
  } else if (type === "scratch") {
    if (ctx.playerInConfirmedLineup) { status = "rejected"; note = "Player appears in the confirmed lineup — scratch not supported."; }
    else if (ctx.lineupConfirmed) { status = "reported"; note = "Player absent from the confirmed lineup — consistent with a scratch."; }
  } else if (type === "lineup") {
    if (ctx.playerInConfirmedLineup) { status = "confirmed"; note = "Confirmed by the official lineup."; }
  }

  const confidence = clamp01(BASE_CONFIDENCE[status] + credibilityNudge(credibility.level));
  return { status, confidence: round2(confidence), note };
}

function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }
function round2(x: number): number { return Math.round(x * 100) / 100; }
