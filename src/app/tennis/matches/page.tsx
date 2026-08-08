import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { StaleDataBadge } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";
import { getFreeDataset } from "@/lib/tennis/data/freeDataset";
import type { TennisMatch } from "@/lib/tennis/domain";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SURFACE_TONE: Record<string, string> = {
  hard: "text-[var(--info)]", clay: "text-[var(--warning)]", grass: "text-[var(--positive)]", carpet: "text-muted",
};
const ROUND_LABEL: Record<string, string> = {
  final: "Final", semifinal: "SF", quarterfinal: "QF", r16: "R16", r32: "R32", r64: "R64", r128: "R128", qualifying: "Qual",
};

function scoreLine(m: TennisMatch): string {
  return m.sets.map((s) => `${s.homeGames}-${s.awayGames}${s.awayTiebreak !== undefined || s.homeTiebreak !== undefined ? `(${Math.min(s.homeTiebreak ?? 99, s.awayTiebreak ?? 99)})` : ""}`).join(" ");
}

export default function TennisMatchesPage() {
  const status = getTennisDataStatus();
  const ds = getFreeDataset();
  const matches = [...ds.matches]
    .filter((m) => m.state === "completed" || m.state === "retired")
    .sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <CalendarDays className="h-6 w-6 text-brand-500" /> Matches
          </h1>
          <StaleDataBadge label={`Historical · ${status.dataMode.label}`} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Completed ATP/WTA matches from the free historical dataset with tournament, round,
          surface, score and winner.
          {!status.liveConfigured && " No paid live feed is connected — today's automated slate needs a provider key; this is real historical data."}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map((m) => {
          const winner = m.home.isWinner ? m.home : m.away.isWinner ? m.away : undefined;
          return (
            <Link
              key={m.id}
              href={`/tennis/matches/${encodeURIComponent(m.id)}`}
              className="glass group rounded-2xl p-5 transition hover:border-brand-500/40"
            >
              <div className="mb-2 flex items-center justify-between text-xs text-muted-2">
                <span>{m.tournament?.name ?? m.tournamentId.replace(/^.*?:/, "")}</span>
                <span className={SURFACE_TONE[m.surface] ?? "text-muted"}>
                  {ROUND_LABEL[m.round] ?? m.round} · {m.surface}
                </span>
              </div>
              <div className="space-y-1">
                <PlayerRow name={m.home.playerName} won={m.home.isWinner === true} />
                <PlayerRow name={m.away.playerName} won={m.away.isWinner === true} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="tabular-nums text-muted">{scoreLine(m) || "score n/a"}</span>
                <span className="text-muted-2">{(m.startTime ?? "").slice(0, 10)}</span>
              </div>
              {winner && (
                <p className="mt-1 text-[11px] text-[var(--positive)]">def. — {winner.playerName} won</p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PlayerRow({ name, won }: { name: string; won: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={won ? "font-semibold" : "text-muted"}>{name}</span>
      {won && <span className="text-[10px] uppercase tracking-wide text-[var(--positive)]">W</span>}
    </div>
  );
}
