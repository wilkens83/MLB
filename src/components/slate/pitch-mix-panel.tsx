"use client";

import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/primitives";
import type { PitcherArsenal } from "@/lib/providers/arsenal";

export function PitchMixPanel({ pitcherId, title }: { pitcherId?: number; title: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["arsenal", pitcherId],
    queryFn: async () =>
      (await fetch(`/api/players/${pitcherId}/arsenal`)).json() as Promise<{ arsenal: PitcherArsenal | null }>,
    enabled: !!pitcherId,
  });

  if (!pitcherId) {
    return (
      <Card className="p-6 text-center text-sm text-muted">
        No pitcher resolved for a pitch-mix breakdown yet.
      </Card>
    );
  }
  if (isLoading) return <Skeleton className="h-64" />;
  const arsenal = data?.arsenal;
  if (!arsenal || arsenal.pitches.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted">No pitch-arsenal data for this pitcher this season.</Card>;
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-brand-500" />
        <h3 className="font-semibold">{title}</h3>
        <span className="ml-auto text-[11px] text-muted-2">Baseball Savant</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="py-2 pr-3 text-left font-medium">Pitch</th>
              <th className="px-2 py-2 text-right font-medium">Usage</th>
              <th className="px-2 py-2 text-right font-medium">Whiff%</th>
              <th className="px-2 py-2 text-right font-medium">PutAway%</th>
              <th className="px-2 py-2 text-right font-medium">BA</th>
              <th className="px-2 py-2 text-right font-medium">SLG</th>
              <th className="px-2 py-2 text-right font-medium">xwOBA</th>
            </tr>
          </thead>
          <tbody>
            {arsenal.pitches.map((p) => (
              <tr key={p.pitchType} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3">
                  <span className="font-medium">{p.pitchName}</span>{" "}
                  <span className="text-[11px] text-muted-2">{p.pitchType}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{p.usage !== undefined ? `${p.usage}%` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{p.whiffPct !== undefined ? `${p.whiffPct}%` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{p.putAwayPct !== undefined ? `${p.putAwayPct}%` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt3(p.baAllowed)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt3(p.slgAllowed)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt3(p.xwobaAllowed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-2">
        Velocity, spin rate, and movement come from a separate pitch-movement feed and are not yet
        wired — shown as available fields only.
      </p>
    </Card>
  );
}

function fmt3(v?: number) {
  return v === undefined ? "—" : v.toFixed(3).replace(/^0/, "");
}
