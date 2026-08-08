/* getOpportunities (chat tool) — the canonical answer to "which lines are
   strongest?". It queries CanonicalOpportunityAssessments (NOT raw projections)
   and ranks ONLY currently-eligible candidates via the shared opportunity query.
   The chat/LLM NEVER computes a probability; it only explains these rows. A tool
   failure returns a transparent "unavailable" result, never a fabricated pick. */

import { z } from "zod";
import { rankOpportunities, type OpportunityRow } from "@/lib/prizepicks/opportunity/query";
import { listCurrentOpportunities } from "@/lib/prizepicks/opportunity/shared-store";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";
import { modelSource } from "../mlb/_shared";

export interface GetOpportunitiesOutput {
  rows: OpportunityRow[];
  total: number;
  status: string;
  market?: string;
  available: boolean;
}

export const getOpportunitiesTool = defineTool<
  {
    status?: "QUALIFIED" | "WATCH" | "REJECTED" | "ANY";
    market?: string;
    side?: "more" | "less";
    sortBy?: "advantage" | "calibrated" | "fragility";
    limit?: number;
  },
  GetOpportunitiesOutput
>({
  name: "getOpportunities",
  description:
    "Rank canonical Opportunity Assessments (the decision engine's verdicts) for the strongest CURRENTLY-ELIGIBLE PrizePicks lines. Use for 'best pick', 'strongest lines', 'best pitcher strikeout / hitter hit opportunities', 'highest calibrated probability / model advantage', 'lowest fragility', 'current WATCH candidates', 'rejected opportunities'. Returns raw AND calibrated probability as DISTINCT fields; only QUALIFIED lines are eligible. Never fabricates a pick — an empty result means nothing meets policy.",
  domain: "prizepicks",
  inputSchema: z.object({
    status: z.enum(["QUALIFIED", "WATCH", "REJECTED", "ANY"]).optional(),
    market: z.string().optional(),
    side: z.enum(["more", "less"]).optional(),
    sortBy: z.enum(["advantage", "calibrated", "fragility"]).optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  async execute(input, ctx): Promise<ToolResult<GetOpportunitiesOutput>> {
    const status = input.status ?? "QUALIFIED";
    try {
      const assessments = await listCurrentOpportunities();
      const rows = rankOpportunities(assessments, { ...input, status });
      ctx.log("opportunities.ranked", { total: rows.length, status, market: input.market });
      return {
        data: { rows, total: rows.length, status, market: input.market, available: true },
        sources: [
          makeSource({ name: "Opportunity assessments (Supabase)", type: "database", dataAsOf: Date.now() }),
          modelSource(),
        ],
        warnings: rows.length === 0 && status === "QUALIFIED" ? ["No opportunity currently meets the policy."] : [],
        summary: rows.length === 0
          ? `No ${status.toLowerCase()} opportunities`
          : `Ranked ${rows.length} ${status.toLowerCase()} opportunit${rows.length === 1 ? "y" : "ies"}`,
        rowCount: rows.length,
      };
    } catch (e) {
      // Transparent failure — never a fabricated pick.
      return {
        data: { rows: [], total: 0, status, market: input.market, available: false },
        sources: [makeSource({ name: "Opportunity assessments (Supabase)", type: "database", dataAsOf: Date.now() })],
        warnings: [`Opportunity data is temporarily unavailable: ${e instanceof Error ? e.message : "unknown error"}`],
        summary: "Opportunity data unavailable",
        rowCount: 0,
      };
    }
  },
});
