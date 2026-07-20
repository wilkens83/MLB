"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/primitives";
import { Card } from "@/components/ui/card";
import type { PlayerSplit } from "@/lib/mlb/api";

const PAIRS: { title: string; codes: [string, string]; labels: [string, string] }[] = [
  { title: "Home / Away", codes: ["h", "a"], labels: ["Home", "Away"] },
  { title: "Day / Night", codes: ["d", "n"], labels: ["Day", "Night"] },
  { title: "vs LHP / RHP", codes: ["vl", "vr"], labels: ["vs LHP", "vs RHP"] },
];

export function SplitsPanel({ playerId }: { playerId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["splits", playerId],
    queryFn: async () =>
      (await fetch(`/api/players/${playerId}/splits`)).json() as Promise<{
        group: string;
        splits: PlayerSplit[];
      }>,
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!data || data.splits.length === 0)
    return <div className="glass rounded-2xl p-6 text-center text-sm text-muted">No split data this season.</div>;

  const byCode = Object.fromEntries(data.splits.map((s) => [s.code, s]));
  const isPitching = data.group === "pitching";

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {PAIRS.map((p) => (
        <Card key={p.title} className="p-4">
          <h4 className="mb-3 text-sm font-semibold">{p.title}</h4>
          <div className="space-y-3">
            {p.codes.map((code, i) => {
              const s = byCode[code];
              return (
                <div key={code} className="rounded-xl border border-border bg-surface-2/40 p-3">
                  <div className="mb-1 text-xs font-medium text-muted">{p.labels[i]}</div>
                  {s ? (
                    isPitching ? (
                      <div className="flex gap-4 text-sm tabular-nums">
                        <Stat label="ERA" value={s.era} />
                        <Stat label="WHIP" value={s.whip} />
                        <Stat label="IP" value={s.inningsPitched} />
                      </div>
                    ) : (
                      <div className="flex gap-4 text-sm tabular-nums">
                        <Stat label="AVG" value={s.avg} />
                        <Stat label="OPS" value={s.ops} />
                        <Stat label="HR" value={s.homeRuns?.toString()} />
                        <Stat label="AB" value={s.atBats?.toString()} />
                      </div>
                    )
                  ) : (
                    <span className="text-sm text-muted-2">N/A</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="font-semibold">{value ?? "—"}</div>
    </div>
  );
}
