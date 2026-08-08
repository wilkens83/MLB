/* ============================================================================
   Tennis data-acquisition nodes. Reuses the existing graph engine and the
   canonical Tennis provider layer unchanged. Flow:

     providerHealth → selectProviders → [fan-out: one fetch node per provider] →
       reconcile (fan-in) → independentVerify → finalResult

   Every provider fetch node ALWAYS returns ok (with its own success flag) so a
   failing/entitlement-blocked branch degrades the workflow instead of cascade-
   skipping the fan-in. Rejected data never reaches the output (audit).
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok } from "../graph/result";
import { ROUTABLE_STATUSES } from "@/lib/tennis/providers/types";
import type { TennisDataProvider } from "@/lib/tennis/providers/types";
import type { TennisMatch } from "@/lib/tennis/domain";
import { normalizeName } from "@/lib/tennis/data/identity";
import { partitionMatches } from "@/lib/tennis/providers/verify";
import {
  providerHealthOutputSchema, selectOutputSchema, providerFetchOutputSchema,
  reconcileOutputSchema, verifyOutputSchema, acquisitionResultSchema,
  tennisAcquisitionInputSchema, type TennisAcquisitionParsed,
} from "./types";

const asMatches = (v: unknown[]): TennisMatch[] => v as TennisMatch[];

/** node 1 — snapshot provider readiness (drives selection + the health surface). */
export function providerHealthNode(providers: TennisDataProvider[]) {
  return defineNode({
    id: "providerHealth",
    description: "Snapshot each provider's readiness.",
    inputSchema: tennisAcquisitionInputSchema,
    outputSchema: providerHealthOutputSchema,
    selectInput: (i) => tennisAcquisitionInputSchema.parse(i.input),
    run: async () => ok({
      providers: providers.map((p) => {
        const status = p.status();
        return { name: p.name, status, routable: ROUTABLE_STATUSES.includes(status) };
      }),
    }),
  });
}

/** node 2 — choose eligible providers for the schedule capability, with reasons. */
export function selectProvidersNode(providers: TennisDataProvider[]) {
  return defineNode({
    id: "selectProviders",
    description: "Select routable providers for the schedule capability, with audit reasons.",
    inputSchema: z.object({ allowFixtures: z.boolean() }),
    outputSchema: selectOutputSchema,
    dependsOn: ["providerHealth", "input"],
    selectInput: (i) => ({ allowFixtures: (tennisAcquisitionInputSchema.parse(i.input)).allowFixtures }),
    run: async (input) => {
      const eligible = providers.filter((p) => {
        if (!p.capabilities.schedule) return false;
        const s = p.status();
        if (s === "fixture") return input.allowFixtures;
        return ROUTABLE_STATUSES.includes(s);
      });
      return ok({
        selected: eligible.map((p) => p.name),
        reasons: eligible.map((p, idx) => ({
          provider: p.name,
          reason: `${p.status().toUpperCase()} + schedule capability + priority ${idx + 1}`,
        })),
      });
    },
  });
}

/** fan-out — one fetch node per provider. Always returns ok (usable) so a
    non-selected / failing branch degrades instead of cascade-skipping the
    fan-in; selection is honored by short-circuiting WITHOUT a network call. */
export function providerFetchNode(provider: TennisDataProvider) {
  const nodeId = `fetch:${provider.name}`;
  return defineNode({
    id: nodeId,
    description: `Fetch + validate + map the schedule from ${provider.name}.`,
    inputSchema: z.object({ dateIso: z.string(), tour: z.string().optional(), selected: z.boolean() }),
    outputSchema: providerFetchOutputSchema,
    dependsOn: ["selectProviders", "input"],
    costCategory: "external-api",
    selectInput: (i) => {
      const inp = tennisAcquisitionInputSchema.parse(i.input);
      const selected = (i.selectProviders as { selected: string[] }).selected.includes(provider.name);
      return { dateIso: inp.dateIso, tour: inp.tour, selected };
    },
    run: async (input, ctx) => {
      if (!input.selected) {
        return ok({ provider: provider.name, ok: false, status: provider.status(), count: 0, matches: [] });
      }
      ctx.meter.apiCall();
      // Provider methods never throw — they return [] and record health on error.
      const matches = await provider.getSchedule({
        dateIso: input.dateIso,
        tour: input.tour as TennisAcquisitionParsed["tour"],
      });
      const status = provider.status();
      return ok({
        provider: provider.name,
        ok: matches.length > 0 && status === "ready",
        status,
        count: matches.length,
        matches,
      });
    },
  });
}

/** Canonical clustering key for the same real-world match across providers. */
function matchKey(m: TennisMatch): string {
  const players = [normalizeName(m.home.playerName), normalizeName(m.away.playerName)].sort().join("|");
  const day = (m.startTime ?? "").slice(0, 10);
  return `${day}::${players}`;
}

/** fan-in — merge across providers, surface field-level discrepancies. */
export function reconcileNode(providerNames: string[]) {
  return defineNode({
    id: "reconcile",
    description: "Merge provider results by canonical match key and surface discrepancies.",
    inputSchema: z.object({ branches: z.array(providerFetchOutputSchema) }),
    outputSchema: reconcileOutputSchema,
    dependsOn: [...providerNames.map((n) => `fetch:${n}`), "selectProviders"],
    selectInput: (i) => {
      const branches = providerNames
        .map((n) => i[`fetch:${n}`])
        .filter((b): b is z.infer<typeof providerFetchOutputSchema> => b !== undefined)
        .map((b) => providerFetchOutputSchema.parse(b));
      return { branches };
    },
    run: async (input) => {
      const clusters = new Map<string, { provider: string; match: TennisMatch }[]>();
      const contributing = new Set<string>();
      for (const b of input.branches) {
        for (const m of asMatches(b.matches)) {
          contributing.add(b.provider);
          const key = matchKey(m);
          if (!clusters.has(key)) clusters.set(key, []);
          clusters.get(key)!.push({ provider: b.provider, match: m });
        }
      }
      const matches: TennisMatch[] = [];
      const discrepancies: z.infer<typeof reconcileOutputSchema>["discrepancies"] = [];
      for (const [key, members] of clusters) {
        // Representative = first provider in priority order.
        matches.push(members[0].match);
        if (members.length < 2) continue;
        // Compare critical fields across providers; never majority-vote a value.
        const fields: { field: string; get: (m: TennisMatch) => string }[] = [
          { field: "startTime", get: (m) => m.startTime ?? "" },
          { field: "state", get: (m) => m.state },
          { field: "surface", get: (m) => m.surface },
          { field: "winner", get: (m) => (m.home.isWinner ? "home" : m.away.isWinner ? "away" : "") },
        ];
        for (const f of fields) {
          const values: Record<string, string> = {};
          for (const mem of members) values[mem.provider] = f.get(mem.match);
          const distinct = new Set(Object.values(values).filter((v) => v !== ""));
          if (distinct.size > 1) {
            discrepancies.push({ matchKey: key, field: f.field, values, severity: "warning" });
          }
        }
      }
      return ok({ matches, discrepancies, contributingProviders: [...contributing] });
    },
  });
}

/** independent verify — deterministic invariants; REJECTED rows never pass. */
export const independentVerifyNode = defineNode({
  id: "independentVerify",
  description: "Independently verify reconciled matches; rejected rows are excluded.",
  inputSchema: z.object({ matches: z.array(z.unknown()) }),
  outputSchema: z.object({
    verification: verifyOutputSchema,
    accepted: z.array(z.unknown()),
  }),
  dependsOn: ["reconcile"],
  selectInput: (i) => ({ matches: (i.reconcile as { matches: unknown[] }).matches }),
  run: async (input) => {
    const { accepted, rejected } = partitionMatches(asMatches(input.matches));
    const issues = rejected.flatMap((r) => r.issues);
    const verdict: "PASS" | "WARN" | "REJECT" = rejected.length > 0 ? "REJECT" : issues.length > 0 ? "WARN" : "PASS";
    return ok({
      verification: { verdict, accepted: accepted.length, rejected: rejected.length, issues },
      accepted,
    });
  },
});

/** terminal — assemble the acquisition result (DATA_UNAVAILABLE when nothing usable). */
export const finalResultNode = defineNode({
  id: "finalResult",
  description: "Assemble the acquisition result; DATA_UNAVAILABLE when no verified data.",
  inputSchema: z.object({
    dateIso: z.string(),
    selection: z.array(z.object({ provider: z.string(), reason: z.string() })),
    contributingProviders: z.array(z.string()),
    discrepancies: z.array(z.unknown()),
    verification: verifyOutputSchema,
    accepted: z.array(z.unknown()),
  }),
  outputSchema: acquisitionResultSchema,
  dependsOn: ["independentVerify", "reconcile", "selectProviders", "input"],
  selectInput: (i) => {
    const inp = tennisAcquisitionInputSchema.parse(i.input);
    const rec = i.reconcile as { discrepancies: unknown[]; contributingProviders: string[] };
    const sel = i.selectProviders as { reasons: { provider: string; reason: string }[] };
    const ver = i.independentVerify as { verification: z.infer<typeof verifyOutputSchema>; accepted: unknown[] };
    return {
      dateIso: inp.dateIso,
      selection: sel.reasons,
      contributingProviders: rec.contributingProviders,
      discrepancies: rec.discrepancies,
      verification: ver.verification,
      accepted: ver.accepted,
    };
  },
  run: async (input) => {
    const warnings: string[] = [];
    let status: "ok" | "degraded" | "data_unavailable";
    if (input.accepted.length === 0) {
      status = "data_unavailable";
      warnings.push("no verified live data from any provider");
    } else if (input.verification.verdict === "WARN" || input.discrepancies.length > 0) {
      status = "degraded";
      if (input.discrepancies.length > 0) warnings.push(`${input.discrepancies.length} cross-provider discrepancy(ies)`);
    } else {
      status = "ok";
    }
    return ok(acquisitionResultSchema.parse({
      status,
      dateIso: input.dateIso,
      matches: input.accepted,
      providerSelection: input.selection,
      contributingProviders: input.contributingProviders,
      discrepancies: input.discrepancies,
      verification: input.verification,
      warnings,
    }));
  },
});
