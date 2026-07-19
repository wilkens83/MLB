"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Clock, Flame, Circle } from "lucide-react";
import { TeamLogo } from "./team-logo";
import { Badge } from "@/components/ui/primitives";
import type { MlbGame } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";

function gameTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function GameCard({ game, index = 0 }: { game: MlbGame; index?: number }) {
  const { away, home } = game.teams;
  const state = game.status.abstractGameState;
  const isLive = state === "Live";
  const isFinal = state === "Final";
  const ls = game.linescore;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.3) }}
    >
      <Link
        href={`/games/${game.gamePk}`}
        className="glass group block rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow)]"
      >
        <div className="mb-3 flex items-center justify-between">
          {isLive ? (
            <Badge variant="negative" className="gap-1">
              <Circle className="h-2 w-2 animate-pulse fill-current" />
              {ls?.inningState} {ls?.currentInning}
            </Badge>
          ) : isFinal ? (
            <Badge variant="outline">Final</Badge>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Clock className="h-3 w-3" />
              {gameTime(game.gameDate)}
            </span>
          )}
          <span className="truncate text-[11px] text-muted-2">{game.venue?.name}</span>
        </div>

        <div className="space-y-2">
          <TeamRow
            teamId={away.team.id}
            name={away.team.name}
            score={away.score}
            pitcher={away.probablePitcher?.fullName}
            record={away.leagueRecord}
            winner={isFinal && away.isWinner}
            showScore={isLive || isFinal}
          />
          <TeamRow
            teamId={home.team.id}
            name={home.team.name}
            score={home.score}
            pitcher={home.probablePitcher?.fullName}
            record={home.leagueRecord}
            winner={isFinal && home.isWinner}
            showScore={isLive || isFinal}
          />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted">
            {game.seriesDescription ?? "Regular Season"}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-brand-500 opacity-0 transition-opacity group-hover:opacity-100">
            <Flame className="h-3 w-3" /> View props
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

function TeamRow({
  teamId,
  name,
  score,
  pitcher,
  record,
  winner,
  showScore,
}: {
  teamId: number;
  name: string;
  score?: number;
  pitcher?: string;
  record?: { wins: number; losses: number };
  winner?: boolean;
  showScore: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <TeamLogo teamId={teamId} name={name} size={30} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-semibold", winner && "text-brand-500")}>
          {name}
        </div>
        <div className="truncate text-[11px] text-muted">
          {pitcher ? `${pitcher}` : "TBD"}
          {record ? ` · ${record.wins}-${record.losses}` : ""}
        </div>
      </div>
      {showScore && (
        <div className={cn("text-lg font-bold tabular-nums", winner ? "text-foreground" : "text-muted")}>
          {score ?? 0}
        </div>
      )}
    </div>
  );
}
