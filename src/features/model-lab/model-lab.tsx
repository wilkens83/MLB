/* ============================================================================
   Model Lab (read-only, minimal). Runs a REAL walk-forward backtest over a small
   featured set of players on demand and renders per-model Brier / log loss / MAE,
   calibration bins, and by-prop / by-disagreement / by-data-quality segments.

   No fake demo metrics: numbers come only from a live run. Thin samples are
   flagged and superiority is never claimed from a small N. The backtest is
   network-heavy, so it runs on an explicit click, not on every page view.
   ========================================================================== */

"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Loader2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// A small featured set (hitters + a pitcher) across three markets.
const FEATURED = {
  playerIds: [592450, 660271, 665742, 694973, 668678],
  propKeys: ["hits", "total_bases", "strikeouts"],
  minimumHistory: 20,
};

interface ModelPerf {
  modelId: string; count: number; brier: number; logLoss: number;
  mae: number | null; rmse: number | null; calibrationError: number | null;
}
interface Report {
  predictions: number;
  models: ModelPerf[];
  byProp: Record<string, ModelPerf[]>;
  byDisagreement: Record<string, ModelPerf>;
  byDataQuality: Record<string, ModelPerf>;
  calibrationBins: { bucket: string; n: number; predicted: number; observed: number }[];
  warnings: string[];
  seriesBuilt?: number;
}

const MIN_SAMPLE = 30;

export function ModelLab() {
  const [ran, setRan] = useState(false);
  const mutation = useMutation({
    mutationFn: async (): Promise<Report> => {
      const res = await fetch("/api/backtest", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(FEATURED),
      });
      if (!res.ok) throw new Error("backtest request failed");
      return res.json();
    },
  });

  const report = mutation.data;

  return (
    <div className="space-y-5">
      <div className="panel p-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          <FlaskConical className="h-3 w-3" /> Model Lab
        </div>
        <h1 className="text-2xl font-black tracking-tight">Walk-forward measurement</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          A strictly chronological, leakage-free backtest that scores each model —
          <span className="font-medium text-foreground"> baseline, marginal, ensemble</span> —
          separately. The question it answers: does the ensemble actually beat the
          baseline? Numbers are real; a thin sample is flagged, never spun into a claim.
        </p>
        <button
          onClick={() => { setRan(true); mutation.mutate(); }}
          disabled={mutation.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          {mutation.isPending ? "Running walk-forward…" : ran ? "Re-run backtest" : "Run backtest (featured players)"}
        </button>
        <p className="mt-2 text-[11px] text-muted-2">
          Featured: {FEATURED.playerIds.length} players × {FEATURED.propKeys.join(", ")} · min history {FEATURED.minimumHistory} games · live MLB game logs.
        </p>
      </div>

      {mutation.isError && (
        <div className="panel p-4 text-sm text-muted">Backtest temporarily unavailable. Nothing is shown rather than a fabricated metric.</div>
      )}

      {report && (
        <>
          {report.predictions < MIN_SAMPLE && (
            <div className="panel flex items-start gap-2 p-3 text-xs text-[var(--warning)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Insufficient historical point-in-time predictions ({report.predictions} prediction-games) to establish ensemble superiority. Interpret with caution.
            </div>
          )}

          <ModelTable title={`Overall — ${report.predictions} prediction-games (${report.seriesBuilt ?? "?"} series)`} models={report.models} />

          {report.calibrationBins.length > 0 && (
            <section className="panel p-4">
              <SectionTitle>Ensemble Calibration</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-2">
                      <th className="pb-1.5 font-semibold">Predicted bucket</th>
                      <th className="pb-1.5 text-right font-semibold">N</th>
                      <th className="pb-1.5 text-right font-semibold">Mean predicted</th>
                      <th className="pb-1.5 text-right font-semibold">Observed hit rate</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {report.calibrationBins.map((b) => (
                      <tr key={b.bucket} className="border-t border-border/60">
                        <td className="py-1.5 font-medium">{b.bucket}</td>
                        <td className="py-1.5 text-right text-muted">{b.n}</td>
                        <td className="py-1.5 text-right">{(b.predicted * 100).toFixed(1)}%</td>
                        <td className="py-1.5 text-right">{(b.observed * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 flex items-start gap-1 text-[10px] text-muted-2"><Info className="mt-px h-3 w-3 shrink-0" />Predicted probability is the raw model probability — calibration would map predicted → observed; a fitted calibrator requires more graded history.</p>
            </section>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SegmentCard title="By Disagreement (ensemble)" seg={report.byDisagreement} note="Does higher model disagreement actually track lower reliability? Measured, not assumed." />
            <SegmentCard title="By Data Quality (ensemble)" seg={report.byDataQuality} note="Does the data-quality proxy correlate with better forecasts? Measured, not assumed." />
          </div>

          {Object.entries(report.byProp).map(([prop, models]) => (
            <ModelTable key={prop} title={`Market — ${prop}`} models={models} />
          ))}

          {report.warnings.length > 0 && (
            <div className="panel p-3 text-[11px] text-muted-2">
              {report.warnings.map((w, i) => <div key={i}>· {w}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModelTable({ title, models }: { title: string; models: ModelPerf[] }) {
  // Highlight the lowest Brier (best) among scored models.
  const bestBrier = Math.min(...models.filter((m) => m.count > 0).map((m) => m.brier));
  return (
    <section className="panel p-4">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-2">
              <th className="pb-1.5 font-semibold">Model</th>
              <th className="pb-1.5 text-right font-semibold">N</th>
              <th className="pb-1.5 text-right font-semibold">Brier ↓</th>
              <th className="pb-1.5 text-right font-semibold">Log loss ↓</th>
              <th className="pb-1.5 text-right font-semibold">MAE ↓</th>
              <th className="pb-1.5 text-right font-semibold">Calib err ↓</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {models.map((m) => (
              <tr key={m.modelId} className="border-t border-border/60">
                <td className="py-1.5 font-medium capitalize">{m.modelId}</td>
                <td className="py-1.5 text-right text-muted">{m.count}</td>
                <td className={cn("py-1.5 text-right", m.count > 0 && m.brier === bestBrier && "font-bold text-[var(--positive)]")}>{m.brier.toFixed(4)}</td>
                <td className="py-1.5 text-right">{m.logLoss.toFixed(4)}</td>
                <td className="py-1.5 text-right">{m.mae === null ? "—" : m.mae.toFixed(3)}</td>
                <td className="py-1.5 text-right">{m.calibrationError === null ? "—" : m.calibrationError.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SegmentCard({ title, seg, note }: { title: string; seg: Record<string, ModelPerf>; note: string }) {
  const rows = Object.entries(seg);
  return (
    <section className="panel p-4">
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-2">No segment data.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-2">
              <th className="pb-1.5 font-semibold">Segment</th>
              <th className="pb-1.5 text-right font-semibold">N</th>
              <th className="pb-1.5 text-right font-semibold">Brier</th>
              <th className="pb-1.5 text-right font-semibold">Calib err</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map(([k, m]) => (
              <tr key={k} className="border-t border-border/60">
                <td className="py-1.5 font-medium capitalize">{k}</td>
                <td className="py-1.5 text-right text-muted">{m.count}</td>
                <td className="py-1.5 text-right">{m.brier.toFixed(4)}</td>
                <td className="py-1.5 text-right">{m.calibrationError === null ? "—" : m.calibrationError.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 flex items-start gap-1 text-[10px] text-muted-2"><Info className="mt-px h-3 w-3 shrink-0" />{note}</p>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wider">{children}</h3>;
}
