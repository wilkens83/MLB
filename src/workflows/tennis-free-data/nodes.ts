/* ============================================================================
   Free-dataset acquisition nodes on the EXISTING graph engine. Reuses the free
   dataset builder, identity reconciliation, independent verifiers, and the
   raw-observation mapping — nothing is recreated.

     datasetMetadata → loadSource → normalize → resolveIdentities
       → verifyCanonicalData → persist → healthReport

   The source loader is injected (default = bundled seed), so no network is
   touched at build/test time; a live import supplies a different loader.
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok, err } from "../graph/result";
import { dataUnavailableError } from "../graph/errors";
import { reconcilePlayers } from "@/lib/tennis/data/identity";
import { verifyMatches, verifyRankings } from "@/lib/tennis/providers/verify";
import { matchToObservation, rankingToObservation } from "@/lib/tennis/data/observations";
import { makeProvenance } from "@/lib/tennis/providers/http";
import {
  freeDataInputSchema, manifestOutputSchema, rawFilesOutputSchema, normalizeOutputSchema,
  identityOutputSchema, verifyOutputSchema, persistOutputSchema, healthReportSchema,
  type FreeDataDeps,
} from "./types";

/** node 1 — dataset metadata (provenance/version/license). fail-fast if absent. */
export function datasetMetadataNode(deps: FreeDataDeps) {
  return defineNode({
    id: "datasetMetadata",
    description: "Resolve dataset provenance, version, and license.",
    inputSchema: freeDataInputSchema,
    outputSchema: manifestOutputSchema,
    selectInput: (i) => freeDataInputSchema.parse(i.input ?? {}),
    run: async () => {
      const ds = deps.load();
      if (!ds || ds.matches.length === 0) return err(dataUnavailableError("free dataset could not be identified/loaded"));
      const m = ds.manifest;
      return ok({
        source: m.source, datasetVersion: m.datasetVersion, sourceRef: m.sourceRef,
        license: m.license, licenseUse: m.licenseUse, kind: m.kind,
        coverageStart: m.coverageStart, coverageEnd: m.coverageEnd,
      });
    },
  });
}

/** node 2 — load/validate raw files (cache/download abstraction). */
export function loadSourceNode(deps: FreeDataDeps) {
  return defineNode({
    id: "loadSource",
    description: "Check cache / load raw source files and validate their presence.",
    inputSchema: z.object({}),
    outputSchema: rawFilesOutputSchema,
    dependsOn: ["datasetMetadata"],
    costCategory: "io",
    retry: { maxAttempts: 2, backoffMs: 100, factor: 2 },
    selectInput: () => ({}),
    run: async () => {
      const ds = deps.load();
      const hashes = ds.manifest.fileHashes;
      const files = Object.keys(hashes).length;
      if (files === 0) return err(dataUnavailableError("no raw files present in cache or download"));
      return ok({ files, fileHashes: hashes });
    },
  });
}

/** node 3 — normalize into canonical domain (already done by the loader; count). */
export function normalizeNode(deps: FreeDataDeps) {
  return defineNode({
    id: "normalize",
    description: "Normalize raw files into canonical matches/players/rankings.",
    inputSchema: z.object({}),
    outputSchema: normalizeOutputSchema,
    dependsOn: ["loadSource"],
    selectInput: () => ({}),
    run: async () => {
      const ds = deps.load();
      return ok({
        matches: ds.matches.length, players: ds.players.length,
        rankings: ds.rankings.length, parseFailures: ds.coverage.parseFailures,
      });
    },
  });
}

/** node 4 — identity resolution (never name-alone; ambiguous stays unresolved). */
export function resolveIdentitiesNode(deps: FreeDataDeps) {
  return defineNode({
    id: "resolveIdentities",
    description: "Reconcile players into a canonical set (never by name alone).",
    inputSchema: z.object({}),
    outputSchema: identityOutputSchema,
    dependsOn: ["normalize"],
    selectInput: () => ({}),
    run: async () => {
      const ds = deps.load();
      const canonical = reconcilePlayers(ds.players);
      return ok({ canonicalPlayers: canonical.length, merged: ds.players.length - canonical.length });
    },
  });
}

/** node 5 — independent verification; REJECT keeps data out of features. */
export function verifyCanonicalNode(deps: FreeDataDeps) {
  return defineNode({
    id: "verifyCanonicalData",
    description: "Independently verify matches + rankings (leakage, self-play, ranks).",
    inputSchema: freeDataInputSchema,
    outputSchema: verifyOutputSchema,
    dependsOn: ["resolveIdentities", "input"],
    selectInput: (i) => freeDataInputSchema.parse(i.input ?? {}),
    run: async (input) => {
      const ds = deps.load();
      const mv = verifyMatches(ds.matches);
      const rv = verifyRankings(ds.rankings, { featureCutoff: input.featureCutoff });
      const issues = [...mv.issues, ...rv.issues].map((x) => ({ code: x.code, severity: x.severity, detail: x.detail }));
      const verdict = mv.verdict === "REJECT" || rv.verdict === "REJECT" ? "REJECT"
        : mv.verdict === "WARN" || rv.verdict === "WARN" ? "WARN" : "PASS";
      return ok({
        verdict, matchesAccepted: mv.passed, matchesRejected: mv.total - mv.passed,
        rankingsVerdict: rv.verdict, issues,
      });
    },
  });
}

/** node 6 — persist as raw observations (sport=tennis via entity_type). */
export function persistNode(deps: FreeDataDeps) {
  return defineNode({
    id: "persist",
    description: "Map verified records to raw_observations (sport via entity_type).",
    inputSchema: verifyOutputSchema,
    outputSchema: persistOutputSchema,
    dependsOn: ["verifyCanonicalData"],
    // Rejected data must not be persisted → skip on REJECT.
    guard: (i) => (i.verifyCanonicalData as { verdict: string }).verdict !== "REJECT",
    selectInput: (i) => verifyOutputSchema.parse(i.verifyCanonicalData),
    run: async () => {
      const ds = deps.load();
      const prov = (recordId?: string) => makeProvenance({ provider: "historical-free", providerRecordId: recordId });
      const obs = [
        ...ds.matches.map((m) => matchToObservation(m, prov(m.externalIds.historicalCsv))),
        ...ds.rankings.map((r) => rankingToObservation(r, prov(r.playerId))),
      ];
      return ok({ observations: obs.length, sport: "tennis" as const });
    },
  });
}

/** terminal — assemble the health report. DEGRADE on parse failures / warnings. */
export function healthReportNode(deps: FreeDataDeps) {
  return defineNode({
    id: "healthReport",
    description: "Assemble the free-data acquisition health report.",
    inputSchema: z.object({}),
    outputSchema: healthReportSchema,
    dependsOn: ["verifyCanonicalData", "persist", "normalize"],
    selectInput: () => ({}),
    run: async (_input, ctx) => {
      const ds = deps.load();
      const verify = verifyOutputSchema.parse((ctx.inputs.verifyCanonicalData));
      const persisted = (ctx.inputs.persist as { observations?: number } | undefined)?.observations ?? 0;
      const warnings: string[] = [];
      if (ds.coverage.parseFailures > 0) warnings.push(`${ds.coverage.parseFailures} rows skipped during parse`);
      if (ds.coverage.matchesWithoutServeStats > 0) warnings.push(`${ds.coverage.matchesWithoutServeStats} matches lack serve stats (missing, not zero)`);
      const status = verify.verdict === "REJECT" ? "failed" : (warnings.length > 0 || verify.verdict === "WARN") ? "degraded" : "ok";
      return ok(healthReportSchema.parse({
        status,
        source: ds.manifest.source,
        datasetVersion: ds.manifest.datasetVersion,
        license: ds.manifest.license,
        licenseUse: ds.manifest.licenseUse,
        coverage: ds.coverage,
        verification: verify,
        observationsPersisted: persisted,
        warnings,
      }));
    },
  });
}
