import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, MapPin } from "lucide-react";
import { getGame } from "@/lib/mlb/api";
import { TeamLogo } from "@/components/team-logo";
import { PlayerAvatar } from "@/components/player-avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/primitives";
import { parkFactor } from "@/lib/mlb/context";
import type { GameTeamSide } from "@/lib/mlb/types";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ gamePk: string }> }) {
  const { gamePk } = await params;
  const pk = Number(gamePk);
  if (!Number.isFinite(pk)) notFound();

  const game = await getGame(pk).catch(() => null);
  if (!game) notFound();

  const { away, home } = game.teams;
  const state = game.status;
  const pf = parkFactor(game.venue?.name);

  return (
    <div className="space-y-6">
      <Link href="/games" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Games
      </Link>

      <div className="glass rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-between text-sm">
          <Badge variant={state.abstractGameState === "Live" ? "negative" : "outline"}>
            {state.detailedState}
          </Badge>
          <span className="flex items-center gap-1 text-muted">
            <MapPin className="h-3.5 w-3.5" /> {game.venue?.name}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <TeamBlock side={away} align="start" />
          <div className="text-center">
            <div className="text-3xl font-black tabular-nums">
              {away.score ?? "–"} <span className="text-muted-2">:</span> {home.score ?? "–"}
            </div>
            <div className="mt-1 text-xs text-muted">
              {game.dayNight === "day" ? "Day game" : "Night game"}
            </div>
          </div>
          <TeamBlock side={home} align="end" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PitcherCard side={away} label="Away starter" />
        <PitcherCard side={home} label="Home starter" />
      </div>

      <Card className="p-5">
        <h3 className="mb-3 font-semibold">Park Environment · {game.venue?.name}</h3>
        <div className="grid grid-cols-3 gap-3">
          <ParkStat label="Runs factor" value={pf.runs} />
          <ParkStat label="HR factor" value={pf.hr} />
          <ParkStat label="Hits factor" value={pf.hits} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Factors above 1.00 favor offense at this venue and feed directly into player prop
          projections for this game.
        </p>
      </Card>
    </div>
  );
}

function TeamBlock({ side, align }: { side: GameTeamSide; align: "start" | "end" }) {
  return (
    <div className={`flex items-center gap-3 ${align === "end" ? "flex-row-reverse text-right" : ""}`}>
      <TeamLogo teamId={side.team.id} name={side.team.name} size={52} />
      <div>
        <div className="font-bold leading-tight">{side.team.name}</div>
        {side.leagueRecord && (
          <div className="text-xs text-muted">
            {side.leagueRecord.wins}-{side.leagueRecord.losses}
          </div>
        )}
      </div>
    </div>
  );
}

function PitcherCard({ side, label }: { side: GameTeamSide; label: string }) {
  const p = side.probablePitcher;
  return (
    <Card className="p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      {p ? (
        <Link href={`/players/${p.id}/analysis`} className="group mt-3 flex items-center gap-3">
          <PlayerAvatar playerId={p.id} name={p.fullName} teamId={side.team.id} size="lg" shape="rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold group-hover:text-brand-500">{p.fullName}</div>
            <div className="truncate text-sm text-muted">{side.team.name}</div>
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-brand-500 opacity-0 transition-opacity group-hover:opacity-100">
            <Zap className="h-4 w-4" aria-hidden /> Analyze
          </span>
        </Link>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <PlayerAvatar name="TBD" size="lg" shape="rounded" />
          <div className="text-lg font-semibold text-muted-2">Not confirmed</div>
        </div>
      )}
    </Card>
  );
}

function ParkStat({ label, value }: { label: string; value: number }) {
  const tone = value > 1.02 ? "text-[var(--positive)]" : value < 0.98 ? "text-[var(--negative)]" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3 text-center">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value.toFixed(2)}</div>
    </div>
  );
}
