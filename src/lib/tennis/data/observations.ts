/* ============================================================================
   Map canonical Tennis records onto the EXISTING scientific `raw_observations`
   contract (supabase/migrations/…scientific_persistence.sql) WITHOUT a schema
   change: sport is encoded in `entity_type` ("tennis_match" / "tennis_ranking")
   and the provider in `source`, so the append-only, point-in-time record
   represents Tennis alongside MLB with no MLB-only assumptions and no second
   raw-observation table.

   Point-in-time discipline (audit): a feature snapshot may consume an observation
   only when `available_at <= feature_cutoff`. `event_time` (when the match/ranking
   is/was effective in the world) is kept distinct from `available_at` (when the
   fact became KNOWABLE), so a future fixture never leaks into a pregame feature.

   Pure + dependency-free: runs under Bun and in the browser (no crypto import).
   ========================================================================== */

import type { RankingSnapshot, TennisMatch } from "../domain";
import type { ProviderProvenance } from "../providers/types";

/** Insert-shaped row for public.raw_observations (sport via entity_type). */
export interface RawObservationRow {
  source: string;
  observation_type: string;
  source_record_id: string | null;
  entity_type: string;
  entity_id: string;
  event_time: string | null;
  effective_at: string;
  available_at: string;
  captured_at: string;
  payload: unknown;
  payload_hash: string;
  schema_version: string;
  parser_version: string;
}

export const TENNIS_SCHEMA_VERSION = "tennis-1";
export const TENNIS_PARSER_VERSION = "tennis-adapters-1";

/** Stable, dependency-free string hash (djb2/xor) for payload dedup/versioning. */
export function stableHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A match observation. `available_at` = when we captured it (knowable); for a
 * scheduled fixture `effective_at` is also the capture time (the fixture fact is
 * published now) while `event_time` is the (possibly future) start — so the
 * constraint available_at >= effective_at holds and no future fixture leaks.
 */
export function matchToObservation(match: TennisMatch, prov: ProviderProvenance): RawObservationRow {
  const capturedIso = iso(prov.capturedAt);
  return {
    source: prov.provider,
    observation_type: match.state === "completed" || match.state === "retired" ? "tennis_result" : "tennis_schedule",
    source_record_id: prov.providerRecordId ?? match.externalIds[prov.provider] ?? null,
    entity_type: "tennis_match",
    entity_id: match.id,
    event_time: match.startTime ?? null,
    effective_at: prov.sourceTimestamp ?? capturedIso,
    available_at: capturedIso,
    captured_at: capturedIso,
    payload: match,
    payload_hash: stableHash(match),
    schema_version: TENNIS_SCHEMA_VERSION,
    parser_version: TENNIS_PARSER_VERSION,
  };
}

/** A ranking observation. Rankings become knowable when published (`asOf`). */
export function rankingToObservation(rank: RankingSnapshot, prov: ProviderProvenance): RawObservationRow {
  const availableIso = new Date(rank.asOf).toISOString();
  return {
    source: prov.provider,
    observation_type: "tennis_ranking",
    source_record_id: prov.providerRecordId ?? rank.playerId,
    entity_type: "tennis_ranking",
    entity_id: `${rank.tour}:${rank.playerId}:${rank.asOf}`,
    event_time: rank.asOf,
    effective_at: availableIso,
    available_at: availableIso,
    captured_at: iso(prov.capturedAt),
    payload: rank,
    payload_hash: stableHash(rank),
    schema_version: TENNIS_SCHEMA_VERSION,
    parser_version: TENNIS_PARSER_VERSION,
  };
}

/**
 * Point-in-time gate: may this observation feed a feature snapshot with the given
 * cutoff? True only when the fact was knowable at or before the cutoff — the
 * single rule that prevents leakage of future rankings / schedule updates.
 */
export function isUsableForCutoff(obs: RawObservationRow, featureCutoffIso: string): boolean {
  return Date.parse(obs.available_at) <= Date.parse(featureCutoffIso);
}
