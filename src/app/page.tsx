import { Activity } from "lucide-react";
import { ScoreboardDashboard } from "@/features/dashboard/scoreboard-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
  // Server-local date — matches how `getTodaysGames()` resolves the slate.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-brand-500" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">MLB Scoreboard</h2>
      </div>
      <ScoreboardDashboard initialDate={today} />
    </div>
  );
}
