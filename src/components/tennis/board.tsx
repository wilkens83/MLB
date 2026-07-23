"use client";

import { useState } from "react";
import { ClipboardList, Filter, Search } from "lucide-react";
import { TENNIS_MARKETS } from "@/lib/tennis/domain/markets";
import { ProviderNotConfigured, EmptyProjections } from "@/components/tennis/states";
import { cn } from "@/lib/utils";

const TOURS = [
  { key: "all", label: "All" },
  { key: "atp", label: "ATP" },
  { key: "wta", label: "WTA" },
  { key: "challenger", label: "Challenger" },
];

const SURFACES = [
  { key: "all", label: "All" },
  { key: "hard", label: "Hard" },
  { key: "clay", label: "Clay" },
  { key: "grass", label: "Grass" },
  { key: "indoor_hard", label: "Indoor Hard" },
];

const SORTS = [
  { key: "edge", label: "Highest Edge" },
  { key: "confidence", label: "Highest Confidence" },
  { key: "probability", label: "Highest Probability" },
  { key: "soonest", label: "Soonest" },
  { key: "movement", label: "Line Movement" },
];

/** The projection-card fields the board is prepared to display once modeled. */
const CARD_FIELDS = [
  "Player", "Opponent", "Tournament", "Surface", "Market", "PrizePicks line",
  "Model projection", "Probability More", "Probability Less", "Confidence",
  "Data Quality", "Volatility",
];

function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.key
              ? "border-brand-500/40 bg-brand-500/12 text-brand-500"
              : "border-border text-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TennisBoard({ liveConfigured }: { liveConfigured: boolean }) {
  const [tour, setTour] = useState("all");
  const [surface, setSurface] = useState("all");
  const [market, setMarket] = useState("all");
  const [sort, setSort] = useState("edge");
  const [query, setQuery] = useState("");

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <ClipboardList className="h-6 w-6 text-brand-500" /> PrizePicks Board
        </h1>
        <p className="mt-1 text-sm text-muted">
          Tennis projections against PrizePicks lines — More/Less probabilities, fair lines,
          confidence and data quality. Cards populate when a live slate and the model are wired.
        </p>
      </header>

      {/* Filter bar */}
      <div className="glass space-y-4 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-2">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Tour</span>
            <Segmented options={TOURS} value={tour} onChange={setTour} ariaLabel="Tour" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Surface</span>
            <Segmented options={SURFACES} value={surface} onChange={setSurface} ariaLabel="Surface" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Market</span>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm outline-none focus:border-brand-500/40"
            >
              <option value="all">All markets</option>
              {TENNIS_MARKETS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm outline-none focus:border-brand-500/40"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Player</span>
            <span className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search player…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
              />
            </span>
          </label>
        </div>
      </div>

      {/* Results */}
      {liveConfigured ? <EmptyProjections /> : <ProviderNotConfigured what="projections" />}

      {/* What each card will show — transparency, not fabricated data. */}
      <div className="glass rounded-2xl p-5">
        <h3 className="mb-3 text-sm font-semibold">Projection card fields</h3>
        <div className="flex flex-wrap gap-2">
          {CARD_FIELDS.map((f) => (
            <span key={f} className="rounded-full border border-border bg-surface-2/50 px-2.5 py-1 text-xs text-muted">
              {f}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-2">
          Probability, confidence and data quality are always shown as separate signals. When
          the model has no verified inputs, a card reads &ldquo;Model projection unavailable&rdquo;
          rather than showing a number.
        </p>
      </div>
    </div>
  );
}
