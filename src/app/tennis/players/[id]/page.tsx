import Link from "next/link";
import { ArrowLeft, User, Waypoints, Gauge, LineChart, Trophy, Info } from "lucide-react";
import { NoticeCard } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";

const PROFILE_FIELDS = ["Country", "Age", "Hand", "Tour", "Ranking", "Ranking points"];
const SERVE_FIELDS = ["Aces / match", "Double faults / match", "First serve %", "1st serve won %", "2nd serve won %", "Hold %"];
const RETURN_FIELDS = ["Return points won", "Break points created", "Break conversion", "Break %"];
const FORM_FIELDS = ["L5", "L10", "Season", "Same surface"];

function FieldGrid({ fields }: { fields: string[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {fields.map((f) => (
        <div key={f}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{f}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-muted-2">Unavailable</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

export default async function TennisPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getTennisDataStatus();

  return (
    <div className="space-y-6">
      <Link href="/tennis/players" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Players
      </Link>

      <header className="glass flex flex-wrap items-center gap-4 rounded-2xl p-5">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-muted">
          <User className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">Player</h1>
          <p className="mt-1 font-mono text-xs text-muted-2">id {id}</p>
        </div>
      </header>

      <NoticeCard icon={Info} title="Player identity unresolved" tone="neutral">
        No canonical identity is resolved for this reference in the current environment.
        Diamond Edge never joins players by name alone, so the profile below shows the
        interface it renders once a live provider resolves the player across sources.
      </NoticeCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Profile" icon={<User className="h-4 w-4 text-brand-500" />}>
          <FieldGrid fields={PROFILE_FIELDS} />
        </Section>
        <Section title="Surface splits & form" icon={<LineChart className="h-4 w-4 text-brand-500" />}>
          <FieldGrid fields={FORM_FIELDS} />
        </Section>
        <Section title="Serve statistics" icon={<Waypoints className="h-4 w-4 text-brand-500" />}>
          <FieldGrid fields={SERVE_FIELDS} />
        </Section>
        <Section title="Return statistics" icon={<Gauge className="h-4 w-4 text-brand-500" />}>
          <FieldGrid fields={RETURN_FIELDS} />
        </Section>
      </div>

      <Section title="Elo & historical predictions" icon={<Trophy className="h-4 w-4 text-brand-500" />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {["Overall Elo", "Surface Elo (Hard)", "Surface Elo (Clay)", "Surface Elo (Grass)"].map((f) => (
            <div key={f}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{f}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-muted-2">Unavailable</dd>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          Overall and per-surface Elo, plus this player&apos;s historical model predictions,
          appear here once rated match history is loaded. No ratings are fabricated.
        </p>
      </Section>
    </div>
  );
}
