/* ============================================================================
   prizepicks-import@1 nodes. Reuses the existing CSV parser, market canonicalizer,
   and player/game resolver — the workflow only orchestrates them and derives the
   server-authoritative line lifecycle. No mapping/resolution logic is recreated.

     loadInput → parseRows → normalizeMarkets → resolvePlayers → resolveGames
       → validate → reviewGate → persistSnapshots

   Failure policies (audit): invalid market / invalid line ⇒ REJECTED; ambiguous
   player or doubleheader or unknown game ⇒ NEEDS_REVIEW; exact duplicate input ⇒
   idempotent no-op at persist; changed line ⇒ new superseding snapshot. A line
   can only reach VERIFIED through a trusted review decision — never a raw import.
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok } from "../graph/result";
import { parseBoardCsv } from "@/lib/prizepicks/csv";
import { resolveMarket } from "@/lib/prizepicks/market-map";
import { normalizePlayerName } from "@/lib/prizepicks/normalize";
import type { MarketCategory, PlayerCandidate, RawEntry } from "@/lib/prizepicks/types";
import {
  type CanonicalLineSnapshot, type LineVerificationStatus,
  lineEntryId, lineInputHash,
} from "@/lib/prizepicks/ingestion/snapshot";
import {
  importInputSchema, importResultSchema, parseErrorSchema,
  type ImportDeps, type ReviewDecision,
} from "./types";

interface WorkingEntry {
  index: number;
  row: RawEntry;
  normalizedPlayerName: string;
  marketKey?: string;
  marketSupported: boolean;
  marketCategory?: MarketCategory;
  marketStatus: "resolved" | "ambiguous" | "unknown";
  marketReason: string;
  chosen?: PlayerCandidate;
  playerStatus?: "resolved" | "ambiguous" | "not-found" | "conflicting";
  playerReason?: string;
  candidateCount?: number;
  gamePk?: number;
  gameNumber?: number;
  gameStatus?: "resolved" | "ambiguous" | "no-game" | "skipped";
  gameReason?: string;
  gameStartTime?: string;
}

const list = z.object({ entries: z.array(z.unknown()) });
const asEntries = (i: Readonly<Record<string, unknown>>, id: string) => (i[id] as { entries: WorkingEntry[] }).entries;

/** node 1 — validate + echo the import request. */
export const loadInputNode = defineNode({
  id: "loadInput",
  description: "Validate the import request (board date, source, csv/rows).",
  inputSchema: importInputSchema,
  outputSchema: z.object({ boardDate: z.string(), source: z.string(), hasCsv: z.boolean(), rowCount: z.number().int() }),
  selectInput: (i) => importInputSchema.parse(i.input),
  run: async (input) => ok({
    boardDate: input.boardDate,
    source: input.source,
    hasCsv: Boolean(input.csvText),
    rowCount: input.rows?.length ?? 0,
  }),
});

/** node 2 — parse CSV (or accept pre-parsed rows). Invalid rows are reported. */
export const parseRowsNode = defineNode({
  id: "parseRows",
  description: "Parse the CSV into validated RawEntry rows (or accept pre-parsed rows).",
  inputSchema: importInputSchema,
  outputSchema: z.object({
    rows: z.array(z.custom<RawEntry>()),
    errors: z.array(parseErrorSchema),
    duplicates: z.number().int().nonnegative(),
  }),
  dependsOn: ["loadInput", "input"],
  selectInput: (i) => importInputSchema.parse(i.input),
  run: async (input) => {
    if (input.csvText !== undefined) {
      const res = parseBoardCsv(input.csvText, { sourceReference: input.sourceReference });
      return ok({ rows: res.entries, errors: res.errors, duplicates: res.duplicates });
    }
    return ok({ rows: input.rows ?? [], errors: [], duplicates: 0 });
  },
});

/** node 3 — canonicalize each market label (bare ambiguous → routed to review). */
export const normalizeMarketsNode = defineNode({
  id: "normalizeMarkets",
  description: "Map each raw market label to a canonical market (never guessed).",
  inputSchema: z.object({ rows: z.array(z.custom<RawEntry>()) }),
  outputSchema: list,
  dependsOn: ["parseRows"],
  selectInput: (i) => ({ rows: (i.parseRows as { rows: RawEntry[] }).rows }),
  run: async (input) => {
    const entries: WorkingEntry[] = input.rows.map((row, index) => {
      const m = resolveMarket(row.rawMarketLabel);
      return {
        index, row,
        normalizedPlayerName: normalizePlayerName(row.rawPlayerName),
        marketKey: m.market?.canonical,
        marketSupported: m.market?.supported ?? false,
        marketCategory: m.market?.category,
        marketStatus: m.status,
        marketReason: m.reason,
      };
    });
    return ok({ entries });
  },
});

/** node 4 — resolve the player (never auto-picks between plausible players). */
export function resolvePlayersNode(deps: ImportDeps) {
  return defineNode({
    id: "resolvePlayers",
    description: "Resolve each raw player name to a real MLB player id (ambiguous → review).",
    inputSchema: list,
    outputSchema: list,
    dependsOn: ["normalizeMarkets", "input"],
    costCategory: "external-api",
    timeoutMs: 15_000,
    retry: { maxAttempts: 2, backoffMs: 200, factor: 2 },
    selectInput: (i) => ({ entries: asEntries(i, "normalizeMarkets") }),
    run: async (input, ctx) => {
      const inp = importInputSchema.parse(ctx.inputs.input);
      const out: WorkingEntry[] = [];
      for (const e of input.entries as WorkingEntry[]) {
        ctx.meter.apiCall();
        const res = await deps.resolvePlayer({
          rawPlayerName: e.row.rawPlayerName,
          boardDate: inp.boardDate,
          teamAbbreviation: e.row.teamAbbreviation,
          categoryHint: e.marketCategory,
        });
        out.push({
          ...e,
          chosen: res.chosen,
          playerStatus: res.status,
          playerReason: res.reason,
          candidateCount: res.candidates.length,
        });
      }
      return ok({ entries: out });
    },
  });
}

/** node 5 — connect the resolved player to a game (doubleheader → review). */
export function resolveGamesNode(deps: ImportDeps) {
  return defineNode({
    id: "resolveGames",
    description: "Resolve the scheduled game; detect doubleheader ambiguity (never invents a gamePk).",
    inputSchema: list,
    outputSchema: list,
    dependsOn: ["resolvePlayers", "input"],
    costCategory: "external-api",
    timeoutMs: 15_000,
    retry: { maxAttempts: 2, backoffMs: 200, factor: 2 },
    selectInput: (i) => ({ entries: asEntries(i, "resolvePlayers") }),
    run: async (input, ctx) => {
      const inp = importInputSchema.parse(ctx.inputs.input);
      const out: WorkingEntry[] = [];
      for (const e of input.entries as WorkingEntry[]) {
        if (!e.chosen || e.playerStatus !== "resolved") {
          out.push({ ...e, gameStatus: "skipped", gameReason: "player not resolved" });
          continue;
        }
        ctx.meter.apiCall();
        const g = await deps.resolveGame(e.chosen, inp.boardDate);
        out.push({
          ...e,
          gamePk: g.gamePk,
          gameNumber: g.gameNumber,
          gameStatus: g.status,
          gameReason: g.reason,
          gameStartTime: g.gameStartTime,
        });
      }
      return ok({ entries: out });
    },
  });
}

function deriveStatus(e: WorkingEntry): { status: LineVerificationStatus; reason: string } {
  if (!Number.isFinite(e.row.line)) return { status: "REJECTED", reason: "invalid line" };
  // Re-resolve a bare-ambiguous market once the player's role is known.
  if (e.marketStatus !== "resolved" && e.chosen) {
    const role: MarketCategory = e.chosen.isPitcher ? "pitcher" : "hitter";
    const m = resolveMarket(e.row.rawMarketLabel, role);
    if (m.status === "resolved" && m.market) {
      e.marketKey = m.market.canonical; e.marketSupported = m.market.supported;
      e.marketStatus = "resolved"; e.marketCategory = m.market.category; e.marketReason = "resolved with role";
    }
  }
  if (e.marketStatus === "unknown") return { status: "REJECTED", reason: `invalid market: ${e.marketReason}` };
  if (e.marketStatus === "ambiguous") return { status: "NEEDS_REVIEW", reason: e.marketReason };
  if (e.playerStatus !== "resolved" || !e.chosen) return { status: "NEEDS_REVIEW", reason: e.playerReason ?? "player unresolved" };
  if (e.gameStatus === "ambiguous") return { status: "NEEDS_REVIEW", reason: e.gameReason ?? "doubleheader — pick the game" };
  if (e.gameStatus !== "resolved" || e.gamePk === undefined) return { status: "NEEDS_REVIEW", reason: e.gameReason ?? "game unresolved" };
  return { status: "IMPORTED", reason: "resolved + valid; awaiting review" };
}

/** node 6 — validate and build the canonical snapshot with a base line state. */
export function validateNode(sourceRef?: string) {
  return defineNode({
    id: "validate",
    description: "Validate each entry and derive the base line state + canonical snapshot.",
    inputSchema: list,
    outputSchema: list,
    dependsOn: ["resolveGames", "input"],
    selectInput: (i) => ({ entries: asEntries(i, "resolveGames") }),
    run: async (input, ctx) => {
      const inp = importInputSchema.parse(ctx.inputs.input);
      const snapshots: CanonicalLineSnapshot[] = (input.entries as WorkingEntry[]).map((e) => {
        const { status, reason } = deriveStatus(e);
        const entryId = lineEntryId(inp.boardDate, e.normalizedPlayerName, e.marketKey ?? `raw:${e.row.rawMarketLabel}`);
        return {
          entryId,
          boardDate: inp.boardDate,
          playerName: e.normalizedPlayerName,
          rawPlayerName: e.row.rawPlayerName,
          playerId: e.chosen?.mlbPlayerId,
          gamePk: e.gamePk,
          gameNumber: e.gameNumber,
          marketKey: e.marketKey ?? `raw:${e.row.rawMarketLabel}`,
          rawMarketLabel: e.row.rawMarketLabel,
          marketSupported: e.marketSupported,
          line: e.row.line,
          projectionType: e.row.projectionType,
          capturedAt: e.row.capturedAt,
          source: inp.source,
          sourceReference: sourceRef ?? inp.sourceReference,
          verificationStatus: status,
          inputHash: lineInputHash({
            boardDate: inp.boardDate,
            normalizedPlayerName: e.normalizedPlayerName,
            marketKey: e.marketKey ?? `raw:${e.row.rawMarketLabel}`,
            line: e.row.line,
            projectionType: e.row.projectionType,
          }),
          reason,
        };
      });
      return ok({ entries: snapshots });
    },
  });
}

/** node 7 — trusted review gate. VERIFIED is only reachable here (never on import). */
export const reviewGateNode = defineNode({
  id: "reviewGate",
  description: "Apply trusted review decisions. VERIFIED requires a resolved+valid line.",
  inputSchema: list,
  outputSchema: list,
  dependsOn: ["validate", "input"],
  selectInput: (i) => ({ entries: asEntries(i, "validate") }),
  run: async (input, ctx) => {
    const inp = importInputSchema.parse(ctx.inputs.input);
    const reviews = new Map<string, ReviewDecision>((inp.reviews ?? []).map((r) => [r.entryId, r]));
    const out = (input.entries as CanonicalLineSnapshot[]).map((s) => {
      const review = reviews.get(s.entryId);
      if (!review) return s;
      if (review.decision === "REJECTED") {
        return { ...s, verificationStatus: "REJECTED" as const, reason: review.reason ?? "rejected on review" };
      }
      // VERIFIED requires a fully-resolved, valid line — a reviewer cannot verify
      // an unresolved/rejected line into existence.
      const verifiable = s.playerId !== undefined && s.gamePk !== undefined && s.marketSupported
        && s.verificationStatus !== "REJECTED";
      return verifiable
        ? { ...s, verificationStatus: "VERIFIED" as const, reason: review.reason ?? "verified on review" }
        : { ...s, reason: `review VERIFIED ignored — line not fully resolved (${s.reason ?? ""})` };
    });
    return ok({ entries: out });
  },
});

/** node 8 — persist snapshots (idempotent by hash; changed line supersedes). */
export function persistSnapshotsNode(deps: ImportDeps) {
  return defineNode({
    id: "persistSnapshots",
    description: "Persist canonical snapshots append-only (idempotent; changed line supersedes).",
    inputSchema: list,
    outputSchema: importResultSchema,
    dependsOn: ["reviewGate", "parseRows", "input"],
    costCategory: "io",
    selectInput: (i) => ({ entries: asEntries(i, "reviewGate") }),
    run: async (input, ctx) => {
      const inp = importInputSchema.parse(ctx.inputs.input);
      const parse = ctx.inputs.parseRows as { errors: { row: number; field?: string; raw?: string; message: string }[]; duplicates: number; rows: unknown[] };
      const snapshots = input.entries as CanonicalLineSnapshot[];
      const persisted = { inserted: 0, superseded: 0, noop: 0 };
      const stored: CanonicalLineSnapshot[] = [];
      for (const s of snapshots) {
        const r = await deps.store.persist(s);
        persisted[r.action] += 1;
        stored.push(r.snapshot);
      }
      const count = (st: LineVerificationStatus) => snapshots.filter((s) => s.verificationStatus === st).length;
      return ok(importResultSchema.parse({
        boardDate: inp.boardDate,
        summary: {
          parsed: snapshots.length,
          parseErrors: parse.errors.length,
          duplicatesInFile: parse.duplicates,
          imported: count("IMPORTED"),
          needsReview: count("NEEDS_REVIEW"),
          verified: count("VERIFIED"),
          rejected: count("REJECTED"),
          persisted,
        },
        snapshots: stored,
        parseErrors: parse.errors,
      }));
    },
  });
}
