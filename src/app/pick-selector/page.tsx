"use client";

import { useCallback, useMemo, useState } from "react";
import { Target, Loader2, Filter, TriangleAlert } from "lucide-react";
import { cn, pct } from "@/lib/utils";
import type { PickSelectorResult, GradedPick, PickGrade } from "@/lib/picks";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface BoardLeg { playerName: string; marketKey?: string; rawMarketLabel?: string; line: number; mlbPlayerId?: number }
function readBoard(date: string): BoardLeg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`dp-prizepicks-board-${date}`);
    if (!raw) return [];
    return (JSON.parse(raw) as Record<string, unknown>[])
      .map((e) => ({
        playerName: String(e.rawPlayerName ?? ""),
        marketKey: typeof e.marketKey === "string" ? e.marketKey : undefined,
        rawMarketLabel: typeof e.rawMarketLabel === "string" ? e.rawMarketLabel : undefined,
        line: Number(e.line ?? 0),
        mlbPlayerId: typeof e.mlbPlayerId === "number" ? e.mlbPlayerId : undefined,
      }))
      .filter((e) => e.playerName && Number.isFinite(e.line));
  } catch {
    return [];
  }
}

const GRADE_STYLE: Record<PickGrade, string> = {
  "A+": "bg-[var(--positive)] text-white",
  A: "bg-[var(--positive)]/80 text-white",
  B: "bg-[var(--brand-500)] text-white",
  C: "bg-[var(--warning)] text-black",
  PASS: "bg-surface-2 text-muted",
};

const MARKETS = [
  { key: "strikeouts", label: "K" },
  { key: "pitcher_outs", label: "Outs" },
  { key: "hits_allowed", label: "Hits" },
  { key: "pitcher_walks", label: "BB" },
  { key: "earned_runs", label: "ER" },
  { key: "home_runs_allowed", label: "HR" },
];

export default function PickSelectorPage() {
  const [date] = useState(todayIso);
  const [minProbability, setMinProbability] = useState(0.58);
  const [minEdge, setMinEdge] = useState(0.08);
  const [minDataQuality, setMinDataQuality] = useState(0.8);
  const [requireLineupConfirmed, setRequireLineup] = useState(false);
  const [maxSamePlayer, setMaxSamePlayer] = useState(1);
  const [maxSameGame, setMaxSameGame] = useState(2);
  const [markets, setMarkets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PickSelectorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GradedPick | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const board = readBoard(date);
      if (board.length === 0) {
        setError("No imported board found. Import a PrizePicks board first.");
        setResult(null);
        return;
      }
      const res = await fetch("/api/pick-selector", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          board,
          filters: {
            markets: markets.length ? markets : undefined,
            minProbability, minEdge, minDataQuality, requireLineupConfirmed, maxSamePlayer, maxSameGame,
          },
        }),
      });
      if (!res.ok) throw new Error(`Selector failed (${res.status})`);
      const data = (await res.json()) as PickSelectorResult;
      setResult(data);
      setSelected(data.picks.find((p) => p.grade !== "PASS") ?? data.picks[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection failed");
    } finally {
      setLoading(false);
    }
  }, [date, markets, minProbability, minEdge, minDataQuality, requireLineupConfirmed, maxSamePlayer, maxSameGame]);

  const summary = result?.summary;
  const qualified = useMemo(
    () => (result ? [...result.groups.TOP, ...result.groups.STRONG, ...result.groups.PLAYABLE] : []),
    [result],
  );

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <header className="mb-6 flex items-center gap-3">
        <Target className="h-6 w-6 text-[var(--brand-500)]" />
        <div>
          <h1 className="text-xl font-semibold">Pick Selector</h1>
          <p className="text-sm text-muted">Find the highest-edge props across your imported board — data, models, and matchup gate every pick.</p>
        </div>
      </header>

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <KpiCard label="TOP (A+)" value={summary.counts.TOP} accent="var(--positive)" sub="Exceptional" />
          <KpiCard label="STRONG (A)" value={summary.counts.STRONG} accent="var(--positive)" sub="High-confidence edges" />
          <KpiCard label="PLAYABLE (B)" value={summary.counts.PLAYABLE} accent="var(--brand-500)" sub="Positive expected value" />
          <KpiCard label="PASS" value={summary.counts.PASS} accent="var(--muted)" sub="Insufficient edge or risk" />
          <KpiCard label="AVG EDGE" value={summary.averageEdge !== null ? `+${pct(summary.averageEdge)}` : "—"} accent="var(--positive)" sub="Across qualified picks" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Filters */}
        <aside className="rounded-xl border border-border bg-surface-1 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4" /> Filters</div>

          <FieldLabel>Markets</FieldLabel>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {MARKETS.map((m) => {
              const on = markets.includes(m.key);
              return (
                <button
                  key={m.key}
                  onClick={() => setMarkets((prev) => (on ? prev.filter((x) => x !== m.key) : [...prev, m.key]))}
                  className={cn("rounded-md border px-2.5 py-1 text-xs", on ? "border-[var(--brand-500)] bg-[var(--brand-500)]/15 text-[var(--brand-500)]" : "border-border text-muted")}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <Slider label="Minimum Probability" value={minProbability} onChange={setMinProbability} min={0.5} max={0.85} />
          <Slider label="Minimum Edge" value={minEdge} onChange={setMinEdge} min={0} max={0.35} />
          <Slider label="Minimum Data Quality" value={minDataQuality} onChange={setMinDataQuality} min={0.5} max={1} />

          <label className="mb-4 flex items-center justify-between text-xs">
            <span className="text-muted">Require Lineup Confirmed</span>
            <input type="checkbox" checked={requireLineupConfirmed} onChange={(e) => setRequireLineup(e.target.checked)} />
          </label>

          <NumField label="Max Same Player" value={maxSamePlayer} onChange={setMaxSamePlayer} />
          <NumField label="Max Same Game" value={maxSameGame} onChange={setMaxSameGame} />

          <button
            onClick={analyze}
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-500)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
            Analyze All Props
          </button>

          {result && (
            <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted">
              <Row k="Analyzed props" v={String(result.summary.total)} />
              <Row k="Qualified" v={String(qualified.length)} />
              <Row k="Pass" v={String(result.summary.counts.PASS)} />
              <Row k="Score model" v={result.scoreVersion} />
            </div>
          )}
        </aside>

        {/* Results + detail */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
          <section>
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm">
                <TriangleAlert className="h-4 w-4 text-[var(--warning)]" /> {error}
              </div>
            )}
            {!result && !error && (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
                Import a PrizePicks board, then <strong>Analyze All Props</strong> to rank every prop MORE / LESS / PASS.
              </div>
            )}
            {result && (
              <div className="space-y-6">
                <PickGroup title="Top Picks" picks={[...result.groups.TOP, ...result.groups.STRONG]} onSelect={setSelected} selected={selected} emptyNote="No A/A+ candidates — the board did not clear the bar. PASS is a valid result." />
                <PickGroup title="Playable" picks={result.groups.PLAYABLE} onSelect={setSelected} selected={selected} />
                <PickGroup title="Watch" picks={result.groups.WATCH} onSelect={setSelected} selected={selected} />
                <PickGroup title="Pass" picks={result.groups.PASS} onSelect={setSelected} selected={selected} muted />
              </div>
            )}
          </section>

          <aside>{selected && <PickDetail pick={selected} />}</aside>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: number | string; sub: string; accent: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: accent }}>{value}</div>
      <div className="text-[11px] text-muted-2">{sub}</div>
    </div>
  );
}

function PickGroup({ title, picks, onSelect, selected, muted, emptyNote }: {
  title: string; picks: GradedPick[]; onSelect: (p: GradedPick) => void; selected: GradedPick | null; muted?: boolean; emptyNote?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title} <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px]">{picks.length}</span>
      </div>
      {picks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-2">{emptyNote ?? "None."}</div>
      ) : (
        <div className="space-y-2">
          {picks.map((p) => (
            <button
              key={p.candidate.id}
              onClick={() => onSelect(p)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left",
                selected?.candidate.id === p.candidate.id ? "border-[var(--brand-500)] bg-[var(--brand-500)]/5" : "border-border bg-surface-1",
                muted && "opacity-70",
              )}
            >
              <span className={cn("grid h-8 w-9 shrink-0 place-items-center rounded-md text-xs font-bold", GRADE_STYLE[p.grade])}>{p.grade}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.candidate.playerName}</span>
                <span className="block truncate text-xs text-muted">
                  {p.candidate.direction.toUpperCase()} {p.candidate.line} {p.candidate.marketLabel ?? p.candidate.market}
                </span>
              </span>
              <span className="hidden shrink-0 text-right sm:block">
                <span className="block text-xs text-muted">P(side)</span>
                <span className="block text-sm font-semibold">{pct(p.candidate.selectedSideProbability)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs text-muted">Edge</span>
                <span className="block text-sm font-semibold text-[var(--positive)]">+{pct(p.edge)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs text-muted">Score</span>
                <span className="block text-sm font-semibold">{p.score.toFixed(0)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PickDetail({ pick }: { pick: GradedPick }) {
  const c = pick.candidate;
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{c.playerName}</div>
          <div className="text-xs text-muted">{c.direction.toUpperCase()} {c.line} {c.marketLabel ?? c.market}</div>
        </div>
        <span className={cn("grid h-9 w-11 place-items-center rounded-md text-sm font-bold", GRADE_STYLE[pick.grade])}>{pick.grade}</span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat k="Projection" v={c.projection !== undefined ? c.projection.toFixed(2) : "—"} />
        <Stat k="P(side)" v={pct(c.selectedSideProbability)} />
        <Stat k="Edge" v={`+${pct(pick.edge)}`} accent="var(--positive)" />
        <Stat k="Score" v={pick.score.toFixed(0)} />
      </div>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Quality Gates</div>
      <div className="space-y-1 text-xs">
        <Gate ok={c.selectedSideProbability >= 0.58} label={`Probability ${pct(c.selectedSideProbability)}`} />
        <Gate ok={pick.edge >= 0.08} label={`Edge +${pct(pick.edge)}`} />
        <Gate ok={c.dataQuality >= 0.8} label={`Data quality ${pct(c.dataQuality)}`} />
        <Gate ok={c.lineupConfirmed} label={c.lineupConfirmed ? "Lineup confirmed" : "Lineup projected"} />
        <Gate ok={c.uncertainty <= 0.6} label={`Uncertainty ${pct(c.uncertainty)}`} />
        <Gate ok={pick.betEligible} label={pick.betEligible ? "Firm bet eligible" : `Firm decision: ${c.decision}`} />
      </div>

      {pick.passReason && (
        <div className="mt-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2 text-xs">
          <span className="font-semibold">PASS — </span>{pick.passReason}
        </div>
      )}

      {pick.conflicts.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Correlation / Conflict</div>
          {pick.conflicts.map((x, i) => (
            <div key={i} className="mb-1 flex items-start gap-1.5 text-xs text-[var(--warning)]">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" /> <span>{x}</span>
            </div>
          ))}
        </div>
      )}

      {c.reasons && c.reasons.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Why</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
            {c.reasons.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* --- small presentational helpers --- */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs text-muted">{children}</div>;
}
function Slider({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between text-xs"><span className="text-muted">{label}</span><span className="font-semibold">{pct(value)}</span></div>
      <input type="range" min={min} max={max} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--brand-500)]" />
    </div>
  );
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="mb-3 flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-md border border-border bg-surface-2 px-2 py-1">
        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between"><span>{k}</span><span className="font-medium text-foreground">{v}</span></div>;
}
function Stat({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className="text-sm font-semibold" style={accent ? { color: accent } : undefined}>{v}</div>
    </div>
  );
}
function Gate({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", ok ? "bg-[var(--positive)]" : "bg-[var(--warning)]")} />
      <span className={ok ? "" : "text-muted"}>{label}</span>
    </div>
  );
}
