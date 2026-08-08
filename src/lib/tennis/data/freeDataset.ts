/* ============================================================================
   Free historical Tennis dataset — the no-cost data path. Loads the curated
   Sackmann-schema seed ONCE (memoized), normalizes it into the EXISTING domain
   via `parseHistoricalCsv` (matches) + the small players/rankings parsers, and
   exposes read slices for the UI (search, player, point-in-time rankings, player
   matches, coverage counts). Also adapts to the `TennisDataProvider` interface as
   `historical-free`.

   Never LIVE: this is HISTORICAL data. Missing fields stay undefined. Rankings
   are point-in-time (asOf). Player ids link to match sides via `csv:<id>`.
   ========================================================================== */

import type {
  RankingSnapshot, TennisMatch, TennisPlayer, TennisTour, Tournament,
} from "../domain";
import type {
  HistoricalQuery, ProviderCapabilities, ProviderStatus, ScheduleQuery, TennisDataProvider,
} from "../providers/types";
import { recordSuccess, setStatus } from "../providers/health";
import { parseHistoricalCsv } from "../providers/historicalCsv";
import { parsePlayersCsv, parseRankingsCsv } from "./freeParsers";
import { normalizeName } from "./identity";
import {
  SEED_ATP_MATCHES_CSV, SEED_WTA_MATCHES_CSV, SEED_ATP_PLAYERS_CSV, SEED_WTA_PLAYERS_CSV,
  SEED_ATP_RANKINGS_CSV, SEED_WTA_RANKINGS_CSV,
} from "./datasets/seed";
import { SEED_MANIFEST, type DatasetManifest } from "./datasets/manifest";

const PROVIDER_NAME = "historical-free";

export interface FreeDatasetCoverage {
  atpPlayers: number;
  wtaPlayers: number;
  atpMatches: number;
  wtaMatches: number;
  rankingObservations: number;
  matchesWithServeStats: number;
  matchesWithoutServeStats: number;
  yearsCovered: number[];
  parseFailures: number;
}

export interface FreeDataset {
  manifest: DatasetManifest;
  matches: TennisMatch[];
  players: TennisPlayer[];
  rankings: RankingSnapshot[];
  tourOf: (matchId: string) => TennisTour | undefined;
  coverage: FreeDatasetCoverage;
}

interface RawInputs {
  atpMatchesCsv: string; wtaMatchesCsv: string;
  atpPlayersCsv: string; wtaPlayersCsv: string;
  atpRankingsCsv: string; wtaRankingsCsv: string;
  manifest: DatasetManifest;
}

const SEED_INPUTS: RawInputs = {
  atpMatchesCsv: SEED_ATP_MATCHES_CSV, wtaMatchesCsv: SEED_WTA_MATCHES_CSV,
  atpPlayersCsv: SEED_ATP_PLAYERS_CSV, wtaPlayersCsv: SEED_WTA_PLAYERS_CSV,
  atpRankingsCsv: SEED_ATP_RANKINGS_CSV, wtaRankingsCsv: SEED_WTA_RANKINGS_CSV,
  manifest: SEED_MANIFEST,
};

/** Build a normalized dataset from raw CSV inputs (injectable for import/tests). */
export function buildFreeDataset(inputs: RawInputs = SEED_INPUTS): FreeDataset {
  const tourOfMap = new Map<string, TennisTour>();
  let parseFailures = 0;

  const parseTour = (csv: string, tour: TennisTour): TennisMatch[] => {
    const res = parseHistoricalCsv(csv, tour);
    parseFailures += res.skipped;
    return res.matches.map((m) => {
      // ATP and WTA are separate id namespaces in the source; namespace the match
      // id by tour so combining tours can never collide (e.g. both finals #701).
      const id = `${tour}:${m.id}`;
      tourOfMap.set(id, tour);
      // Re-tag provenance to the free provider (keep any existing markers).
      return { ...m, id, sources: ["historical-free", ...m.sources.filter((s) => s.includes(":"))] };
    });
  };

  const atpMatches = parseTour(inputs.atpMatchesCsv, "atp");
  const wtaMatches = parseTour(inputs.wtaMatchesCsv, "wta");
  const matches = [...atpMatches, ...wtaMatches];

  const atpPlayers = parsePlayersCsv(inputs.atpPlayersCsv, "atp");
  const wtaPlayers = parsePlayersCsv(inputs.wtaPlayersCsv, "wta");
  const players = [...atpPlayers.players, ...wtaPlayers.players];

  const atpRankings = parseRankingsCsv(inputs.atpRankingsCsv, "atp");
  const wtaRankings = parseRankingsCsv(inputs.wtaRankingsCsv, "wta");
  const rankings = [...atpRankings.rankings, ...wtaRankings.rankings];

  const hasServe = (m: TennisMatch) => m.stats.some((s) => (s.availableMetrics ?? []).includes("aces"));
  const years = new Set<number>();
  for (const m of matches) years.add(m.season);

  const coverage: FreeDatasetCoverage = {
    atpPlayers: atpPlayers.players.length,
    wtaPlayers: wtaPlayers.players.length,
    atpMatches: atpMatches.length,
    wtaMatches: wtaMatches.length,
    rankingObservations: rankings.length,
    matchesWithServeStats: matches.filter(hasServe).length,
    matchesWithoutServeStats: matches.filter((m) => !hasServe(m)).length,
    yearsCovered: [...years].sort((a, b) => a - b),
    parseFailures,
  };

  return {
    manifest: inputs.manifest,
    matches,
    players,
    rankings,
    tourOf: (id) => tourOfMap.get(id),
    coverage,
  };
}

let _cached: FreeDataset | null = null;
/** The bundled seed dataset (memoized — parsed once per process). */
export function getFreeDataset(): FreeDataset {
  return (_cached ??= buildFreeDataset());
}
/** Test-only: clear the memoized dataset. */
export function __resetFreeDataset() { _cached = null; }

// --- Read slices for the UI (server-side; query only what's needed) --------

const foldAccents = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Accent-insensitive player search over the free dataset. */
export function searchFreePlayers(query: string, ds: FreeDataset = getFreeDataset()): TennisPlayer[] {
  const q = foldAccents(query.trim());
  if (!q) return [];
  return ds.players.filter((p) => foldAccents(p.fullName).includes(q) || p.normalizedName.includes(normalizeName(query)));
}

export function getFreePlayer(id: string, ds: FreeDataset = getFreeDataset()): TennisPlayer | undefined {
  return ds.players.find((p) => p.id === id || Object.values(p.externalIds).includes(id));
}

/** Point-in-time rankings: only observations knowable at/before `asOfIso`. */
export function freeRankingsAsOf(tour: TennisTour, asOfIso: string, ds: FreeDataset = getFreeDataset()): RankingSnapshot[] {
  const cutoff = Date.parse(asOfIso);
  return ds.rankings
    .filter((r) => r.tour === tour && Date.parse(r.asOf) <= cutoff)
    // latest snapshot per player up to the cutoff
    .reduce<RankingSnapshot[]>((acc, r) => {
      const existing = acc.find((x) => x.playerId === r.playerId);
      if (!existing) acc.push(r);
      else if (Date.parse(r.asOf) > Date.parse(existing.asOf)) Object.assign(existing, r);
      return acc;
    }, [])
    .sort((a, b) => a.rank - b.rank);
}

export function freePlayerMatches(playerId: string, ds: FreeDataset = getFreeDataset()): TennisMatch[] {
  return ds.matches.filter((m) => m.home.playerId === playerId || m.away.playerId === playerId);
}

// --- TennisDataProvider adapter (`historical-free`) ------------------------

const CAPS: ProviderCapabilities = {
  schedule: false, results: true, rankings: true, players: true, historical: true,
};

export function createHistoricalFreeProvider(ds: FreeDataset = getFreeDataset()): TennisDataProvider {
  return {
    name: PROVIDER_NAME,
    capabilities: CAPS,
    status(): ProviderStatus {
      const ready = ds.matches.length > 0;
      setStatus(PROVIDER_NAME, ready ? "ready" : "unconfigured",
        ready ? `Free historical dataset (${ds.manifest.datasetVersion}) — ${ds.matches.length} matches` : "no dataset loaded");
      return ready ? "ready" : "unconfigured";
    },
    capabilityStatus: () => ({ results: "verified", rankings: "verified", players: "verified", historical: "verified", schedule: "unsupported" }),
    async getSchedule(_q: ScheduleQuery): Promise<TennisMatch[]> { void _q; return []; },
    async getMatchResults(query: HistoricalQuery): Promise<TennisMatch[]> {
      const t0 = Date.now();
      const out = ds.matches
        .filter((m) => m.season === query.season)
        .filter((m) => (query.surface ? m.surface === query.surface : true))
        .filter((m) => (query.tour ? ds.tourOf(m.id) === query.tour : true));
      recordSuccess(PROVIDER_NAME, Date.now() - t0);
      return out;
    },
    async getRankings(tour: TennisTour, asOf?: string): Promise<RankingSnapshot[]> {
      const t0 = Date.now();
      const out = asOf ? freeRankingsAsOf(tour, asOf, ds) : ds.rankings.filter((r) => r.tour === tour);
      recordSuccess(PROVIDER_NAME, Date.now() - t0);
      return out;
    },
    async getPlayer(externalId: string): Promise<TennisPlayer | null> {
      return getFreePlayer(externalId, ds) ?? null;
    },
    async getTournaments(_season: number): Promise<Tournament[]> { void _season; return []; },
  };
}

export const HISTORICAL_FREE_PROVIDER_NAME = PROVIDER_NAME;
