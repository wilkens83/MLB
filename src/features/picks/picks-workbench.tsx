"use client";

/* ============================================================================
   Player Picks workbench (client). Pick ONE player → the server analyzes every
   supported prop with the existing engine and returns ranked Top Picks + All
   Props + projection-only props. This component only renders the view model and
   reuses the existing player autocomplete + PrizePicks board store (for lines).
   ========================================================================== */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, Loader2, AlertCircle, TrendingUp, TrendingDown, BarChart3, Info } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerAutocomplete } from "@/components/prizepicks/player-autocomplete";
import { DataQualityBadge } from "@/components/ui/data-badges";
import { cn, pct } from "@/lib/utils";
import * as boardStore from "@/lib/prizepicks/store";
import type { SelectedPlayer } from "@/lib/prizepicks/autocomplete";
import type { ImportedLine, PlayerPicksResult, PlayerPickCandidate, PickDecision } from "@/lib/picks/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Read any imported PrizePicks lines the user already has for this player. */
function linesForPlayer(playerId: number, date: string): ImportedLine[] {
  try {
    return boardStore
      .loadBoard(date)
      .filter((e) => e.mlbPlayerId === playerId && e.marketKey && e.marketSupported && e.status !== "archived")
      .map((e) => ({
        marketKey: e.marketKey,
        line: e.line,
        projectionType: e.projectionType,
        capturedAt: e.capturedAt,
      }));
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

export function PicksWorkbench() {
  const [player, setPlayer] = useState<SelectedPlayer | null>(null);
  const [query, setQuery] = useState("");
  const date = todayIso();

  const { data, isFetching, isError } = useQuery<PlayerPicksResult>({
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

  return (
    <div className="space-y-4">
      {/* Header + search */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-brand-500" />
          <div>
            <h1 className="text-sm font-bold leading-tight">Player Picks</h1>
            <p className="text-[11px] text-muted">
              Pick one player — every supported prop is analyzed by the existing model and the strongest MORE/LESS opportunities are ranked.
            </p>
          </div>
        </div>
        <PlayerAutocomplete
          value={query}
          onChange={setQuery}
          onSelect={(sel) => {
            setQuery(sel.playerName);
            setPlayer(sel);
          }}
          className="w-full"
        />
      </div>

      {!player && <EmptyPrompt />}

      {player && isFetching && <LoadingState name={player.playerName} />}

      {player && !isFetching && isError && (
        <Banner icon={<AlertCircle className="h-4 w-4" />} tone="negative">
          Analysis unavailable right now. Please try again.
        </Banner>
      )}

      {player && !isFetching && data && (
        <>
          {!data.game.resolved ? (
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

              {/* Best Picks */}
              <section>
                <SectionTitle>Best Picks</SectionTitle>
                {data.noStrongPick ? (
                  <div className="panel p-6 text-center">
                    <div className="text-sm font-semibold">NO STRONG PICK</div>
                    <p className="mt-1 text-xs text-muted">
                      {hasLines
                        ? "No supported prop cleared the screening policy for this player today."
                        : "Import PrizePicks lines to evaluate MORE/LESS opportunities."}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {data.topPicks.map((c, i) => (
                      <TopPickCard key={c.propKey} candidate={c} rank={i + 1} />
                    ))}
                  </div>
                )}
              </section>

              {/* All props */}
              {data.allProps.length > 0 && (
                <section>
                  <SectionTitle>All Props</SectionTitle>
                  <AllPropsTable candidates={data.allProps} />
                </section>
              )}

              {/* Projection-only */}
              {data.projectionOnly.length > 0 && (
                <section>
                  <SectionTitle>Projection-only props <span className="font-normal text-muted-2">(no active market line)</span></SectionTitle>
                  <ProjectionOnlyTable candidates={data.projectionOnly} />
                </section>
              )}

              <p className="text-[10px] text-muted-2">
                Screening layer · {data.provenance.picksPolicyVersion} · model {data.provenance.modelVersion} · generated{" "}
                {new Date(data.generatedAt).toLocaleTimeString()}. A market line is only a threshold — it never changes the
                projection. Screening probabilities are uncalibrated; open Full Analysis for the calibrated decision.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{children}</h2>;
}

function PlayerHeader({ data }: { data: PlayerPicksResult }) {
  const p = data.player;
  return (
    <div className="panel flex items-center gap-3 p-4">
      <PlayerAvatar playerId={p.id} name={p.name} teamId={p.teamId} size="lg" shape="rounded" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-bold">{p.name}</div>
        <div className="truncate text-xs text-muted">
          {p.position || (p.isPitcher ? "P" : "—")} · {p.team ?? "—"}
          {data.game.opponentName ? ` · vs ${data.game.opponentName}` : ""}
        </div>
      </div>
      {data.game.resolved && (
        <span className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] text-muted">
          {p.isPitcher ? "Pitcher props" : "Hitter props"}
        </span>
      )}
    </div>
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

function TopPickCard({ candidate: c, rank }: { candidate: PlayerPickCandidate; rank: number }) {
  const prob = c.preferredSide === "more" ? c.probMore : c.probLess;
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-bold">#{rank}</span>
        <DecisionBadge decision={c.decision} />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{c.propLabel}</div>
          <SideBadge side={c.preferredSide} />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{prob !== undefined ? pct(prob, 1) : "—"}</span>
          <span className="text-[11px] text-muted">model P({c.preferredSide === "less" ? "less" : "more"})</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>line <b className="tabular-nums text-foreground">{c.line}</b></span>
          <span>proj <b className="tabular-nums text-foreground">{c.projection}</b></span>
          {c.recent.l10?.hitRate !== undefined && <span>L10 hit <b className="tabular-nums text-foreground">{pct(c.recent.l10.hitRate, 0)}</b></span>}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DataQualityBadge score={c.model.dataQuality} />
          <MetaChip label={`disagree ${c.model.disagreement}`} />
          <MetaChip label={`fragility ${c.model.fragility.toLowerCase()}`} />
        </div>

        {(c.reasons.length > 0 || c.risks.length > 0) && (
          <details className="mt-2 text-[11px]">
            <summary className="cursor-pointer text-brand-500">Why #{rank}?</summary>
            {c.reasons.length > 0 && (
              <div className="mt-1">
                <div className="font-semibold text-[var(--positive)]">Positive evidence</div>
                <ul className="ml-3 list-disc text-muted">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
            {c.risks.length > 0 && (
              <div className="mt-1">
                <div className="font-semibold text-[var(--warning)]">Risks</div>
                <ul className="ml-3 list-disc text-muted">{c.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
          </details>
        )}

        {c.altLines.length > 0 && <AltLines candidate={c} />}

        <div className="mt-3">
          <a href={c.fullAnalysisHref} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium hover:bg-surface-hover">
            <BarChart3 className="h-3 w-3" /> Full Analysis
          </a>
        </div>
      </div>
    </div>
  );
}

function AltLines({ candidate: c }: { candidate: PlayerPickCandidate }) {
  const side = c.preferredSide ?? "more";
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-2/40 p-2 text-[11px]">
      <div className="mb-1 font-semibold text-muted">Alternative lines (same projection)</div>
      <div className="space-y-0.5">
        {c.altLines.map((a, i) => {
          const p = side === "more" ? a.probMore : a.probLess;
          return (
            <div key={i} className="flex items-center justify-between tabular-nums">
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

function AllPropsTable({ candidates }: { candidates: PlayerPickCandidate[] }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="border-b border-border text-[10px] uppercase text-muted-2">
          <tr>
            {["Prop", "Line", "Proj", "Side", "Prob", "L5", "L10", "DQ", "Disagree", "Fragility", "Decision", ""].map((h) => (
              <th key={h} className="px-2.5 py-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const prob = c.preferredSide === "more" ? c.probMore : c.probLess;
            return (
              <tr key={c.propKey} className="border-b border-border/60 last:border-0">
                <td className="px-2.5 py-2 font-medium">{c.propLabel}</td>
                <td className="px-2.5 py-2 tabular-nums">{c.line ?? "—"}</td>
                <td className="px-2.5 py-2 tabular-nums">{c.projection}</td>
                <td className="px-2.5 py-2"><SideBadge side={c.preferredSide} /></td>
                <td className="px-2.5 py-2 tabular-nums font-semibold">{prob !== undefined ? pct(prob, 0) : "—"}</td>
                <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l5?.hitRate !== undefined ? pct(c.recent.l5.hitRate, 0) : "—"}</td>
                <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l10?.hitRate !== undefined ? pct(c.recent.l10.hitRate, 0) : "—"}</td>
                <td className="px-2.5 py-2 tabular-nums">{Math.round(c.model.dataQuality)}</td>
                <td className="px-2.5 py-2 capitalize text-muted">{c.model.disagreement}</td>
                <td className="px-2.5 py-2 capitalize text-muted">{c.model.fragility.toLowerCase()}</td>
                <td className="px-2.5 py-2"><DecisionBadge decision={c.decision} /></td>
                <td className="px-2.5 py-2">
                  <a href={c.fullAnalysisHref} className="text-brand-500 hover:underline">Full</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProjectionOnlyTable({ candidates }: { candidates: PlayerPickCandidate[] }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="border-b border-border text-[10px] uppercase text-muted-2">
          <tr>
            {["Prop", "Projection", "L5 avg", "L10 avg", "Data Quality", ""].map((h) => (
              <th key={h} className="px-2.5 py-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.propKey} className="border-b border-border/60 last:border-0">
              <td className="px-2.5 py-2 font-medium">{c.propLabel}</td>
              <td className="px-2.5 py-2 tabular-nums font-semibold">{c.projection}</td>
              <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l5 ? round1(c.recent.l5.average) : "—"}</td>
              <td className="px-2.5 py-2 tabular-nums text-muted">{c.recent.l10 ? round1(c.recent.l10.average) : "—"}</td>
              <td className="px-2.5 py-2 tabular-nums">{Math.round(c.model.dataQuality)}</td>
              <td className="px-2.5 py-2"><a href={c.fullAnalysisHref} className="text-brand-500 hover:underline">Full</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
