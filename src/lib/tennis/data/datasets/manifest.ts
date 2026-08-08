/* ============================================================================
   Free-dataset provenance + versioning. Every imported free dataset records a
   reproducible identity so the UI can show exactly what is loaded and under what
   terms — the licensing restriction is surfaced, never concealed.
   ========================================================================== */

import { stableHash } from "../observations";
import type { TennisTour } from "../../domain";
import {
  SEED_ATP_MATCHES_CSV, SEED_WTA_MATCHES_CSV, SEED_ATP_PLAYERS_CSV, SEED_WTA_PLAYERS_CSV,
  SEED_ATP_RANKINGS_CSV, SEED_WTA_RANKINGS_CSV,
} from "./seed";

export type LicenseUse = "research/non-commercial" | "public-domain" | "permissive" | "unknown";

export interface DatasetManifest {
  source: string;
  sourceRepository: string;
  datasetVersion: string;
  /** Commit SHA or release tag identifying the exact source snapshot. */
  sourceRef: string;
  /** Whether this build bundles a curated slice or the full imported corpus. */
  kind: "curated-sample" | "full-import";
  downloadedAt: string | null; // null for a bundled sample (no download performed)
  coverageStart: string;
  coverageEnd: string;
  tours: TennisTour[];
  license: string;
  licenseUse: LicenseUse;
  /** Content hashes of each bundled file, for reproducibility / cache keys. */
  fileHashes: Record<string, string>;
  parserVersion: string;
}

export const SACKMANN_LICENSE =
  "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0)";

export const FREE_DATASET_PARSER_VERSION = "free-tennis-parser-1";

/** The bundled curated-sample manifest (Jeff Sackmann tennis-abstract schema). */
export const SEED_MANIFEST: DatasetManifest = {
  source: "Jeff Sackmann tennis_atp / tennis_wta",
  sourceRepository: "https://github.com/JeffSackmann/tennis_atp",
  datasetVersion: "seed-2026.08",
  sourceRef: "curated-sample@2026.08",
  kind: "curated-sample",
  downloadedAt: null,
  coverageStart: "2023-06-10",
  coverageEnd: "2024-09-08",
  tours: ["atp", "wta"],
  license: SACKMANN_LICENSE,
  licenseUse: "research/non-commercial",
  fileHashes: {
    "atp_matches": stableHash(SEED_ATP_MATCHES_CSV),
    "wta_matches": stableHash(SEED_WTA_MATCHES_CSV),
    "atp_players": stableHash(SEED_ATP_PLAYERS_CSV),
    "wta_players": stableHash(SEED_WTA_PLAYERS_CSV),
    "atp_rankings": stableHash(SEED_ATP_RANKINGS_CSV),
    "wta_rankings": stableHash(SEED_WTA_RANKINGS_CSV),
  },
  parserVersion: FREE_DATASET_PARSER_VERSION,
};
