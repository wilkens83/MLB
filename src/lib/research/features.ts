/* ============================================================================
   Event → deterministic feature conversion. This is the ONLY sanctioned bridge
   from research to the model, and it consumes CONFIRMED events ONLY. Sentiment,
   trend, credibility, and unverified/reported/rejected events can NEVER produce a
   feature. Even the flags produced here do not themselves change a projection —
   the deterministic usage engine decides any numerical consequence. Pure + tested.
   ========================================================================== */

import type { ContextEvent, ContextFeatureFlags } from "./types";

const PITCH_CEILING_RE = /(\d{2,3})\s*[- ]?pitch|limited to (\d{2,3})|capped at (\d{2,3})|around (\d{2,3})\s*pitches/i;

/**
 * Convert CONFIRMED context events into deterministic feature flags. Unverified /
 * reported / rejected events are ignored entirely (they contribute nothing
 * numerical). Returns explicit, testable flags — never a probability delta.
 */
export function contextEventsToFeatures(events: ContextEvent[]): ContextFeatureFlags {
  const flags: ContextFeatureFlags = { warnings: [] };
  for (const e of events) {
    if (e.status !== "confirmed") continue; // ONLY confirmed events convert
    switch (e.type) {
      case "scratch":
        flags.playerUnavailable = true;
        flags.warnings.push("Confirmed scratch — player unavailable.");
        break;
      case "pitch_limit": {
        const m = PITCH_CEILING_RE.exec(e.summary) ?? PITCH_CEILING_RE.exec(e.sources.map((s) => s.url).join(" "));
        const n = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined;
        if (n && n >= 40 && n <= 130) flags.usagePitchCeiling = n;
        flags.warnings.push(`Confirmed pitch limit${n ? ` (~${n} pitches)` : ""}.`);
        break;
      }
      case "opener":
        flags.isOpener = true;
        flags.warnings.push("Confirmed opener / bullpen game.");
        break;
      case "return_from_il":
        flags.returningFromIl = true;
        flags.warnings.push("Confirmed return from IL — usage uncertainty.");
        break;
      default:
        // injury/velocity/command/etc. remain informational until an explicit
        // deterministic usage rule exists — no silent numerical effect.
        break;
    }
  }
  return flags;
}
