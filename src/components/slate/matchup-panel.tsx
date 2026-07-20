"use client";

import { Swords, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PitcherStatcastPanel } from "@/components/prop/statcast-panel";
import type { AnalysisPayload } from "@/lib/mlb/analysis";

/**
 * Matchup analyzer — the opposing starter's real Statcast profile plus the
 * handedness matchup and how the opponent moved the projection. Pitch-type
 * arsenal (velocity/CSW by pitch) needs pitch-level data and is not yet wired;
 * it is labeled rather than faked.
 */
export function MatchupPanel({
  data,
  batterHand,
  season,
}: {
  data: AnalysisPayload;
  batterHand?: string;
  season: number;
}) {
  const opp = data.opponent;
  const oppFactor = data.breakdown?.factors.find((f) => f.key === "opponent");

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Swords className="h-4 w-4 text-brand-500" />
          <h3 className="font-semibold">Matchup</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Info label="Opposing starter" value={opp?.pitcherName ?? "TBD"} />
          <Info label="Venue" value={opp?.venueName ?? "—"} />
          <Info
            label="Handedness"
            value={batterHand ? `Bats ${batterHand}` : "—"}
          />
        </div>
        {oppFactor && (
          <p className="mt-3 text-xs text-muted">
            Opponent adjustment moved the projection by{" "}
            <span className={oppFactor.delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
              {oppFactor.delta >= 0 ? "+" : ""}
              {oppFactor.delta}
            </span>{" "}
            (×{oppFactor.multiplier}), derived from the starter&apos;s Statcast profile.
          </p>
        )}
        {!opp?.pitcherName && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <User className="h-3 w-3" /> No confirmed opposing starter yet — opponent adjustment is neutral.
          </p>
        )}
      </Card>

      <PitcherStatcastPanel
        pitcher={data.statcast.pitcher}
        season={season}
        title={opp?.pitcherName ? `${opp.pitcherName} · Statcast` : "Opposing starter · Statcast"}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{value}</div>
    </div>
  );
}
