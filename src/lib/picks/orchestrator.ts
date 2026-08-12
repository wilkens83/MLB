/* ============================================================================
   Player Picks orchestrator (server). Given one player, it resolves today's game
   (reusing the existing player/game resolver), discovers the role's supported
   props from the catalog, fans out the EXISTING `runAnalysis` engine over them
   with bounded concurrency, screens + ranks the results, and returns Top Picks +
   All Props + projection-only props.

   It never re-implements projection/simulation. Dependencies (`analyze`,
   `resolve`) are injectable so the pure ranking/decision pipeline is testable
   fully offline.
   ========================================================================== */

import { runAnalysis, MODEL_VERSION, type AnalysisPayload } from "@/lib/mlb/analysis";
import { resolvePlayer } from "@/lib/prizepicks/player-resolver";
import { getMlbSeasonForDate } from "@/lib/mlb/season";
import { computeRanking } from "@/lib/prizepicks/ranking";
import { clamp } from "@/lib/utils";
import type { DisagreementSeverity } from "@/lib/models";
import type { CandidateEvaluation } from "@/lib/prizepicks/types";
import type { HitRateResult, Window } from "@/lib/analytics/hitRate";
import { eligibleProps } from "./eligible";
import { analyzeAltLines, fragilityProxy } from "./distribution";
import { decidePick, buildExplanation, DEFAULT_PICKS_POLICY, type PicksPolicy } from "./decide";
import { rankPicks } from "./rank";
import {
  PICKS_POLICY_VERSION,
  type ImportedLine, type PlayerPickCandidate, type PlayerPicksResult, type WindowStat,
} from "./types";

export interface AnalyzePlayerPicksInput {
  playerId: number;
  date?: string; // YYYY-MM-DD (defaults to today)
  /** Imported PrizePicks lines (from the client board store). Absent ⇒ projection-only. */
  lines?: ImportedLine[];
  concurrency?: number;
  policy?: PicksPolicy;
}

export interface PicksDeps {
  analyze: typeof runAnalysis;
  resolve: typeof resolvePlayer;
}

const DEFAULT_DEPS: PicksDeps = { analyze: runAnalysis, resolve: resolvePlayer };
const DEFAULT_CONCURRENCY = 4;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Bounded-concurrency map that preserves input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function findWindow(hitRates: HitRateResult[], w: Window): WindowStat | undefined {
  const r = hitRates.find((h) => h.window === w);
  if (!r) return undefined;
  return { window: w, average: r.average, median: r.median, hitRate: r.rate, sampleSize: r.games };
}

/** Build a picks candidate from ONE analysis payload (line mode or projection-only). */
function buildCandidate(
  payload: AnalysisPayload,
  args: {
    playerId: number;
    propKey: string;
    propLabel: string;
    category: "pitcher" | "batter";
    isPitcher: boolean;
    gamePk?: number;
    opponentName?: string;
    line?: number;
    projectionType?: string;
    alternativeLines?: { line: number; projectionType?: string }[];
    policy: PicksPolicy;
  },
): PlayerPickCandidate {
  const a = payload.analysis;
  const warnings = payload.warnings.map((w) => ({ code: w.code, severity: w.severity }));
  const hasLine = args.line !== undefined;

  // Base (always-present) fields.
  const projection = a ? a.projection.lambda : 0;
  const dataQuality = payload.dataQuality?.score ?? 0;
  const disagreement: DisagreementSeverity | "unknown" = a?.modelDisagreement.severity ?? "unknown";
  // Fragility is judged against the line the sim actually used (imported line in
  // line mode; the engine's default line in projection-only mode).
  const fragility = a ? fragilityProxy(a.simulation, a.line) : "EXTREME";

  const context = {
    opponentName: args.opponentName ?? payload.opponent?.opponentTeam,
    probablePitcherName: payload.opponent?.pitcherName,
    venueName: payload.opponent?.venueName,
    lineupConfirmed: payload.opponent?.lineupConfirmed,
    starterConfirmed: payload.opponent?.starterConfirmed,
  };

  const marketSupported = !!a; // engine produced an analysis ⇒ prop is modelable
  const resolved = true; // orchestrator only analyses after the game resolved

  // Recent windows (line-relative hit rate only meaningful in line mode).
  const recent = a
    ? {
        l5: findWindow(a.analytics.hitRates, 5),
        l10: findWindow(a.analytics.hitRates, 10),
        l20: findWindow(a.analytics.hitRates, 20),
        season: findWindow(a.analytics.hitRates, "season"),
      }
    : {};
  if (!hasLine) {
    // Projection-only: strip line-relative hit rates (no line to hit).
    for (const k of ["l5", "l10", "l20", "season"] as const) {
      if (recent[k]) recent[k] = { ...recent[k]!, hitRate: undefined };
    }
  }

  const modelBy = (id: "marginal" | "pa" | "baseline") => a?.models.find((m) => m.id === id)?.probOver;
  const model = {
    marginalProb: modelBy("marginal"),
    paProb: modelBy("pa"),
    baselineProb: modelBy("baseline"),
    ensembleProb: a?.ensemble.rawProbOver,
    disagreement,
    dataQuality,
    fragility,
    calibration: "raw" as const,
  };

  // Line-mode probabilities (never fabricated for projection-only).
  const probMore = hasLine && a ? a.simulation.probOver : undefined;
  const probLess = hasLine && a ? a.simulation.probUnder : undefined;
  const probPush = hasLine && a ? a.simulation.probPush : undefined;

  const dec = decidePick(
    { resolved, marketSupported, hasLine, probMore, probLess, dataQuality, disagreement, fragility, warnings },
    args.policy,
  );

  // Experimental screening score via the EXISTING ranking layer (line mode only).
  let score = 0;
  if (hasLine && a) {
    const l10rate = findWindow(a.analytics.hitRates, 10)?.hitRate ?? a.simulation.probOver;
    const evalForRank: CandidateEvaluation = {
      entryId: `${args.playerId}:${args.propKey}`,
      mlbPlayerId: args.playerId,
      gamePk: args.gamePk,
      marketKey: args.propKey,
      line: args.line!,
      projection,
      median: a.simulation.median,
      probMore: a.simulation.probOver,
      probLess: a.simulation.probUnder,
      probPush: a.simulation.probPush,
      projectionDiff: projection - args.line!,
      hitRates: {
        l5: findWindow(a.analytics.hitRates, 5)?.hitRate ?? 0,
        l10: findWindow(a.analytics.hitRates, 10)?.hitRate ?? 0,
        l20: findWindow(a.analytics.hitRates, 20)?.hitRate ?? 0,
        season: findWindow(a.analytics.hitRates, "season")?.hitRate ?? 0,
      },
      dataQuality,
      modelAgreement: clamp(1 - Math.abs(a.simulation.probOver - l10rate), 0, 1),
      sampleSize: payload.meta.sampleSize,
      warnings,
      modelVersion: payload.provenance?.modelVersion ?? MODEL_VERSION,
      calculatedAt: new Date().toISOString(),
      pregame: true,
    };
    score = computeRanking(evalForRank, { resolved: true }).score;
  }

  // Alternative-line analysis from the SAME distribution.
  const altLines =
    hasLine && a && args.alternativeLines && args.alternativeLines.length > 0
      ? analyzeAltLines(a.simulation.distribution, { line: args.line!, projectionType: args.projectionType }, args.alternativeLines, dec.preferredSide ?? "more")
      : [];

  const explanation = buildExplanation({
    propLabel: args.propLabel,
    line: args.line,
    preferredSide: dec.preferredSide,
    projection,
    probMore,
    probLess,
    recent,
    fragility,
    disagreement,
    dataQuality,
    marginalProb: model.marginalProb,
    baselineProb: model.baselineProb,
    paProb: model.paProb,
    context,
    engineWarnings: payload.warnings,
  });

  const href = `/players/${args.playerId}/analysis?market=${encodeURIComponent(args.propKey)}${hasLine ? `&line=${args.line}` : ""}`;

  return {
    playerId: args.playerId,
    gamePk: args.gamePk,
    propKey: args.propKey,
    propLabel: args.propLabel,
    category: args.category,
    line: args.line,
    projectionType: args.projectionType,
    projection: round2(projection),
    preferredSide: hasLine ? dec.preferredSide : undefined,
    probMore: probMore !== undefined ? round4(probMore) : undefined,
    probLess: probLess !== undefined ? round4(probLess) : undefined,
    probPush: probPush !== undefined ? round4(probPush) : undefined,
    recent,
    model,
    context,
    altLines,
    decision: dec.decision,
    score,
    reasons: explanation.reasons,
    risks: explanation.risks,
    fullAnalysisHref: href,
    warnings,
  };
}

export async function analyzePlayerPicks(
  input: AnalyzePlayerPicksInput,
  deps: PicksDeps = DEFAULT_DEPS,
): Promise<PlayerPicksResult> {
  const date = input.date ?? todayIso();
  const season = getMlbSeasonForDate(new Date(`${date}T12:00:00Z`));
  const policy = input.policy ?? DEFAULT_PICKS_POLICY;
  const generatedAt = new Date().toISOString();

  const resolution = await deps.resolve({ rawPlayerName: "", boardDate: date, mlbPlayerId: input.playerId });
  const chosen = resolution.chosen;

  const emptyProvenance = {
    modelVersion: MODEL_VERSION,
    picksPolicyVersion: PICKS_POLICY_VERSION,
    season,
    date,
    lineSource: (input.lines?.length ? "imported" : "none") as "imported" | "none" | "mixed",
  };

  if (!chosen) {
    return {
      player: { id: input.playerId, name: "", isPitcher: false },
      game: { resolved: false, reason: resolution.reason },
      topPicks: [], allProps: [], projectionOnly: [], noStrongPick: true,
      generatedAt, provenance: emptyProvenance, error: "player_unresolved",
    };
  }

  const player = {
    id: chosen.mlbPlayerId,
    name: chosen.fullName,
    team: chosen.teamName,
    teamId: chosen.teamId,
    position: chosen.position,
    isPitcher: chosen.isPitcher,
  };

  // No scheduled game today ⇒ do not fabricate an opponent.
  if (!chosen.gamePk) {
    return {
      player,
      game: { resolved: false, reason: `No scheduled MLB game found for ${chosen.fullName} today.` },
      topPicks: [], allProps: [], projectionOnly: [], noStrongPick: true,
      generatedAt, provenance: emptyProvenance,
    };
  }

  const props = eligibleProps(player.isPitcher);
  const lineByMarket = new Map((input.lines ?? []).map((l) => [l.marketKey, l]));

  const candidates = await mapLimit(props, input.concurrency ?? DEFAULT_CONCURRENCY, async (prop) => {
    const imported = lineByMarket.get(prop.key);
    const line = imported?.line;
    try {
      const payload = await deps.analyze({
        playerId: player.id,
        propKey: prop.key,
        line,
        side: "over",
        season,
      });
      return buildCandidate(payload, {
        playerId: player.id,
        propKey: prop.key,
        propLabel: prop.label,
        category: prop.category === "pitcher" ? "pitcher" : "batter",
        isPitcher: player.isPitcher,
        gamePk: chosen.gamePk,
        opponentName: chosen.opponentName,
        line,
        projectionType: imported?.projectionType,
        alternativeLines: imported?.alternativeLines,
        policy,
      });
    } catch {
      // A failed prop degrades to UNAVAILABLE — never fabricated.
      return {
        playerId: player.id, gamePk: chosen.gamePk, propKey: prop.key, propLabel: prop.label,
        category: (prop.category === "pitcher" ? "pitcher" : "batter") as "pitcher" | "batter",
        projection: 0, recent: {},
        model: { disagreement: "unknown" as const, dataQuality: 0, fragility: "EXTREME" as const, calibration: "raw" as const },
        context: { opponentName: chosen.opponentName },
        altLines: [], decision: "unavailable" as const, score: 0,
        reasons: [], risks: ["analysis unavailable for this prop"],
        fullAnalysisHref: `/players/${player.id}/analysis?market=${encodeURIComponent(prop.key)}`,
        warnings: [{ code: "analysis_unavailable", severity: "high" as const }],
      } satisfies PlayerPickCandidate;
    }
  });

  const ranked = rankPicks(candidates);

  const lineSource: "imported" | "none" | "mixed" =
    !input.lines?.length ? "none" : ranked.allProps.length && ranked.projectionOnly.length ? "mixed" : "imported";

  return {
    player,
    game: {
      gamePk: chosen.gamePk,
      opponentName: chosen.opponentName,
      resolved: true,
    },
    topPicks: ranked.topPicks,
    allProps: ranked.allProps,
    projectionOnly: ranked.projectionOnly,
    noStrongPick: ranked.noStrongPick,
    generatedAt,
    provenance: { ...emptyProvenance, lineSource },
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
