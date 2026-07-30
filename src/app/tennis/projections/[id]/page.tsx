import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Microscope } from "lucide-react";
import { getTennisMarket } from "@/lib/tennis/domain/markets";
import { ModelUnavailable } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";

/** The per-prediction outputs the engine produces once inputs exist. */
const OUTPUT_FIELDS = [
  "Projected mean", "Median", "Std deviation", "Quantiles",
  "Probability More", "Probability Less", "Probability Push",
  "Fair line", "Volatility", "Confidence", "Data quality",
];

export default async function TennisProjectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = getTennisMarket(id);
  if (!market) notFound();
  getTennisDataStatus();

  return (
    <div className="space-y-6">
      <Link href="/tennis/projections" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Prop Explorer
      </Link>

      <header className="glass rounded-2xl p-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-500">{market.group} market</div>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight">
          <Microscope className="h-6 w-6 text-brand-500" /> {market.label}
        </h1>
        <p className="mt-1 text-sm text-muted">{market.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          <span className="rounded-full border border-border bg-surface-2/50 px-2.5 py-1">Default line {market.defaultLine}</span>
          <span className="rounded-full border border-border bg-surface-2/50 px-2.5 py-1">Step {market.step}</span>
          <span className="rounded-full border border-border bg-surface-2/50 px-2.5 py-1">Unit {market.unit}</span>
          {market.structural && (
            <span className="rounded-full border border-brand-500/25 bg-brand-500/12 px-2.5 py-1 text-brand-500">
              Structural simulation
            </span>
          )}
        </div>
      </header>

      <ModelUnavailable label="Simulation engine pending inputs">
        A projection for {market.label.toLowerCase()} runs on the point → game → set → match
        simulator using verified serve/return inputs and Elo. Connect a live provider to
        produce it — no placeholder numbers are shown.
      </ModelUnavailable>

      <div className="glass rounded-2xl p-5">
        <h3 className="mb-3 text-sm font-semibold">Prediction outputs</h3>
        <div className="flex flex-wrap gap-2">
          {OUTPUT_FIELDS.map((f) => (
            <span key={f} className="rounded-full border border-border bg-surface-2/50 px-2.5 py-1 text-xs text-muted">
              {f}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-2">
          Probability, confidence and data quality stay separate concepts throughout.
        </p>
      </div>
    </div>
  );
}
