/* ============================================================================
   Serve-point probability model — the heart of the structural simulator. Given a
   server's serve profile, the returner's return profile, the surface, and the
   Elo gap, it produces P(server wins a service point). The simulator then builds
   points → games → sets → match from this single quantity per (server, returner)
   pairing.

   The combination is a documented LOGIT-SPACE BLEND (no unexplained magic
   weights — every coefficient lives in config.servePoint):

     logit(p) = base · logit(baselineServe)
              + server · ( logit(serverServeStrength) − logit(baselineServe) )
              + returner · ( logit(baselineReturn) − logit(returnerReturnStrength) )
              + elo · ( eloDiff / eloScale )
              + contextAdjust

   Intuition:
     • serverServeStrength = server's service-points-won% (shrunk). Above baseline
       ⇒ raises p.
     • returnerReturnStrength = returner's return-points-won% (shrunk). A strong
       returner (above the baseline a server usually concedes) LOWERS p.
     • eloDiff = serverElo − returnerElo, a small global-strength nudge.
   The result is clamped to realistic tennis bounds [minP, maxP].
   ========================================================================== */

import { clamp } from "@/lib/utils";
import type { Surface } from "../domain";
import type { TennisModelConfig } from "./config";

export interface ServeProfile {
  /** Service-points-won probability (0..1), already shrunk toward prior. */
  servicePointsWonPct: number;
  /** Aces per service game (shrunk). */
  acesPerServiceGame: number;
  /** Double faults per service game (shrunk). */
  dfPerServiceGame: number;
}

export interface ReturnProfile {
  /** Return-points-won probability (0..1), shrunk. Baseline ≈ 1 − serve baseline. */
  returnPointsWonPct: number;
}

export interface ServePointInputs {
  server: ServeProfile;
  returner: ReturnProfile;
  surface: Surface;
  serverElo: number;
  returnerElo: number;
  /** Optional extra logit nudge (e.g. altitude, fatigue) — defaults to 0. */
  contextAdjust?: number;
  config: TennisModelConfig;
}

function logit(p: number): number {
  const c = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(c / (1 - c));
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** P(server wins a service point) — the documented logit blend above. */
export function servePointWinProb(inp: ServePointInputs): number {
  const w = inp.config.servePoint;
  const baselineServe = inp.config.surfaceServeBaseline[inp.surface];
  const baselineReturn = 1 - baselineServe;

  const serverStrength = inp.server.servicePointsWonPct;
  const returnerStrength = inp.returner.returnPointsWonPct;

  const lg =
    w.base * logit(baselineServe) +
    w.server * (logit(serverStrength) - logit(baselineServe)) +
    w.returner * (logit(baselineReturn) - logit(returnerStrength)) +
    w.elo * ((inp.serverElo - inp.returnerElo) / w.eloScale) +
    (inp.contextAdjust ?? 0);

  return clamp(sigmoid(lg), w.minP, w.maxP);
}

/**
 * Per-service-point ace and double-fault probabilities, tied to the player's
 * historical per-game rates (converted via points-per-service-game) and adjusted
 * for surface and the opponent's return strength. Because the simulator draws
 * these on every service point, ace/DF totals scale with match length — never
 * modeled independently of games played.
 */
export function aceDfProbabilities(inp: ServePointInputs): { aceProb: number; dfProb: number } {
  const c = inp.config.aceDf;
  const ppg = c.pointsPerServiceGame;

  const baseAce = inp.server.acesPerServiceGame / ppg;
  const surfaceMult = c.aceSurfaceMult[inp.surface];
  // A strong returner (return% above baseline) modestly suppresses aces.
  const baselineReturn = 1 - inp.config.surfaceServeBaseline[inp.surface];
  const returnDelta = inp.returner.returnPointsWonPct - baselineReturn;
  const returnMult = clamp(1 - c.aceOpponentReturnAdj * returnDelta, 0.6, 1.4);

  const aceProb = clamp(baseAce * surfaceMult * returnMult, 0, c.maxAceProb);
  const dfProb = clamp(inp.server.dfPerServiceGame / ppg, 0, c.maxDfProb);
  return { aceProb, dfProb };
}
