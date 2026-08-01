/* ============================================================================
   Response builders — turn structured tool outputs into validated response
   blocks. Pure functions (no I/O), so they are unit-testable and reused by the
   mock provider and (optionally) as a formatting fallback for LLM providers.
   ========================================================================== */

import { pct, round } from "@/lib/utils";
import type { ChatResponseBlock } from "../schemas/blocks";
import type { IntentFilters } from "./intent";
import type { TodaysGamesOutput } from "../tools/mlb/get-todays-games";
import type { RankingOutput, RankingRow } from "../tools/mlb/rankings";
import type { PlayerProjectionOutput } from "../tools/mlb/get-player-projection";
import type { ComparePlayersOutput } from "../tools/mlb/compare-players";
import type { DataHealthOutput } from "../tools/mlb/get-data-health";
import type { PrizePicksBoardOutput } from "../tools/prizepicks/get-board";
import type { PrizePicksEdgesOutput, EdgeRow } from "../tools/prizepicks/rank-edges";
import type { AnalyzeEntryOutput } from "../tools/prizepicks/analyze-entry";

/* --------------------------- filtering (follow-ups) ----------------------- */

/** Apply refinement filters to ranking rows using only fields present on them. */
export function applyRankingFilters(
  rows: RankingRow[],
  filters: IntentFilters,
): { rows: RankingRow[]; notes: string[] } {
  let out = rows;
  const notes: string[] = [];
  if (filters.minOverProbability !== undefined) {
    out = out.filter((r) => (r.overProbability ?? 0) >= filters.minOverProbability!);
  }
  if (filters.belowLine) {
    out = out.filter((r) => r.marketLine !== null && r.projection !== null && r.projection > r.marketLine);
  }
  if (filters.handedness) {
    notes.push(
      "Handedness filtering is not available on projection rankings (the ranking rows don't carry throws/bats). Showing the unfiltered ranking.",
    );
  }
  if (filters.limit) out = out.slice(0, filters.limit);
  return { rows: out, notes };
}

/* ------------------------------- games ------------------------------------ */

export function buildGamesBlocks(data: TodaysGamesOutput): {
  answer: string;
  blocks: ChatResponseBlock[];
  suggested: string[];
} {
  if (data.count === 0) {
    return {
      answer: `No MLB games are scheduled for ${data.date}.`,
      blocks: [],
      suggested: ["What data is missing today?", "Show tomorrow's games"],
    };
  }
  const blocks: ChatResponseBlock[] = [
    {
      type: "table",
      title: `MLB slate — ${data.date}`,
      columns: [
        { key: "matchup", label: "Matchup" },
        { key: "status", label: "Status" },
        { key: "away_p", label: "Away SP" },
        { key: "home_p", label: "Home SP" },
        { key: "venue", label: "Venue" },
      ],
      rows: data.games.map((g) => ({
        matchup: `${g.away} @ ${g.home}`,
        status: g.status,
        away_p: g.awayProbable ?? "TBD",
        home_p: g.homeProbable ?? "TBD",
        venue: g.venue ?? "—",
      })),
    },
  ];
  return {
    answer: `${data.count} MLB game${data.count === 1 ? "" : "s"} on ${data.date}.`,
    blocks,
    suggested: [
      "Which pitchers have the best strikeout projections today?",
      "Show the strongest home-run projections",
      "What data is missing today?",
    ],
  };
}

/* ----------------------------- rankings ----------------------------------- */

export function buildRankingBlocks(
  data: RankingOutput,
  metric: "projection" | "overProbability",
): { answer: string; blocks: ChatResponseBlock[]; suggested: string[] } {
  if (data.rows.length === 0) {
    return {
      answer: `No ${data.marketLabel.toLowerCase()} candidates found for ${data.date}.`,
      blocks: [],
      suggested: ["What data is missing today?", "Show today's games"],
    };
  }
  const columns = [
    { key: "player", label: "Player" },
    { key: "team", label: "Team" },
    { key: "opp", label: "Opp" },
    { key: "projection", label: "Proj", format: "number", align: "right" as const },
    { key: "line", label: "Line", format: "number", align: "right" as const },
    { key: "over", label: "Over %", format: "percent", align: "right" as const },
  ];
  const rows = data.rows.map((r) => ({
    player: r.playerName,
    team: r.team,
    opp: r.opponent,
    projection: r.projection,
    line: r.marketLine,
    over: r.overProbability,
  }));
  const chart: ChatResponseBlock = {
    type: "bar-chart",
    data: {
      title: `${data.marketLabel} — top ${Math.min(data.rows.length, 8)}`,
      labels: data.rows.slice(0, 8).map((r) => r.playerName),
      series: [
        {
          name: metric === "projection" ? "Projection" : "Over %",
          values: data.rows
            .slice(0, 8)
            .map((r) => (metric === "projection" ? (r.projection ?? 0) : round((r.overProbability ?? 0) * 100, 1))),
        },
      ],
      yLabel: metric === "projection" ? data.marketLabel : "Over %",
    },
  };
  const top = data.rows[0];
  const answer =
    metric === "projection"
      ? `Top ${data.marketLabel.toLowerCase()} for ${data.date}: ${top.playerName} (${top.projection}) vs ${top.opponent}.`
      : `Strongest ${data.marketLabel.toLowerCase()} for ${data.date}: ${top.playerName} at ${pct(top.overProbability ?? 0)} over ${top.marketLine}.`;
  return {
    answer,
    blocks: [{ type: "table", title: `${data.marketLabel} rankings`, columns, rows }, chart],
    suggested: [
      "Only show players with a probability above 60%",
      "Why does the model favor the top player?",
      "Which PrizePicks lines have the highest edge?",
    ],
  };
}

/* --------------------------- projection / why ----------------------------- */

export function buildProjectionBlocks(
  data: PlayerProjectionOutput,
  why = false,
): { answer: string; blocks: ChatResponseBlock[]; suggested: string[] } {
  if (data.projection === null) {
    return {
      answer: `No projection is available for ${data.playerName ?? `player ${data.playerId}`} on ${data.propLabel}.`,
      blocks: [],
      suggested: ["Show today's games", "Compare two players"],
    };
  }
  const metricGrid: ChatResponseBlock = {
    type: "metric-grid",
    title: `${data.playerName} — ${data.propLabel} ${data.line}`,
    metrics: [
      { label: "Projection", value: data.projection ?? "—", tone: "brand" },
      { label: "Over prob", value: data.overProbability !== null ? pct(data.overProbability) : "—" },
      { label: "Under prob", value: data.underProbability !== null ? pct(data.underProbability) : "—" },
      { label: "Confidence", value: data.confidence !== null ? `${data.confidence}%` : "—" },
      { label: "Fair odds", value: data.fairAmerican !== null ? formatAm(data.fairAmerican) : "—" },
      { label: "Edge", value: data.edge !== null ? pct(data.edge) : "n/a (no price)" },
    ],
  };
  const blocks: ChatResponseBlock[] = [metricGrid];
  if (why) {
    const factorLines = data.factors.length
      ? data.factors.map((f) => `- ${f}`).join("\n")
      : "- No single adjustment dominates; the lean comes mainly from the recent-form baseline.";
    const uncertainty = !data.starterConfirmed
      ? "\n\n**Main uncertainty:** the probable pitcher / matchup is not yet confirmed."
      : !data.lineupConfirmed
        ? "\n\n**Main uncertainty:** the lineup is projected, not confirmed."
        : "";
    blocks.push({
      type: "markdown",
      content: `The model leans **${data.recommendation}** on ${data.playerName} ${data.propLabel} ${data.line} because:\n\n${factorLines}${uncertainty}`,
    });
  }
  const answer = why
    ? `Why the model leans ${data.recommendation} on ${data.playerName} ${data.propLabel} ${data.line}.`
    : `${data.playerName} — ${data.propLabel}: projection ${data.projection}, ${data.recommendation} (${data.confidence}% confidence).`;
  return {
    answer,
    blocks,
    suggested: [
      why ? "Compare this player to another" : "Why does the model favor this pick?",
      "Show today's games",
      "Which PrizePicks lines have the highest edge?",
    ],
  };
}

/* ------------------------------- compare ---------------------------------- */

export function buildCompareBlocks(data: ComparePlayersOutput): {
  answer: string;
  blocks: ChatResponseBlock[];
  suggested: string[];
} {
  const grid: ChatResponseBlock = {
    type: "metric-grid",
    title: `${data.a.name ?? "Player A"} vs ${data.b.name ?? "Player B"} — ${data.propLabel}, last ${data.window}`,
    metrics: [
      { label: `${data.a.name ?? "A"} avg`, value: data.a.average ?? "—", tone: "brand" },
      { label: `${data.b.name ?? "B"} avg`, value: data.b.average ?? "—", tone: "brand" },
      { label: `${data.a.name ?? "A"} over-rate`, value: data.a.hitRateOverDefault !== null ? pct(data.a.hitRateOverDefault) : "—" },
      { label: `${data.b.name ?? "B"} over-rate`, value: data.b.hitRateOverDefault !== null ? pct(data.b.hitRateOverDefault) : "—" },
    ],
  };
  const chart: ChatResponseBlock = {
    type: "line-chart",
    data: {
      title: `${data.propLabel} — last ${data.window} games`,
      labels: Array.from({ length: Math.max(data.a.recentValues.length, data.b.recentValues.length) }, (_, i) => `G${i + 1}`),
      series: [
        { name: data.a.name ?? "A", values: data.a.recentValues },
        { name: data.b.name ?? "B", values: data.b.recentValues },
      ],
      yLabel: data.propLabel,
    },
  };
  const answer =
    data.edge && data.edge !== "Even"
      ? `${data.edge} has the edge in ${data.propLabel.toLowerCase()} over the last ${data.window} games.`
      : `${data.a.name} and ${data.b.name} are even in ${data.propLabel.toLowerCase()} over the last ${data.window} games.`;
  return {
    answer,
    blocks: [grid, chart],
    suggested: ["Compare a different prop", "Show today's games", "Project one of these players"],
  };
}

/* ------------------------------ data health ------------------------------- */

export function buildHealthBlocks(data: DataHealthOutput): {
  answer: string;
  blocks: ChatResponseBlock[];
  suggested: string[];
} {
  const blocks: ChatResponseBlock[] = [
    {
      type: "table",
      title: "Provider health",
      columns: [
        { key: "name", label: "Source" },
        { key: "status", label: "Status" },
        { key: "requests", label: "Reqs", align: "right" as const },
        { key: "failures", label: "Fails", align: "right" as const },
        { key: "avg", label: "Avg ms", align: "right" as const },
      ],
      rows: data.providers.length
        ? data.providers.map((p) => ({
            name: p.name,
            status: p.healthy ? "healthy" : "degraded",
            requests: p.requests,
            failures: p.failures,
            avg: p.avgResponseMs,
          }))
        : [{ name: "(no provider calls yet this session)", status: "—", requests: 0, failures: 0, avg: 0 }],
    },
    {
      type: "metric-grid",
      title: `Slate coverage — ${data.date}`,
      metrics: [
        { label: "Games", value: data.slate.games },
        { label: "Both SP set", value: data.slate.gamesWithBothProbables },
        { label: "Missing SP", value: data.slate.gamesMissingProbable, tone: data.slate.gamesMissingProbable > 0 ? "negative" : "positive" },
        { label: "Model", value: data.modelVersion, tone: "brand" },
      ],
    },
    { type: "markdown", content: ["**Missing / gaps:**", ...data.missing.map((m) => `- ${m}`)].join("\n") },
  ];
  return {
    answer: `Data health for ${data.date}: ${data.slate.gamesWithBothProbables}/${data.slate.games} games fully covered.`,
    blocks,
    suggested: ["Show today's games", "Which pitchers have the best strikeout projections?"],
  };
}

/* ------------------------------ prizepicks -------------------------------- */

export function buildBoardBlocks(data: PrizePicksBoardOutput): {
  answer: string;
  blocks: ChatResponseBlock[];
  suggested: string[];
} {
  if (!data.imported) {
    return {
      answer: `No PrizePicks board has been imported for ${data.date}. Import a board on the PrizePicks Board page, then ask again.`,
      blocks: [],
      suggested: ["Show today's games", "Which pitchers have the best strikeout projections?"],
    };
  }
  return {
    answer: `Imported PrizePicks board for ${data.date}: ${data.count} entries (manually imported, not live).`,
    blocks: [
      {
        type: "table",
        title: "PrizePicks board (imported)",
        columns: [
          { key: "player", label: "Player" },
          { key: "market", label: "Market" },
          { key: "line", label: "Line", format: "number", align: "right" as const },
          { key: "resolved", label: "Resolved" },
        ],
        rows: data.rows.map((r) => ({
          player: r.playerName,
          market: r.market,
          line: r.line,
          resolved: r.mlbPlayerId ? "✓" : "unresolved",
        })),
      },
    ],
    suggested: ["Which PrizePicks lines have the highest edge?", "Which entries are unresolved?"],
  };
}

export function buildEdgesBlocks(data: PrizePicksEdgesOutput): {
  answer: string;
  blocks: ChatResponseBlock[];
  suggested: string[];
} {
  if (data.evaluated === 0) {
    return {
      answer:
        data.count === 0
          ? `No PrizePicks board has been imported for ${data.date}.`
          : `None of the ${data.count} imported entries could be evaluated (unresolved players/markets).`,
      blocks: [],
      suggested: ["Show my PrizePicks board", "Show today's games"],
    };
  }
  const rows = data.rows.map((r: EdgeRow) => ({
    player: r.playerName,
    market: r.market,
    line: r.line,
    projection: r.projection,
    lean: r.recommendation,
    prob: r.probability,
    edge: r.edge,
  }));
  const top = data.rows[0];
  return {
    answer: `Top PrizePicks edge for ${data.date}: ${top.playerName} ${top.market} ${top.line} — ${top.recommendation} (${pct(top.probability ?? 0)}). Imported board, not live.`,
    blocks: [
      {
        type: "table",
        title: "PrizePicks edges (imported board)",
        columns: [
          { key: "player", label: "Player" },
          { key: "market", label: "Market" },
          { key: "line", label: "Line", format: "number", align: "right" as const },
          { key: "projection", label: "Proj", format: "number", align: "right" as const },
          { key: "lean", label: "Lean" },
          { key: "prob", label: "Prob", format: "percent", align: "right" as const },
          { key: "edge", label: "Edge", format: "percent", align: "right" as const },
        ],
        rows,
      },
    ],
    suggested: ["Show my full PrizePicks board", "Only show More leans above 60%"],
  };
}

function formatAm(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/* ---------------------------- entry analysis ------------------------------ */

export function buildEntryBlocks(data: AnalyzeEntryOutput): {
  answer: string;
  blocks: ChatResponseBlock[];
  suggested: string[];
} {
  if (data.size < 2 || data.legs.length === 0) {
    return {
      answer: `An entry needs at least 2 resolved legs. Import a PrizePicks board with 2+ entries, then ask again.`,
      blocks: [],
      suggested: ["Show my PrizePicks board", "Which PrizePicks lines have the highest edge?"],
    };
  }
  const legTable: ChatResponseBlock = {
    type: "table",
    title: `${data.size}-leg ${data.entryType} entry`,
    columns: [
      { key: "leg", label: "Leg" },
      { key: "dir", label: "Side" },
      { key: "prob", label: "Win %", format: "percent", align: "right" },
    ],
    rows: data.legs.map((l) => ({ leg: l.label, dir: l.direction, prob: l.probWin })),
  };
  const dist: ChatResponseBlock = {
    type: "bar-chart",
    data: {
      title: "P(exactly k legs correct)",
      labels: data.distribution.map((_, k) => `${k}`),
      series: [{ name: "Probability %", values: data.distribution.map((p) => Math.round(p * 1000) / 10) }],
      yLabel: "%",
    },
  };
  const metrics: ChatResponseBlock = {
    type: "metric-grid",
    metrics: [
      { label: "P(all win)", value: pct(data.probAllWin), tone: "brand" },
      {
        label: "Exp. return",
        value: data.payoutConfigured && data.expectedReturn !== null ? `${data.expectedReturn}×` : "config required",
        tone: data.payoutConfigured && (data.expectedReturn ?? 0) >= 1 ? "positive" : data.payoutConfigured ? "negative" : "default",
      },
      { label: "Downside", value: data.downsideProbability !== null ? pct(data.downsideProbability) : "—" },
      { label: "Contradictions", value: data.contradictions, tone: data.contradictions > 0 ? "negative" : "positive" },
    ],
  };
  const blocks: ChatResponseBlock[] = [metrics, legTable, dist];
  const flagged = data.correlations.filter((c) => c.contradiction || Math.abs(c.correlation) >= 0.2);
  if (flagged.length) {
    blocks.push({
      type: "markdown",
      content: ["**Leg relationships:**", ...flagged.map((c) => `- ${c.a} ↔ ${c.b}: r=${c.correlation}${c.contradiction ? " ⚠️ contradiction" : ""} — ${c.note}`)].join("\n"),
    });
  }
  const econText = data.payoutConfigured && data.expectedReturn !== null
    ? `expected return ${data.expectedReturn}× (payout ${data.payoutVersion})`
    : "expected return withheld — payout configuration required";
  const answer = `${data.size}-leg ${data.entryType} (${data.method}): P(all win) ${pct(data.probAllWin)}, ${econText}. ${data.contradictions > 0 ? `${data.contradictions} contradictory leg pair(s) detected.` : "No contradictions detected."} This is not a lock or guarantee.`;
  return {
    answer,
    blocks,
    suggested: ["Would this be better as a Power play?", "Show my PrizePicks board", "Which PrizePicks lines have the highest edge?"],
  };
}
