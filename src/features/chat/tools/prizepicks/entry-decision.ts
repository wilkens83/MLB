/* getEntryDecision (chat tool) — the canonical firm decision for a complete
   imported PrizePicks entry. Delegates to the shared board→decision pipeline so
   the chat returns exactly what the decision engine produced. The chat NEVER
   invents an alternative decision or overrides a veto. */

import { z } from "zod";
import { decideEntryFromBoard } from "@/lib/prizepicks/decision/from-board";
import type { DecisionResult } from "@/lib/prizepicks/decision/types";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";
import { mlbStatsSource, modelSource } from "../mlb/_shared";

export interface EntryDecisionOutput {
  entryDecision: DecisionResult;
  legDecisions: DecisionResult[];
  policyVersion: string;
  marketMode: "research-only" | "assume-validated";
  warnings: string[];
}

export const getEntryDecisionTool = defineTool<
  { entryType?: "power" | "flex"; assumeValidatedMarkets?: boolean },
  EntryDecisionOutput
>({
  name: "getEntryDecision",
  description:
    "Produce the FIRM decision (BET_MORE/BET_LESS/WAIT/NO_BET/UNAVAILABLE) for the complete imported PrizePicks entry using the canonical decision engine — with vetoes, precedence, entry economics and sensitivity. Use for 'should I bet this entry', 'firm decision', 'is this a bet'. Markets default to RESEARCH_ONLY (BET prohibited) unless assumeValidatedMarkets is set.",
  domain: "prizepicks",
  inputSchema: z.object({ entryType: z.enum(["power", "flex"]).optional(), assumeValidatedMarkets: z.boolean().optional() }),
  async execute(input, ctx): Promise<ToolResult<EntryDecisionOutput>> {
    const board = ctx.prizePicksBoard ?? [];
    const result = await decideEntryFromBoard({
      board: board.map((b) => ({ playerName: b.playerName, marketKey: b.marketKey, rawMarketLabel: b.rawMarketLabel, line: b.line, mlbPlayerId: b.mlbPlayerId })),
      entryType: input.entryType ?? "flex",
      season: ctx.season,
      date: ctx.date,
      assumeValidatedMarkets: input.assumeValidatedMarkets,
    });
    return {
      data: {
        entryDecision: result.entryDecision,
        legDecisions: result.legDecisions,
        policyVersion: result.entryDecision.decisionPolicyVersion,
        marketMode: result.marketMode,
        warnings: result.warnings,
      },
      sources: [
        makeSource({ name: "PrizePicks CSV/paste import", type: "prizepicks-import", dataAsOf: Date.now() }),
        mlbStatsSource("/people/{id}/stats?stats=gameLog"),
        modelSource(),
      ],
      warnings: result.warnings,
      summary: `Entry decision: ${result.entryDecision.decision} (policy ${result.entryDecision.decisionPolicyVersion})`,
      rowCount: result.legDecisions.length,
    };
  },
});
