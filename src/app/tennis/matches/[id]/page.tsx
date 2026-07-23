import Link from "next/link";
import { ArrowLeft, Swords, Radar, Waypoints, LineChart, Gauge, Info } from "lucide-react";
import { ComparisonCard, type CompareRow } from "@/components/tennis/comparison";
import { ModelUnavailable, NoticeCard } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";

const RANKING_ELO: CompareRow[] = [
  { label: "Ranking", higherBetter: false },
  { label: "Overall Elo" },
  { label: "Surface Elo" },
];

const SERVE_ROWS: CompareRow[] = [
  { label: "Aces" },
  { label: "Double Faults", higherBetter: false },
  { label: "First Serve %" },
  { label: "1st Serve Won %" },
  { label: "2nd Serve Won %" },
  { label: "Hold %" },
];

const RETURN_ROWS: CompareRow[] = [
  { label: "Return Points Won" },
  { label: "Break Points Created" },
  { label: "Break Conversion" },
];

const FORM_ROWS: CompareRow[] = [
  { label: "L5" },
  { label: "L10" },
  { label: "Season" },
  { label: "Same Surface" },
];

export default async function TennisMatchAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getTennisDataStatus(); // touch provider readiness (no live source ⇒ scaffolded)

  return (
    <div className="space-y-6">
      <Link href="/tennis/matches" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Matches
      </Link>

      <header className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-2">
          <span className="font-mono">Match {id}</span>
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight">
          <Swords className="h-6 w-6 text-brand-500" /> Match Analysis
        </h1>
        <p className="mt-1 text-sm text-muted">
          Player comparison across ranking, Elo, serve, return and surface form, plus the
          structural model output — rendered from resolved match inputs.
        </p>
      </header>

      <NoticeCard icon={Info} title="Match not resolved" tone="neutral">
        This match reference has no resolved data in the current environment. The full
        analysis below is the interface it renders once a live provider supplies the fixture
        and both players resolve to canonical identities.
      </NoticeCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ComparisonCard title="Ranking & Elo" icon={<Radar className="h-4 w-4 text-brand-500" />} rows={RANKING_ELO} />
        <ComparisonCard title="Surface form" icon={<LineChart className="h-4 w-4 text-brand-500" />} rows={FORM_ROWS} />
        <ComparisonCard title="Serve comparison" icon={<Waypoints className="h-4 w-4 text-brand-500" />} rows={SERVE_ROWS} />
        <ComparisonCard title="Return comparison" icon={<Gauge className="h-4 w-4 text-brand-500" />} rows={RETURN_ROWS} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">Model</h2>
        <ModelUnavailable label="Simulation engine pending inputs">
          The point → game → set → match simulator produces match winner, set scores, total
          games, aces and double faults for this fixture once verified serve/return inputs and
          Elo ratings are available. No probabilities are shown until then.
        </ModelUnavailable>
      </section>
    </div>
  );
}
