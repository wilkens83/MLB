"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { GameLogRow } from "@/app/api/players/[id]/gamelog/route";

const BATTER_COLS: { key: keyof GameLogRow; label: string }[] = [
  { key: "hits", label: "H" },
  { key: "singles", label: "1B" },
  { key: "doubles", label: "2B" },
  { key: "triples", label: "3B" },
  { key: "homeRuns", label: "HR" },
  { key: "totalBases", label: "TB" },
  { key: "runs", label: "R" },
  { key: "rbi", label: "RBI" },
  { key: "walks", label: "BB" },
  { key: "strikeOuts", label: "SO" },
  { key: "stolenBases", label: "SB" },
  { key: "fantasyPoints", label: "FP" },
];
const PITCHER_COLS: { key: keyof GameLogRow; label: string }[] = [
  { key: "outs", label: "Outs" },
  { key: "strikeOuts", label: "K" },
  { key: "hitsAllowed", label: "H" },
  { key: "pitcherWalks", label: "BB" },
  { key: "earnedRuns", label: "ER" },
];

export function GameLogTable({
  playerId,
  propKey,
  line,
}: {
  playerId: number;
  propKey?: string;
  line?: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["gamelog", playerId],
    queryFn: async () =>
      (await fetch(`/api/players/${playerId}/gamelog`)).json() as Promise<{
        isPitcher: boolean;
        rows: GameLogRow[];
      }>,
  });

  if (isLoading) return <Skeleton className="h-72" />;
  if (!data || data.rows.length === 0)
    return <div className="glass rounded-2xl p-6 text-center text-sm text-muted">No game log this season.</div>;

  const cols = data.isPitcher ? PITCHER_COLS : BATTER_COLS;
  const propColKey = propKeyToCol(propKey);

  return (
    <div className="glass overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th className="px-3 py-2.5 text-left font-medium">Date</th>
            <th className="px-3 py-2.5 text-left font-medium">Opp</th>
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-2.5 text-right font-medium tabular-nums">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => {
            const propVal = propColKey ? (r[propColKey] as number | undefined) : undefined;
            const hit = propVal !== undefined && line !== undefined ? propVal > line : undefined;
            return (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-surface-2/40">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{r.date?.slice(5)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">
                  {r.isHome ? "vs" : "@"} {abbr(r.opponent)}
                </td>
                {cols.map((c) => {
                  const isPropCol = c.key === propColKey;
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        isPropCol && hit === true && "font-bold text-[var(--positive)]",
                        isPropCol && hit === false && "font-bold text-[var(--negative)]",
                      )}
                    >
                      {r[c.key] as number}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function propKeyToCol(propKey?: string): keyof GameLogRow | undefined {
  const map: Record<string, keyof GameLogRow> = {
    hits: "hits",
    singles: "singles",
    doubles: "doubles",
    triples: "triples",
    home_runs: "homeRuns",
    total_bases: "totalBases",
    runs: "runs",
    rbis: "rbi",
    walks: "walks",
    batter_strikeouts: "strikeOuts",
    steals: "stolenBases",
    fantasy_points: "fantasyPoints",
    strikeouts: "strikeOuts",
    pitcher_outs: "outs",
    earned_runs: "earnedRuns",
    hits_allowed: "hitsAllowed",
    pitcher_walks: "pitcherWalks",
  };
  return propKey ? map[propKey] : undefined;
}

function abbr(name?: string) {
  if (!name) return "—";
  const parts = name.split(" ");
  return parts[parts.length - 1].slice(0, 4);
}
