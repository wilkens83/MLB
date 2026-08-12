"use client";

import { ArrowUp, ArrowDown, Minus, GitBranch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, formatSigned } from "@/lib/utils";
import type { AdjustmentBreakdown } from "@/lib/domain/models";

/**
 * Explainable projection: a waterfall from the player's base expectation to the
 * final projection, itemizing every context factor that moved it.
 */
export function BreakdownCard({
  breakdown,
  unit,
  modeledBy,
}: {
  breakdown: AdjustmentBreakdown;
  unit: string;
  modeledBy?: "plate-appearance" | "marginal" | "pitcher-joint";
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-brand-500" />
        <h3 className="font-semibold">Why this projection</h3>
        {modeledBy && (
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            {modeledBy === "plate-appearance" ? "PA simulation" : "Marginal model"}
          </span>
        )}
      </div>

      <Row label="Base expectation" value={breakdown.base} unit={unit} kind="base" />
      {breakdown.factors.map((f) => (
        <Row key={f.key} label={f.label} value={f.delta} unit={unit} kind={f.direction} multiplier={f.multiplier} />
      ))}
      <div className="mt-2 border-t border-border pt-2">
        <Row label="Final projection" value={breakdown.final} unit={unit} kind="final" />
      </div>
      {breakdown.factors.length === 0 && (
        <p className="mt-2 text-xs text-muted">
          No context adjustments available for this market — projection reflects the player&apos;s own
          recency-weighted rate.
        </p>
      )}
    </Card>
  );
}

function Row({
  label,
  value,
  unit,
  kind,
  multiplier,
}: {
  label: string;
  value: number;
  unit: string;
  kind: "base" | "final" | "up" | "down" | "neutral";
  multiplier?: number;
}) {
  const isFactor = kind === "up" || kind === "down" || kind === "neutral";
  const Icon = kind === "up" ? ArrowUp : kind === "down" ? ArrowDown : Minus;
  const tone =
    kind === "up" ? "text-[var(--positive)]" : kind === "down" ? "text-[var(--negative)]" : "text-muted";

  return (
    <div className="flex items-center gap-3 py-1.5">
      {isFactor ? (
        <span className={cn("grid h-5 w-5 place-items-center rounded-full bg-surface-2", tone)}>
          <Icon className="h-3 w-3" />
        </span>
      ) : (
        <span className="h-5 w-5" />
      )}
      <span className={cn("flex-1 text-sm", kind === "final" || kind === "base" ? "font-semibold" : "text-muted")}>
        {label}
        {multiplier !== undefined && <span className="ml-1.5 text-[11px] text-muted-2">×{multiplier.toFixed(3)}</span>}
      </span>
      <span
        className={cn(
          "tabular-nums",
          kind === "final" ? "text-lg font-bold text-brand-500" : kind === "base" ? "font-semibold" : cn("text-sm", tone),
        )}
      >
        {isFactor ? formatSigned(value, 3) : value.toFixed(2)}{" "}
        <span className="text-[11px] font-normal text-muted-2">{unit}</span>
      </span>
    </div>
  );
}
