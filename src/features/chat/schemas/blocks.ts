/* ============================================================================
   Structured response blocks. The model/orchestrator NEVER returns raw HTML;
   it returns these validated blocks and the client renders trusted components
   for each. This is the security boundary between generated content and the DOM.
   ========================================================================== */

import { z } from "zod";

/* --------------------------------- Markdown ------------------------------- */
export const markdownBlockSchema = z.object({
  type: z.literal("markdown"),
  content: z.string(),
});

/* ---------------------------------- Table --------------------------------- */
export const tableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Optional render hint: "number" | "percent" | "american" | "signed" | "text". */
  format: z.string().optional(),
  align: z.enum(["left", "right", "center"]).optional(),
});
export const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  columns: z.array(tableColumnSchema).min(1),
  rows: z.array(z.record(z.string(), z.unknown())),
});

/* ------------------------------- Player card ------------------------------ */
export const playerCardDataSchema = z.object({
  playerId: z.number(),
  name: z.string(),
  team: z.string().optional(),
  position: z.string().optional(),
  opponent: z.string().optional(),
  headshotId: z.number().optional(),
  metrics: z.array(
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()]),
      tone: z.enum(["default", "positive", "negative", "brand"]).optional(),
      hint: z.string().optional(),
    }),
  ),
  badges: z.array(z.object({ label: z.string(), variant: z.string().optional() })).optional(),
});
export type PlayerCardData = z.infer<typeof playerCardDataSchema>;
export const playerCardBlockSchema = z.object({
  type: z.literal("player-card"),
  data: playerCardDataSchema,
});

/* -------------------------------- Game card ------------------------------- */
export const gameCardDataSchema = z.object({
  gamePk: z.number(),
  away: z.string(),
  home: z.string(),
  awayId: z.number().optional(),
  homeId: z.number().optional(),
  status: z.string(),
  startTime: z.string().optional(),
  venue: z.string().optional(),
  awayProbable: z.string().optional(),
  homeProbable: z.string().optional(),
  note: z.string().optional(),
});
export type GameCardData = z.infer<typeof gameCardDataSchema>;
export const gameCardBlockSchema = z.object({
  type: z.literal("game-card"),
  data: gameCardDataSchema,
});

/* ------------------------------- Metric grid ------------------------------ */
export const metricDataSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  hint: z.string().optional(),
  tone: z.enum(["default", "positive", "negative", "brand"]).optional(),
});
export type MetricData = z.infer<typeof metricDataSchema>;
export const metricGridBlockSchema = z.object({
  type: z.literal("metric-grid"),
  title: z.string().optional(),
  metrics: z.array(metricDataSchema).min(1),
});

/* ---------------------------------- Charts -------------------------------- */
export const chartSeriesSchema = z.object({
  name: z.string(),
  values: z.array(z.number()),
  color: z.string().optional(),
});
export const chartDataSchema = z.object({
  title: z.string().optional(),
  labels: z.array(z.string()),
  series: z.array(chartSeriesSchema).min(1),
  yLabel: z.string().optional(),
});
export type ChartData = z.infer<typeof chartDataSchema>;
export const barChartBlockSchema = z.object({ type: z.literal("bar-chart"), data: chartDataSchema });
export const lineChartBlockSchema = z.object({ type: z.literal("line-chart"), data: chartDataSchema });

/* --------------------------------- Union ---------------------------------- */
export const chatResponseBlockSchema = z.discriminatedUnion("type", [
  markdownBlockSchema,
  tableBlockSchema,
  playerCardBlockSchema,
  gameCardBlockSchema,
  metricGridBlockSchema,
  barChartBlockSchema,
  lineChartBlockSchema,
]);
export type ChatResponseBlock = z.infer<typeof chatResponseBlockSchema>;
