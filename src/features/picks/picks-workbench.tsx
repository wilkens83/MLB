"use client";

/* ============================================================================
   Player Picks workbench (client). Pick ONE player → the server analyzes every
   supported prop with the existing engine and returns ranked Top Picks + a
   detailed selected-pick panel + All Props + projection-only props. This renders
   the view model only; it reuses the existing player autocomplete, the PrizePicks
   board store (for lines), and the design system. No analytics are computed here.
   ========================================================================== */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Target, Loader2, AlertCircle, TrendingUp, TrendingDown, BarChart3, Info, RefreshCw,
  CheckCircle2, AlertTriangle, CalendarDays, MapPin,
} from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerAutocomplete } from "@/components/prizepicks/player-autocomplete";
import { DataQualityBadge } from "@/components/ui/data-badges";
import { cn, pct } from "@/lib/utils";
import * as boardStore from "@/lib/prizepicks/store";
import type { SelectedPlayer } from "@/lib/prizepicks/autocomplete";
import type {
  ImportedLine, PlayerPicksResult, PlayerPickCandidate, PickDecision, StatMetric,
} from "@/lib/picks/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function prettyDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

/** Read any imported PrizePicks lines the user already has for this player. */
function linesForPlayer(playerId: number, date: string): ImportedLine[] {
  try {
    return boardStore
      .loadBoard(date)
      .filter((e) => e.mlbPlayerId === playerId && e.marketKey && e.marketSupported && e.status !== "archived")
      .map((e) => ({ marketKey: e.marketKey, line: e.line, projectionType: e.projectionType, capturedAt: e.capturedAt }));
  } catch {
    return [];
  }
}

const DECISION_META: Record<PickDecision, { label: string; cls: string }> = {
  qualified: { label: "QUALIFIED", cls: "bg-[var(--positive)]/15 text-[var(--positive)] border-[var(--positive)]/30" },
  watch: { label: "WATCH", cls: "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30" },
  rejected: { label: "REJECTED", cls: "bg-surface-2 text-muted border-border" },
  unavailable: { label: "UNAVAILABLE", cls: "bg-surface-2 text-muted-2 border-border" },
  projection_only: { label: "PROJECTION", cls: "bg-[var(--information)]/12 text-[var(--information)] border-[var(--information)]/30" },
};

function fmtMetric(m: StatMetric): string {
  // Statcast percentages arrive already on a 0–100 scale (e.g. 30.0 = 30%).
  return m.unit === "pct" ? `${round1(m.value)}%` : String(round1(m.value));
}

/** Align a historical (over-side) hit rate to the candidate's preferred side. */
function sideRate(rate: number | undefined, side?: "more" | "less"): number | undefined {
  if (rate === undefined) return undefined;
  return side === "less" ? 1 - rate : rate;
}

export function PicksWorkbench() {
  const [player, setPlayer] = useState<SelectedPlayer | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const date = todayIso();

  const { data, isFetching, isError, refetch } = useQuery<PlayerPicksResult>({
    queryKey: ["player-picks", player?.playerId, date],
    enabled: !!player?.playerId,
    queryFn: async () => {
      const lines = linesForPlayer(player!.playerId, date);
      const res = await fetch(`/api/players/${player!.playerId}/picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, lines }),
      });
      if (!res.ok) throw new Error("picks request failed");
      return res.json() as Promise<PlayerPicksResult>;
    },
  });

  const hasLines = (data?.provenance.lineSource ?? "none") !== "none";

  // The selected pick for the expanded panel: explicit selection, else the #1
  // top pick, else the strongest analyzed prop.
  const selected = useMemo<PlayerPickCandidate | undefined>(() => {
    if (!data) return undefined;
    const pool = [...data.allProps, ...data.projectionOnly];
    if (selectedKey) {
      const hit = pool.find((c) => c.propKey === selectedKey);
      if (hit) return hit;
    }
    // Default: the #1 top pick, else the strongest projected performance.
    return data.topPicks[0] ?? data.allProps[0] ?? data.projectionOnly[0] ?? pool[0];
  }, [data, selectedKey]);

  return (
    <div className="space-y-4">
      {/* Header + search */}
      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Target className="h-5 w-5 text-brand-500" />
          <div className="mr-auto">
            <h1 className="text-sm font-bold leading-tight">Player Picks</h1>
            <p className="text-[11px] text-muted">Find the strongest statistical opportunities for any MLB player.</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted">
            <CalendarDays className="h-3.5 w-3.5" /> {prettyDate(date)}
          </span>
          {player && (
            <button onClick={() => void refetch()} disabled={isFetching} className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-brand-600">
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Analyze Player
            </button>
          )}
        </div>
        <PlayerAutocomplete
          value={query}
          onChange={setQuery}
          onSelect={(sel) => { setQuery(sel.playerName); setPlayer(sel); setSelectedKey(null); }}
          className="w-full"
        />
      </div>

      {!player && <EmptyPrompt />}
      {player && isFetching && <LoadingState name={player.playerName} />}
      {player && !isFetching && isError && (
        <Banner icon={<AlertCircle className="h-4 w-4" />} tone="negative">Analysis unavailable right now. Please try again.</Banner>
      )}

      {player && !isFetching && data && (
        !data.game.resolved ? (
          <>
            <PlayerHeader data={data} />
            <Banner icon={<AlertCircle className="h-4 w-4" />} tone="warning">
              {data.game.reason ?? "No scheduled MLB game found for this player today."}
            </Banner>
          </>
        ) : (
          <>
            <PlayerHeader data={data} />

            {!hasLines && (
              <Banner icon={<Info className="h-4 w-4" />} tone="info">
                No active PrizePicks lines imported for this player — showing projections only. Import lines on the
                PrizePicks Board to screen MORE/LESS opportunities.
              </Banner>
            )}

            {/* Top Picks */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <SectionTitle>Top Picks</SectionTitle>
                  <p className="-mt-1 text-[11px] text-muted">Best statistical opportunities for {data.player.name} today</p>
                </div>
              </div>
              {data.noStrongPick ? (
                <div className="panel p-6 text-center">
                  <div className="text-sm font-semibold">NO STRONG PICK</div>
                  <p className="mt-1 text-xs text-muted">
                    {hasLines
                      ? "No analyzed prop currently meets the evidence requirements. PASS is a valid result."
                      : "Import PrizePicks lines to evaluate MORE/LESS opportunities."}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.topPicks.map((c, i) => (
                    <TopPickCard key={c.propKey} candidate={c} rank={i + 1} selected={selected?.propKey === c.propKey} onSelect={() => setSelectedKey(c.propKey)} />
                  ))}
                </div>
              )}
            </section>

            {/* Expanded selected analysis — works for a market pick OR a
                projection-only performance (line-only fields are hidden). */}
            {selected && <ExpandedPanel candidate={selected} generatedAt={data.generatedAt} />}

            {/* PrizePicks opportunities (line-mode props) */}
            {data.allProps.length > 0 && (
              <section>
                <SectionTitle>PrizePicks Opportunities</SectionTitle>
                <p className="-mt-1 mb-2 text-[11px] text-muted">Props with an imported market line — evaluated MORE vs LESS</p>
                <AllPropsTable candidates={data.allProps} selectedKey={selected?.propKey} onSelect={setSelectedKey} />
              </section>
            )}

            {/* Player Performance ranking — works with NO market line */}
            {data.projectionOnly.length > 0 && (
              <section>
                <SectionTitle>Player Performance <span className="font-normal text-muted-2">(projected, no market line)</span></SectionTitle>
                <p className="-mt-1 mb-2 text-[11px] text-muted">Strongest projected performances — ranked by model evidence, not a betting edge</p>
                <ProjectionOnlyTable candidates={data.projectionOnly} selectedKey={selected?.propKey} onSelect={setSelectedKey} />
              </section>
            )}

            {/* Next steps */}
            {selected && (
              <section>
                <SectionTitle>Next Steps</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  <a href={selected.fullAnalysisHref} className="inline-flex items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2 text-xs font-semibold text-brand-500 hover:bg-brand-500/20">
                    <BarChart3 className="h-4 w-4" /> Full Analysis
                    <span className="font-normal text-muted-2">Deep dive into {selected.propLabel}</span>
                  </a>
                </div>
              </section>
            )}

            <p className="text-[10px] text-muted-2">
              Screening layer · {data.provenance.picksPolicyVersion} · model {data.provenance.modelVersion} · generated{" "}
              {new Date(data.generatedAt).toLocaleTimeString()}. A market line is only a threshold — it never changes the
              projection. Screening probabilities are uncalibrated; open Full Analysis for the calibrated decision.
            </p>
          </>
        )
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold">{children}</h2>;
}

function PlayerHeader({ data }: { data: PlayerPicksResult }) {
  const p = data.player;
  const g = data.game;
  const handed = p.isPitcher ? p.throws : p.bats;
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
      <div className="panel flex items-center gap-3 p-4">
        <PlayerAvatar playerId={p.id} name={p.name} teamId={p.teamId} size="lg" shape="rounded" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{p.name}</div>
          <div className="truncate text-xs text-muted">
            {p.team ?? "—"} · {p.position || (p.isPitcher ? "P" : "—")}
            {handed ? ` · ${p.isPitcher ? "Throws" : "Bats"} ${handed}` : ""}
          </div>
        </div>
        {g.resolved && (
          <div className="hidden shrink-0 border-l border-border pl-4 text-right sm:block">
            <div className="text-sm font-semibold">{g.homeAway === "home" ? "vs" : "@"} {g.opponentName ?? "—"}</div>
            <div className="text-[11px] text-muted">
              {g.gameStartTime ? new Date(g.gameStartTime).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "Time TBD"}
            </div>
            {g.venueName && <div className="inline-flex items-center gap-1 text-[10px] text-muted-2"><MapPin className="h-2.5 w-2.5" /> {g.venueName}</div>}
          </div>
        )}
      </div>

      {/* Honest status summary — decision-state counts, NOT a fabricated grade. */}
      {g.resolved && <StatusSummary data={data} />}
    </div>
  );
}

function StatusSummary({ data }: { data: PlayerPicksResult }) {
  const s = data.status;
  return (
    <div className="panel flex flex-col justify-center p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Player Pick Status</div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        <StatChip n={s.qualified} label="Qualified" cls="text-[var(--positive)]" />
        <StatChip n={s.watch} label="Watch" cls="text-[var(--warning)]" />
        <StatChip n={s.rejected} label="Rejected" cls="text-muted" />
        {s.projectionOnly > 0 && <StatChip n={s.projectionOnly} label="Proj-only" cls="text-[var(--information)]" />}
      </div>
      <div className="mt-1 text-[10px] text-muted-2">Honest decision-state counts — no letter grade.</div>
    </div>
  );
}
function StatChip({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn("text-lg font-bold tabular-nums", cls)}>{n}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

function DecisionBadge({ decision }: { decision: PickDecision }) {
  const m = DECISION_META[decision];
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold", m.cls)}>{m.label}</span>;
}

function SideBadge({ side }: { side?: "more" | "less" }) {
  if (!side) return <span className="text-muted-2">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", side === "more" ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
      {side === "more" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {side === "more" ? "MORE" : "LESS"}
    </span>
  );
}

function TopPickCard({ candidate: c, rank, selected, onSelect }: { candidate: PlayerPickCandidate; rank: number; selected: boolean; onSelect: () => void }) {
  const prob = c.preferredSide === "more" ? c.probMore : c.probLess;
  return (
    <button onClick={onSelect} className={cn("panel overflow-hidden text-left transition-colors", selected ? "ring-2 ring-brand-500" : "hover:border-brand-500/40")}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500/15 text-[11px] text-brand-500">{rank}</span>
          {c.propLabel} {c.line}
        </span>
        <SideBadge side={c.preferredSide} />
      </div>
      <div className="p-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{prob !== undefined ? pct(prob, 1) : "—"}</span>
          <span className="text-[11px] text-muted">Model P({c.preferredSide === "less" ? "less" : "more"})</span>
          <span className="ml-auto text-[11px] text-muted">Projection <b className="tabular-nums text-foreground">{c.projection}</b></span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {c.recent.l10?.hitRate !== undefined && <MetaChip label={`L10 ${pct(sideRate(c.recent.l10.hitRate, c.preferredSide)!, 0)}`} />}
          <DataQualityBadge score={c.model.dataQuality} />
          <MetaChip label={`Risk ${c.model.fragility.toLowerCase()}`} />
          <DecisionBadge decision={c.decision} />
        </div>
      </div>
    </button>
  );
}

/* ------------------------------- Expanded panel --------------------------- */

const PROJ_STATUS_META: Record<string, { label: string; cls: string }> = {
  strong: { label: "STRONG PROJECTION", cls: "bg-[var(--positive)]/15 text-[var(--positive)] border-[var(--positive)]/30" },
  favorable: { label: "FAVORABLE PROFILE", cls: "bg-[var(--information)]/15 text-[var(--information)] border-[var(--information)]/30" },
  neutral: { label: "NEUTRAL", cls: "bg-surface-2 text-muted border-border" },
  volatile: { label: "VOLATILE", cls: "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30" },
  limited_data: { label: "LIMITED DATA", cls: "bg-surface-2 text-muted-2 border-border" },
};
function ProjStatusBadge({ status }: { status?: string }) {
  const m = PROJ_STATUS_META[status ?? "neutral"] ?? PROJ_STATUS_META.neutral;
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold", m.cls)}>{m.label}</span>;
}

function ExpandedPanel({ candidate: c, generatedAt }: { candidate: PlayerPickCandidate; generatedAt: string }) {
  const hasLine = c.line !== undefined && c.preferredSide !== undefined;
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base font-bold">{c.propLabel}{hasLine ? ` ${c.line}` : ""}</span>
        {hasLine ? <SideBadge side={c.preferredSide} /> : <span className="text-[11px] text-muted">projected performance · no market line</span>}
        <span className="ml-auto">{hasLine ? <DecisionBadge decision={c.decision} /> : <ProjStatusBadge status={c.projectionStatus} />}</span>
      </div>

      {/* Top metrics row */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MiniCard title="Model Projection">
          <div className="text-3xl font-bold tabular-nums">{c.projection}</div>
          <div className="text-[11px] text-muted">Projected {c.propLabel.toLowerCase()}</div>
          {c.recent.season?.median !== undefined && <div className="mt-1 text-[10px] text-muted-2">season median {round1(c.recent.season.median)}</div>}
        </MiniCard>

        {hasLine ? (
          <MiniCard title="Probability">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold tabular-nums text-[var(--positive)]">{c.probMore !== undefined ? pct(c.probMore, 1) : "—"}</span>
              <span className="text-2xl font-bold tabular-nums text-[var(--negative)]">{c.probLess !== undefined ? pct(c.probLess, 1) : "—"}</span>
            </div>
            <div className="mt-1 flex text-[10px] text-muted"><span className="flex-1">More</span><span>Less</span></div>
            <ProbBar more={c.probMore ?? 0} />
            {c.probPush !== undefined && c.probPush > 0 && <div className="mt-1 text-[10px] text-muted-2">Push {pct(c.probPush, 1)}</div>}
          </MiniCard>
        ) : (
          <MiniCard title="Projected Distribution">
            <ProjectedDistribution candidate={c} />
          </MiniCard>
        )}

        <MiniCard title="Model Agreement">
          {hasLine ? (
            <>
              <AgreementRow label="Marginal" v={c.model.marginalProb} />
              <AgreementRow label="PA" v={c.model.paProb} />
              <AgreementRow label="Baseline" v={c.model.baselineProb} />
              <AgreementRow label="Ensemble" v={c.model.ensembleProb} />
            </>
          ) : (
            <>
              <KV k="Marginal" v={fmtNum(c.modelProjections?.marginal)} />
              <KV k="PA" v={fmtNum(c.modelProjections?.pa)} />
              <KV k="Baseline" v={fmtNum(c.modelProjections?.baseline)} />
              <KV k="Ensemble" v={fmtNum(c.modelProjections?.ensemble)} />
            </>
          )}
          <div className="mt-1 text-[10px] text-muted">Disagreement: <span className="capitalize text-foreground">{c.model.disagreement}</span></div>
        </MiniCard>

        <MiniCard title="Reliability">
          <KV k="Data Quality" v={`${Math.round(c.model.dataQuality)}/100`} />
          <KV k="Fragility" v={c.model.fragility} vCls={c.model.fragility === "LOW" ? "text-[var(--positive)]" : c.model.fragility === "MODERATE" ? "text-[var(--warning)]" : "text-[var(--negative)]"} />
          <KV k="Calibration" v="Uncalibrated" vCls="text-[var(--warning)]" />
          {c.sampleSize !== undefined && <KV k="Sample Size" v={`${c.sampleSize} games`} />}
          <KV k="Updated" v={new Date(generatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} />
        </MiniCard>
      </div>

      {/* Pitcher usage / exposure (volume) — one shared start drives every prop. */}
      {c.pitcherUsage && <ExpectedUsage candidate={c} />}

      {/* Recent / Matchup / Why */}
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <RecentPerformance candidate={c} />
        <MatchupContext candidate={c} />
        <WhyThisPick candidate={c} hasLine={hasLine} />
      </div>

      {hasLine && c.altLines.length > 0 && <AltLines candidate={c} />}
    </div>
  );
}

/** Pitcher expected usage/exposure (volume) + volume vs efficiency split. */
function ExpectedUsage({ candidate: c }: { candidate: PlayerPickCandidate }) {
  const u = c.pitcherUsage!;
  const ve = c.volumeEfficiency;
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Expected Usage <span className="font-normal text-muted-2">— one simulated start drives every pitcher prop</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <div className="mb-1 text-[9px] uppercase text-muted-2">Volume</div>
          <KV k="Pitches" v={`${Math.round(u.expectedPitches)} (${Math.round(u.pitches.p10)}–${Math.round(u.pitches.p90)})`} />
          <KV k="Batters faced" v={String(round1(u.expectedBattersFaced))} />
          <KV k="Outs" v={String(round1(u.expectedOuts))} />
          <KV k="Innings" v={String(round1(u.expectedInnings))} />
        </div>
        <div>
          <div className="mb-1 text-[9px] uppercase text-muted-2">Depth (P ≥ N IP)</div>
          <KV k="5+ IP" v={pct(u.inningsExceedance.ip5, 0)} />
          <KV k="6+ IP" v={pct(u.inningsExceedance.ip6, 0)} />
          <KV k="7+ IP" v={pct(u.inningsExceedance.ip7, 0)} />
        </div>
        <div>
          <div className="mb-1 text-[9px] uppercase text-muted-2">Removal / Hook</div>
          <KV k="P(hooked <6 IP)" v={pct(u.removalRisk.pBefore6IP, 0)} vCls={u.removalRisk.pBefore6IP > 0.5 ? "text-[var(--warning)]" : undefined} />
          <KV k="Mean hook pitch" v={u.removalRisk.meanHookPitchCount ? String(Math.round(u.removalRisk.meanHookPitchCount)) : "—"} />
        </div>
        {ve && (
          <div>
            <div className="mb-1 text-[9px] uppercase text-muted-2">Efficiency (per BF)</div>
            <KV k="K / BF" v={pct(ve.rates.kPerBf, 1)} />
            <KV k="BB / BF" v={pct(ve.rates.bbPerBf, 1)} />
            <KV k="H / BF" v={pct(ve.rates.hPerBf, 1)} />
            <KV k="HR / BF" v={pct(ve.rates.hrPerBf, 1)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** P(X=k) bars from the model's outcome distribution (line-independent). */
function ProjectedDistribution({ candidate: c }: { candidate: PlayerPickCandidate }) {
  const dist = (c.distribution ?? []).filter((d) => d.probability > 0.001).slice(0, 14);
  if (dist.length === 0) return <div className="text-[11px] text-muted-2">Distribution unavailable.</div>;
  const max = Math.max(...dist.map((d) => d.probability));
  return (
    <div>
      <div className="flex h-16 items-end gap-0.5">
        {dist.map((d, i) => (
          <div key={i} className="group relative flex-1" title={`P(${round1(d.value)}) = ${pct(d.probability, 1)}`}>
            <div className="w-full rounded-t bg-brand-500/70" style={{ height: `${Math.max(3, Math.round((d.probability / max) * 58))}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-2">
        <span>{round1(dist[0].value)}</span>
        <span>outcome →</span>
        <span>{round1(dist[dist.length - 1].value)}</span>
      </div>
    </div>
  );
}

function MiniCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}
function KV({ k, v, vCls }: { k: string; v: string; vCls?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="text-muted">{k}</span>
      <span className={cn("font-medium tabular-nums", vCls)}>{v}</span>
    </div>
  );
}
function ProbBar({ more }: { more: number }) {
  return (
    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-[var(--negative)]/40">
      <div className="h-full bg-[var(--positive)]" style={{ width: `${Math.round(more * 100)}%` }} />
    </div>
  );
}
function AgreementRow({ label, v }: { label: string; v?: number }) {
  if (v === undefined) return null;
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px]">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-brand-500" style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <span className="w-9 text-right tabular-nums">{pct(v, 0)}</span>
    </div>
  );
}

function RecentPerformance({ candidate: c }: { candidate: PlayerPickCandidate }) {
  const [w, setW] = useState<"l5" | "l10" | "l20" | "season">("l10");
  const stat = c.recent[w];
  const games = c.recentGames ?? [];
  const shown = w === "l5" ? games.slice(-5) : w === "l20" ? games.slice(-20) : w === "l10" ? games.slice(-10) : games;
  const max = Math.max(1, ...shown.map((g) => g.value));
  return (
    <MiniCard title="Recent Performance">
      <div className="mb-2 flex gap-1">
        {(["l5", "l10", "l20", "season"] as const).map((k) => (
          <button key={k} onClick={() => setW(k)} className={cn("rounded px-2 py-0.5 text-[10px] font-medium", w === k ? "bg-brand-500 text-white" : "bg-surface-2 text-muted hover:text-foreground")}>
            {k === "season" ? "Season" : k.toUpperCase()}
          </button>
        ))}
      </div>
      {stat ? (
        <>
          <KV k="Average" v={String(round1(stat.average))} />
          <KV k="Median" v={String(round1(stat.median))} />
          {stat.stdDev !== undefined && <KV k="Std dev" v={String(round1(stat.stdDev))} />}
          {c.trend && <KV k="Trend" v={c.trend.direction === "up" ? "▲ trending up" : c.trend.direction === "down" ? "▼ trending down" : "steady"} vCls={c.trend.direction === "up" ? "text-[var(--positive)]" : c.trend.direction === "down" ? "text-[var(--negative)]" : undefined} />}
          {stat.hitRate !== undefined && <KV k={`Hit Rate (${c.preferredSide === "less" ? "less" : "more"})`} v={pct(sideRate(stat.hitRate, c.preferredSide)!, 0)} vCls="text-foreground" />}
        </>
      ) : (
        <div className="text-[11px] text-muted-2">No window data.</div>
      )}
      {shown.length > 0 && (
        <div className="mt-2">
          <div className="flex h-16 items-end gap-0.5">
            {shown.map((g, i) => (
              <div key={i} className="group relative flex-1" title={`${g.value}${g.opponent ? ` vs ${g.opponent}` : ""}${g.date ? ` (${g.date.slice(5)})` : ""}`}>
                <div
                  className={cn("w-full rounded-t", g.hit === true ? "bg-[var(--positive)]" : g.hit === false ? "bg-[var(--negative)]" : "bg-brand-500/60")}
                  style={{ height: `${Math.max(6, Math.round((g.value / max) * 60))}px` }}
                />
              </div>
            ))}
          </div>
          {c.line !== undefined && <div className="mt-1 text-[9px] text-muted-2">green = cleared preferred side of {c.line} · historical, not a probability</div>}
        </div>
      )}
    </MiniCard>
  );
}

function MatchupContext({ candidate: c }: { candidate: PlayerPickCandidate }) {
  const ctx = c.context;
  const rows: { k: string; v: string; vCls?: string }[] = [];
  if (ctx.opponentName) rows.push({ k: "Opponent", v: `${ctx.homeAway === "home" ? "vs" : "@"} ${ctx.opponentName}` });
  if (ctx.venueName) rows.push({ k: "Venue", v: ctx.venueName });
  if (ctx.homeAway) rows.push({ k: "Home / Away", v: ctx.homeAway === "home" ? "Home" : "Away" });
  const handed = c.category === "pitcher" ? ctx.throws : ctx.bats;
  if (handed) rows.push({ k: "Handedness", v: `${c.category === "pitcher" ? "Throws" : "Bats"} ${handed}` });
  if (ctx.probablePitcherName) rows.push({ k: "Opp. Starter", v: ctx.probablePitcherName });
  if (ctx.lineupConfirmed !== undefined) rows.push({ k: "Lineup", v: ctx.lineupConfirmed ? "Confirmed" : "Projected", vCls: ctx.lineupConfirmed ? "text-[var(--positive)]" : "text-[var(--warning)]" });

  return (
    <MiniCard title="Matchup & Context">
      {rows.map((r) => <KV key={r.k} k={r.k} v={r.v} vCls={r.vCls} />)}

      {c.statcast && c.statcast.length > 0 && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <div className="mb-0.5 text-[9px] uppercase text-muted-2">{c.category === "pitcher" ? "Pitcher Statcast" : "Batter Statcast"}</div>
          {c.statcast.map((m) => <KV key={m.key} k={m.label} v={fmtMetric(m)} />)}
        </div>
      )}
      {c.opponentStatcast && c.opponentStatcast.length > 0 && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <div className="mb-0.5 text-[9px] uppercase text-muted-2">Opposing Starter</div>
          {c.opponentStatcast.map((m) => <KV key={m.key} k={m.label} v={fmtMetric(m)} />)}
        </div>
      )}
      {c.adjustmentFactors && c.adjustmentFactors.length > 0 && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <div className="mb-0.5 text-[9px] uppercase text-muted-2">Model Context Factors</div>
          {c.adjustmentFactors.map((f) => (
            <KV key={f.key} k={f.label} v={`×${round2(f.multiplier)}`} vCls={f.direction === "up" ? "text-[var(--positive)]" : f.direction === "down" ? "text-[var(--negative)]" : undefined} />
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[9px] text-muted-2">Weather &amp; projected batters-faced are not produced by the current engine and are omitted (never fabricated).</div>
    </MiniCard>
  );
}

function WhyThisPick({ candidate: c, hasLine }: { candidate: PlayerPickCandidate; hasLine: boolean }) {
  return (
    <MiniCard title={hasLine ? "Why This Pick?" : "Why This Performance?"}>
      {c.reasons.length > 0 && (
        <ul className="space-y-1">
          {c.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted">
              <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-[var(--positive)]" /> <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {c.risks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {c.risks.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-[var(--warning)]" /> <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </MiniCard>
  );
}

function AltLines({ candidate: c }: { candidate: PlayerPickCandidate }) {
  const side = c.preferredSide ?? "more";
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3 text-[11px]">
      <div className="mb-1 font-semibold text-muted">Alternative lines (same projection — only the threshold changes)</div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {c.altLines.map((a, i) => {
          const p = side === "more" ? a.probMore : a.probLess;
          return (
            <div key={i} className="flex items-center justify-between rounded border border-border px-2 py-1 tabular-nums">
              <span className="capitalize">{a.projectionType ? `${a.projectionType} ` : ""}{a.line}</span>
              <span className="flex items-center gap-2">
                <span>{pct(p, 0)}</span>
                <span className="rounded border border-border px-1 text-[9px] uppercase text-muted-2">{a.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllPropsTable({ candidates, selectedKey, onSelect }: { candidates: PlayerPickCandidate[]; selectedKey?: string; onSelect: (k: string) => void }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[820px] text-xs">
        <thead className="border-b border-border text-[10px] uppercase text-muted-2">
          <tr>
            {["Prop", "Line", "Proj", "Side", "More %", "Less %", "L10", "DQ", "Disagree", "Fragility", "Decision", ""].map((h) => (
              <th key={h} className="px-2.5 py-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.propKey} onClick={() => onSelect(c.propKey)} className={cn("cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-hover", selectedKey === c.propKey && "bg-brand-500/5")}>
              <td className="px-2.5 py-2 font-medium">{c.propLabel}</td>
              <td className="px-2.5 py-2 tabular-nums">{c.line ?? "—"}</td>
              <td className="px-2.5 py-2 tabular-nums">{c.projection}</td>
              <td className="px-2.5 py-2"><SideBadge side={c.preferredSide} /></td>
              <td className={cn("px-2.5 py-2 tabular-nums", c.preferredSide === "more" && "font-semibold text-[var(--positive)]")}>{c.probMore !== undefined ? pct(c.probMore, 0) : "—"}</td>
              <td className={cn("px-2.5 py-2 tabular-nums", c.preferredSide === "less" && "font-semibold text-[var(--negative)]")}>{c.probLess !== undefined ? pct(c.probLess, 0) : "—"}</td>
              <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l10?.hitRate !== undefined ? pct(sideRate(c.recent.l10.hitRate, c.preferredSide)!, 0) : "—"}</td>
              <td className="px-2.5 py-2 tabular-nums">{Math.round(c.model.dataQuality)}</td>
              <td className="px-2.5 py-2 capitalize text-muted">{c.model.disagreement}</td>
              <td className="px-2.5 py-2 capitalize text-muted">{c.model.fragility.toLowerCase()}</td>
              <td className="px-2.5 py-2"><DecisionBadge decision={c.decision} /></td>
              <td className="px-2.5 py-2"><a href={c.fullAnalysisHref} onClick={(e) => e.stopPropagation()} className="text-brand-500 hover:underline">Full</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectionOnlyTable({ candidates, selectedKey, onSelect }: { candidates: PlayerPickCandidate[]; selectedKey?: string; onSelect: (k: string) => void }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[680px] text-xs">
        <thead className="border-b border-border text-[10px] uppercase text-muted-2">
          <tr>{["Prop", "Projection", "L5 avg", "L10 avg", "Trend", "DQ", "Disagree", "Fragility", "Status", ""].map((h) => <th key={h} className="px-2.5 py-2 text-left font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.propKey} onClick={() => onSelect(c.propKey)} className={cn("cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-hover", selectedKey === c.propKey && "bg-brand-500/5")}>
              <td className="px-2.5 py-2 font-medium">{c.propLabel}</td>
              <td className="px-2.5 py-2 tabular-nums font-semibold">{c.projection}</td>
              <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l5 ? round1(c.recent.l5.average) : "—"}</td>
              <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l10 ? round1(c.recent.l10.average) : "—"}</td>
              <td className="px-2.5 py-2 text-muted">{c.trend ? (c.trend.direction === "up" ? "▲" : c.trend.direction === "down" ? "▼" : "—") : "—"}</td>
              <td className="px-2.5 py-2 tabular-nums">{Math.round(c.model.dataQuality)}</td>
              <td className="px-2.5 py-2 capitalize text-muted">{c.model.disagreement}</td>
              <td className="px-2.5 py-2 capitalize text-muted">{c.model.fragility.toLowerCase()}</td>
              <td className="px-2.5 py-2"><ProjStatusBadge status={c.projectionStatus} /></td>
              <td className="px-2.5 py-2"><a href={c.fullAnalysisHref} onClick={(e) => e.stopPropagation()} className="text-brand-500 hover:underline">Full</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtNum(n?: number): string {
  return n === undefined ? "—" : String(round1(n));
}

function MetaChip({ label }: { label: string }) {
  return <span className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] capitalize text-muted">{label}</span>;
}

function EmptyPrompt() {
  return (
    <div className="panel grid place-items-center p-12 text-center">
      <div className="max-w-md">
        <Target className="mx-auto h-10 w-10 text-brand-500" />
        <h2 className="mt-4 text-lg font-bold">Search a player to see their best picks</h2>
        <p className="mt-1 text-sm text-muted">
          Choose one MLB player. Diamond Edge resolves today&apos;s game, analyzes every supported prop with the existing
          engine, evaluates MORE and LESS, and ranks the strongest opportunities — or tells you there is no strong pick.
        </p>
      </div>
    </div>
  );
}

function LoadingState({ name }: { name: string }) {
  return (
    <div className="panel flex items-center gap-2 p-6 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin text-brand-500" /> Analyzing every supported prop for {name}…
    </div>
  );
}

function Banner({ icon, tone, children }: { icon: React.ReactNode; tone: "info" | "warning" | "negative"; children: React.ReactNode }) {
  const cls = {
    info: "border-[var(--information)]/30 bg-[var(--information)]/10 text-[var(--information)]",
    warning: "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]",
    negative: "border-[var(--negative)]/30 bg-[var(--negative)]/10 text-[var(--negative)]",
  }[tone];
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border p-3 text-xs", cls)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
