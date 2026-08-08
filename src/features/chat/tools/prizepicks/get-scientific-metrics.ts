/* getScientificMetrics (chat tool) — answers model-performance-by-market,
   calibration-status, and active-scientific-breakers questions from PERSISTED
   Supabase metrics (never pretrained memory or on-the-fly math). Delegates to the
   canonical scientific-health assembler. Transparent when data is unavailable. */

import { z } from "zod";
import {
  getScientificHealth, supabaseDataSource,
  type ScientificDataSource, type RegistryEntry, type PerformanceRow, type CalibrationSection, type BreakerEntry,
} from "@/lib/supabase/scientific-health";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";

// Test seam: inject a data source; production uses the Supabase source.
let healthSource: ScientificDataSource = supabaseDataSource;
export function __setChatHealthSource(s: ScientificDataSource): void { healthSource = s; }
export function __resetChatHealthSource(): void { healthSource = supabaseDataSource; }

export interface ScientificMetricsOutput {
  supabase: string;
  modelRegistry: RegistryEntry[];
  performance: PerformanceRow[];
  calibration: CalibrationSection;
  circuitBreakers: { activeCount: number; events: BreakerEntry[] };
  ungradedCount: number;
  available: boolean;
}

export const getScientificMetricsTool = defineTool<{ market?: string }, ScientificMetricsOutput>({
  name: "getScientificMetrics",
  description:
    "Return PERSISTED model performance, calibration status, and active scientific circuit breakers from the Supabase scientific record. Use for 'model performance by market', 'calibration status', 'which markets are validated', 'active breakers'. All numbers come from persisted metrics — thin samples read INSUFFICIENT_DATA, never zero-error perfection.",
  domain: "system",
  inputSchema: z.object({ market: z.string().optional() }),
  async execute(input, ctx): Promise<ToolResult<ScientificMetricsOutput>> {
    try {
      const h = await getScientificHealth(healthSource);
      const registry = input.market ? h.modelRegistry.filter((m) => m.market === input.market) : h.modelRegistry;
      ctx.log("scientific.metrics", { markets: registry.length, breakers: h.circuitBreakers.activeCount });
      return {
        data: {
          supabase: h.system.supabase,
          modelRegistry: registry,
          performance: h.performance,
          calibration: h.calibration,
          circuitBreakers: h.circuitBreakers,
          ungradedCount: h.ungradedCount,
          available: h.system.supabase === "CONNECTED",
        },
        sources: [makeSource({ name: "Scientific metrics (Supabase)", type: "database", dataAsOf: Date.now() })],
        warnings: h.system.supabase !== "CONNECTED" ? [`Scientific database ${h.system.supabase.toLowerCase()} — metrics may be incomplete.`] : [],
        summary: `${registry.length} market(s), ${h.circuitBreakers.activeCount} active breaker(s)`,
        rowCount: registry.length,
      };
    } catch (e) {
      return {
        data: { supabase: "UNAVAILABLE", modelRegistry: [], performance: [], calibration: { status: "INSUFFICIENT_DATA", sampleCount: 0, buckets: [] }, circuitBreakers: { activeCount: 0, events: [] }, ungradedCount: 0, available: false },
        sources: [makeSource({ name: "Scientific metrics (Supabase)", type: "database", dataAsOf: Date.now() })],
        warnings: [`Scientific metrics temporarily unavailable: ${e instanceof Error ? e.message : "unknown error"}`],
        summary: "Scientific metrics unavailable",
        rowCount: 0,
      };
    }
  },
});
