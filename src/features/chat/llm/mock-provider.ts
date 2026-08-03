/* ============================================================================
   Mock provider — the deterministic, offline default (CHAT_AI_PROVIDER=mock).
   It classifies the question, invokes the SAME controlled tools a real LLM would,
   and composes a validated response from real data. It never fabricates numbers:
   every value comes from a tool result. Labeled as development mode in the UI.
   ========================================================================== */

import { dedupeSources, type DataSourceReference } from "../schemas/sources";
import type { ChatAssistantResponse } from "../schemas/response";
import { MODEL_VERSION } from "@/lib/mlb/analysis";
import { classifyIntent, type Intent, type IntentFilters } from "../server/intent";
import * as build from "../server/response-builder";
import type { ChatModelProvider, ProviderInput, ProviderResult } from "./types";
import type { PriorTurnState } from "../server/conversation-types";
import type { SearchPlayersOutput } from "../tools/mlb/search-players";
import type { RankingOutput } from "../tools/mlb/rankings";
import type { PlayerProjectionOutput } from "../tools/mlb/get-player-projection";
import type { ComparePlayersOutput } from "../tools/mlb/compare-players";
import type { TodaysGamesOutput } from "../tools/mlb/get-todays-games";
import type { DataHealthOutput } from "../tools/mlb/get-data-health";
import type { PrizePicksBoardOutput } from "../tools/prizepicks/get-board";
import type { PrizePicksEdgesOutput } from "../tools/prizepicks/rank-edges";

interface Composed {
  answer: string;
  title?: string;
  blocks: ChatAssistantResponse["blocks"];
  suggested: string[];
  sources: DataSourceReference[];
  warnings: string[];
  state?: PriorTurnState;
}

/**
 * Deterministic compose pipeline: classify → invoke controlled tools → build
 * validated blocks from REAL data. Shared by the mock provider and used as the
 * safety net by LLM providers (so no provider can fabricate numbers).
 */
export async function runDeterministic(
  input: ProviderInput,
  meta: { provider: string; model?: string; developmentMode: boolean },
): Promise<ProviderResult & { composed: Composed; intent: Intent }> {
  const intent = classifyIntent(input.message, { hasPriorList: hasList(input.priorState) });
  const composed = await route(intent, input);
  const response: ChatAssistantResponse = {
    answer: composed.answer,
    title: composed.title,
    blocks: composed.blocks,
    sources: dedupeSources(composed.sources),
    warnings: composed.warnings,
    suggestedQuestions: composed.suggested,
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    dataAsOf: input.context.date,
    meta: {
      provider: meta.provider,
      model: meta.model,
      toolsUsed: [],
      developmentMode: meta.developmentMode,
    },
  };
  return { response, state: composed.state, composed, intent };
}

export function createMockProvider(): ChatModelProvider {
  return {
    name: "mock",
    model: "diamond-edge-mock",
    developmentMode: true,
    async respond(input: ProviderInput): Promise<ProviderResult> {
      const { response, state } = await runDeterministic(input, {
        provider: "mock",
        model: "diamond-edge-mock",
        developmentMode: true,
      });
      return { response, state };
    },
  };
}

function hasList(state?: PriorTurnState): boolean {
  return !!state && ["pitcher-k-rankings", "hitter-hr-rankings", "prizepicks-edges"].includes(state.kind);
}

async function resolvePlayer(
  input: ProviderInput,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const res = await input.invoke<SearchPlayersOutput>("searchPlayers", { query: name });
  const top = res.data.players[0];
  return top ? { id: top.playerId, name: top.name } : null;
}

async function route(intent: Intent, input: ProviderInput): Promise<Composed> {
  switch (intent.kind) {
    case "games":
      return composeGames(input);
    case "pitcher-k-rankings":
      return composeRanking(input, "getPitcherStrikeoutRankings", "pitcher-k-rankings", "projection", intent.filters);
    case "hitter-hr-rankings":
      return composeRanking(input, "getHitterHomeRunRankings", "hitter-hr-rankings", "overProbability", intent.filters);
    case "compare":
      return composeCompare(input, intent);
    case "projection":
      return composeProjection(input, intent, false);
    case "why":
      return composeWhy(input, intent);
    case "prizepicks-board":
      return composeBoard(input);
    case "prizepicks-edges":
      return composeEdges(input, intent.filters);
    case "entry-analysis":
      return composeEntry(input, intent);
    case "entry-decision":
      return composeDecision(input, intent);
    case "data-health":
      return composeHealth(input);
    case "followup-filter":
      return composeFollowup(input, intent);
    case "unsupported":
      return {
        answer: intent.note ?? "That question can't be answered from the available data.",
        blocks: [{ type: "markdown", content: `${intent.note ?? "Unsupported request."}\n\nI can help with today's games, player projections, strikeout/home-run rankings, player comparisons, PrizePicks edges, and data health.` }],
        suggested: capabilitySuggestions(),
        sources: [],
        warnings: [intent.note ?? "Unsupported request."],
      };
    case "help":
      return composeHelp();
    case "clarify":
    default:
      return composeClarify(intent);
  }
}

/* ------------------------------- composers -------------------------------- */

async function composeGames(input: ProviderInput): Promise<Composed> {
  const res = await input.invoke<TodaysGamesOutput>("getTodaysGames", {});
  const b = build.buildGamesBlocks(res.data);
  return {
    ...b,
    sources: res.sources,
    warnings: res.warnings,
    state: { kind: "games", date: input.context.date },
  };
}

async function composeRanking(
  input: ProviderInput,
  tool: string,
  kind: string,
  metric: "projection" | "overProbability",
  filters: IntentFilters,
): Promise<Composed> {
  const res = await input.invoke<RankingOutput>(tool, filters.limit ? { limit: filters.limit } : {});
  const { rows, notes } = build.applyRankingFilters(res.data.rows, filters);
  const filtered: RankingOutput = { ...res.data, rows };
  const b = build.buildRankingBlocks(filtered, metric);
  return {
    answer: b.answer,
    blocks: b.blocks,
    suggested: b.suggested,
    sources: res.sources,
    warnings: [...res.warnings, ...notes],
    state: { kind, date: input.context.date, rows: rows as unknown as Record<string, unknown>[], prop: res.data.market },
  };
}

async function composeCompare(input: ProviderInput, intent: Intent): Promise<Composed> {
  if (intent.playerNames.length < 2) return composeClarify(intent, "Name two players to compare, e.g. 'Compare Aaron Judge and Juan Soto'.");
  const [pa, pb] = await Promise.all([
    resolvePlayer(input, intent.playerNames[0]),
    resolvePlayer(input, intent.playerNames[1]),
  ]);
  if (!pa || !pb) {
    const missing = !pa ? intent.playerNames[0] : intent.playerNames[1];
    return composeClarify(intent, `I couldn't resolve "${missing}" to an MLB player. Check the spelling.`);
  }
  const res = await input.invoke<ComparePlayersOutput>("comparePlayers", {
    playerIdA: pa.id,
    playerIdB: pb.id,
    prop: intent.prop,
    window: intent.window,
  });
  const b = build.buildCompareBlocks(res.data);
  return {
    ...b,
    sources: res.sources,
    warnings: res.warnings,
    state: { kind: "compare", date: input.context.date, players: [pa, pb], prop: res.data.prop },
  };
}

async function composeProjection(input: ProviderInput, intent: Intent, why: boolean): Promise<Composed> {
  const name = intent.playerNames[0];
  const player = intent.playerNames.length
    ? await resolvePlayer(input, name)
    : input.priorState?.players?.[0] ?? null;
  if (!player) return composeClarify(intent, "Tell me which player and prop, e.g. 'Aaron Judge total bases'.");
  const prop = intent.prop ?? input.priorState?.prop ?? "total_bases";
  const res = await input.invoke<PlayerProjectionOutput>("getPlayerProjection", { playerId: player.id, prop });
  const b = build.buildProjectionBlocks(res.data, why);
  return {
    ...b,
    sources: res.sources,
    warnings: res.warnings,
    state: { kind: "projection", date: input.context.date, players: [player], prop, line: res.data.line },
  };
}

async function composeWhy(input: ProviderInput, intent: Intent): Promise<Composed> {
  // "Why" refers to the prior list's top item, a prior projection, or a named player.
  const prior = input.priorState;
  if (intent.playerNames.length) return composeProjection(input, intent, true);
  if (prior?.players?.length && prior.prop) {
    const res = await input.invoke<PlayerProjectionOutput>("getPlayerProjection", {
      playerId: prior.players[0].id,
      prop: prior.prop,
    });
    const b = build.buildProjectionBlocks(res.data, true);
    return { ...b, sources: res.sources, warnings: res.warnings, state: { ...prior, kind: "why" } };
  }
  if (prior && (prior.kind === "pitcher-k-rankings" || prior.kind === "hitter-hr-rankings") && prior.rows?.length) {
    const top = prior.rows[0] as { playerId?: number; playerName?: string };
    if (top?.playerId && prior.prop) {
      const res = await input.invoke<PlayerProjectionOutput>("getPlayerProjection", { playerId: top.playerId, prop: prior.prop });
      const b = build.buildProjectionBlocks(res.data, true);
      return { ...b, sources: res.sources, warnings: res.warnings, state: { ...prior, kind: "why", players: top.playerId ? [{ id: top.playerId, name: top.playerName ?? "" }] : undefined } };
    }
  }
  return composeClarify(intent, "Ask 'why' right after a projection or a ranking, or name the player, e.g. 'Why does the model favor Aaron Judge total bases?'.");
}

async function composeBoard(input: ProviderInput): Promise<Composed> {
  const res = await input.invoke<PrizePicksBoardOutput>("getPrizePicksBoard", {});
  const b = build.buildBoardBlocks(res.data);
  return { ...b, sources: res.sources, warnings: res.warnings, state: { kind: "prizepicks-board", date: input.context.date } };
}

async function composeEdges(input: ProviderInput, filters: IntentFilters): Promise<Composed> {
  const res = await input.invoke<PrizePicksEdgesOutput>("getPrizePicksEdges", filters.limit ? { limit: filters.limit } : {});
  let rows = res.data.rows;
  if (filters.minOverProbability !== undefined) rows = rows.filter((r) => (r.probability ?? 0) >= filters.minOverProbability!);
  const b = build.buildEdgesBlocks({ ...res.data, rows });
  return {
    ...b,
    sources: res.sources,
    warnings: res.warnings,
    state: { kind: "prizepicks-edges", date: input.context.date, rows: rows as unknown as Record<string, unknown>[] },
  };
}

async function composeEntry(input: ProviderInput, intent: Intent): Promise<Composed> {
  const res = await input.invoke<import("../tools/prizepicks/analyze-entry").AnalyzeEntryOutput>(
    "analyzeEntry",
    intent.entryType ? { entryType: intent.entryType } : {},
  );
  const b = build.buildEntryBlocks(res.data);
  return { ...b, sources: res.sources, warnings: res.warnings, state: { kind: "entry-analysis", date: input.context.date } };
}

async function composeDecision(input: ProviderInput, intent: Intent): Promise<Composed> {
  const res = await input.invoke<import("../tools/prizepicks/entry-decision").EntryDecisionOutput>(
    "getEntryDecision",
    intent.entryType ? { entryType: intent.entryType } : {},
  );
  const b = build.buildDecisionBlocks(res.data);
  return { ...b, sources: res.sources, warnings: res.warnings, state: { kind: "entry-decision", date: input.context.date } };
}

async function composeHealth(input: ProviderInput): Promise<Composed> {
  const res = await input.invoke<DataHealthOutput>("getDataHealth", {});
  const b = build.buildHealthBlocks(res.data);
  return { ...b, sources: res.sources, warnings: res.warnings, state: { kind: "data-health", date: input.context.date } };
}

async function composeFollowup(input: ProviderInput, intent: Intent): Promise<Composed> {
  const prior = input.priorState;
  if (!prior) return composeClarify(intent, "There's no previous result to refine yet.");
  // Merge filters onto the previous ranking/edges tool and re-run with fresh data.
  if (prior.kind === "pitcher-k-rankings")
    return composeRanking(input, "getPitcherStrikeoutRankings", "pitcher-k-rankings", "projection", intent.filters);
  if (prior.kind === "hitter-hr-rankings")
    return composeRanking(input, "getHitterHomeRunRankings", "hitter-hr-rankings", "overProbability", intent.filters);
  if (prior.kind === "prizepicks-edges") return composeEdges(input, intent.filters);
  return composeClarify(intent, "I can only refine a previous ranking or PrizePicks list.");
}

function composeHelp(): Composed {
  return {
    answer: "I'm the Diamond Edge analytics assistant. I answer from the app's real MLB and PrizePicks data via controlled tools.",
    blocks: [
      {
        type: "markdown",
        content:
          "I can help with:\n- Today's games and probable pitchers\n- Pitcher strikeout & hitter home-run rankings\n- A player's projection for a prop (and *why* the model leans that way)\n- Comparing two players over recent games\n- PrizePicks board edges (from your imported board)\n- Data health / what's missing today",
      },
    ],
    suggested: capabilitySuggestions(),
    sources: [],
    warnings: [],
  };
}

function composeClarify(intent: Intent, note?: string): Composed {
  return {
    answer: note ?? "I couldn't map that to a supported question. Try one of the suggestions below.",
    blocks: [{ type: "markdown", content: note ?? "I couldn't identify the player, game, or market safely. Could you rephrase or add a name/date?" }],
    suggested: capabilitySuggestions(),
    sources: [],
    warnings: note ? [note] : [],
    state: undefined,
  };
}

function capabilitySuggestions(): string[] {
  return [
    "Which pitchers have the best strikeout projections today?",
    "Show the strongest home-run projections",
    "Compare Aaron Judge and Juan Soto",
    "What data is missing today?",
  ];
}
