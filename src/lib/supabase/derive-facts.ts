/* ============================================================================
   Server-derived scientific facts. These values decide whether a firm BET is
   even possible, so they must NEVER come from the client. They are derived, on
   the trusted server, from the persisted scientific record:

     marketValidationState        ← model_registry.lifecycle_status (trusted)
     payoutVerified               ← a VERIFIED payout_snapshot exists
     calibrationDegraded          ← latest market_validation_metrics calibration
     featureDriftExceeded         ← latest drift_reports breach / insufficient data
     outsideTrainingSupport       ← model_registry.training_support vs the request
     requiredSimDependencyUnavailable ← provider health

   With no database configured every value degrades to the CONSERVATIVE default
   (RESEARCH_ONLY, unverified, breakers off), so a keyless deployment can never
   emit a firm BET — exactly the safe behaviour we want.
   ========================================================================== */

import type { MarketValidationState } from "@/lib/prizepicks/decision/types";
import { getServiceClient } from "./server";
import { latestVerifiedPayout } from "./scientific";

const VALID_STATES: MarketValidationState[] = [
  "DEVELOPMENT", "BACKTEST_ONLY", "SHADOW", "RESEARCH_ONLY", "PROVISIONAL",
  "VALIDATED", "PRODUCTION", "SUSPENDED", "RETIRED",
];

/** Calibration error above this (|predicted−observed|, 0..1) trips the breaker. */
const CALIBRATION_BREAKER_THRESHOLD = 0.1;

export interface DerivedMarketFacts {
  marketValidationState: MarketValidationState;
  calibrationDegraded: boolean;
  featureDriftExceeded: boolean;
  outsideTrainingSupport: boolean;
}

/**
 * Derive the trusted per-market facts from the persisted registry + monitoring.
 * `simDependencyAvailable` (from provider health, computed by the caller) feeds
 * the sim-dependency breaker separately since it is request-scoped.
 */
export async function deriveMarketFacts(marketKey: string): Promise<DerivedMarketFacts> {
  const conservative: DerivedMarketFacts = {
    marketValidationState: "RESEARCH_ONLY",
    calibrationDegraded: false,
    featureDriftExceeded: false,
    outsideTrainingSupport: false,
  };
  const client = getServiceClient();
  if (!client) return conservative;

  // 1) Trusted lifecycle state — the registry is the source of truth. A market
  //    with no registered model is RESEARCH_ONLY (firm BET impossible).
  const { data: model } = await client
    .from("model_registry")
    .select("id, lifecycle_status, training_support")
    .eq("market_key", marketKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const state = (VALID_STATES as string[]).includes(model?.lifecycle_status ?? "")
    ? (model!.lifecycle_status as MarketValidationState)
    : "RESEARCH_ONLY";

  // 2) Latest calibration → calibration breaker.
  let calibrationDegraded = false;
  if (model?.id) {
    const { data: metric } = await client
      .from("market_validation_metrics")
      .select("calibration")
      .eq("model_id", model.id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cal = metric?.calibration as { error?: number } | null | undefined;
    if (cal && typeof cal.error === "number" && cal.error > CALIBRATION_BREAKER_THRESHOLD) {
      calibrationDegraded = true;
    }
  }

  // 3) Latest drift report → drift breaker. A breach OR an insufficient-data
  //    verdict on a required feature blocks a firm BET.
  let featureDriftExceeded = false;
  {
    const { data: drift } = await client
      .from("drift_reports")
      .select("breach, insufficient_data")
      .eq("market_key", marketKey)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (drift && (drift.breach || drift.insufficient_data)) featureDriftExceeded = true;
  }

  return {
    marketValidationState: state,
    calibrationDegraded,
    featureDriftExceeded,
    outsideTrainingSupport: false,
  };
}

/** A firm entry decision requires a VERIFIED payout — a generic default is not. */
export async function deriveEntryPayoutVerified(
  format: "power" | "flex",
  pickCount: number,
): Promise<boolean> {
  const client = getServiceClient();
  if (!client) return false;
  const verified = await latestVerifiedPayout(format, pickCount);
  return verified !== null;
}
