"use client";

import { useState } from "react";
import { Plus, Trash2, Upload, FileDown, X, Keyboard, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { csvProvider, buildBoardEntry } from "@/lib/prizepicks/providers";
import { CSV_TEMPLATE, CSV_HEADER } from "@/lib/prizepicks/csv";
import { allMarkets } from "@/lib/prizepicks/market-map";
import type { PrizePicksBoardEntry, RawEntry, ProjectionType } from "@/lib/prizepicks/types";
import type { PrizePicksImportError } from "@/lib/prizepicks/types";

interface ManualRow {
  player: string;
  market: string;
  line: string;
  projectionType: ProjectionType;
  team: string;
  opponent: string;
  notes: string;
}

const emptyRow = (): ManualRow => ({ player: "", market: "Pitcher Strikeouts", line: "", projectionType: "standard", team: "", opponent: "", notes: "" });

export function ImportPanel({
  boardDate,
  onImport,
  onClose,
}: {
  boardDate: string;
  onImport: (entries: PrizePicksBoardEntry[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"manual" | "csv">("manual");

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="panel w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-bold">Import PrizePicks board · {boardDate}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex gap-1 border-b border-border px-4 pt-3">
          {(["manual", "csv"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium", tab === t ? "text-brand-500" : "text-muted hover:text-foreground")}
            >
              {t === "manual" ? <Keyboard className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {t === "manual" ? "Manual entry" : "CSV import"}
              {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === "manual" ? (
            <ManualTab boardDate={boardDate} onImport={onImport} onClose={onClose} />
          ) : (
            <CsvTab boardDate={boardDate} onImport={onImport} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function ManualTab({ boardDate, onImport, onClose }: { boardDate: string; onImport: (e: PrizePicksBoardEntry[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<ManualRow[]>([emptyRow()]);
  const markets = allMarkets();

  function update(i: number, patch: Partial<ManualRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function save() {
    const now = new Date().toISOString();
    const entries: PrizePicksBoardEntry[] = [];
    for (const row of rows) {
      if (!row.player.trim() || !row.line.trim()) continue;
      const raw: RawEntry = {
        boardDate,
        capturedAt: now,
        sourceType: "manual",
        rawPlayerName: row.player.trim(),
        teamAbbreviation: row.team.trim() || undefined,
        opponentAbbreviation: row.opponent.trim() || undefined,
        rawMarketLabel: row.market,
        line: Number(row.line),
        projectionType: row.projectionType,
        notes: row.notes.trim() || undefined,
      };
      if (!Number.isFinite(raw.line)) continue;
      entries.push(buildBoardEntry(raw));
    }
    if (entries.length) onImport(entries);
    onClose();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Enter the players and lines exactly as shown on your PrizePicks board. Nothing is submitted anywhere.</p>
      <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 rounded-lg border border-border p-2">
            <input value={row.player} onChange={(e) => update(i, { player: e.target.value })} placeholder="Player" className="col-span-4 h-8 rounded border border-border bg-surface px-2 text-sm outline-none" />
            <select value={row.market} onChange={(e) => update(i, { market: e.target.value })} className="col-span-3 h-8 rounded border border-border bg-surface px-1 text-xs outline-none">
              {markets.map((m) => <option key={m.canonical} value={m.label}>{m.label}</option>)}
            </select>
            <input value={row.line} onChange={(e) => update(i, { line: e.target.value })} placeholder="Line" inputMode="decimal" className="col-span-1 h-8 rounded border border-border bg-surface px-1 text-center text-sm tabular-nums outline-none" />
            <select value={row.projectionType} onChange={(e) => update(i, { projectionType: e.target.value as ProjectionType })} className="col-span-2 h-8 rounded border border-border bg-surface px-1 text-xs outline-none">
              <option value="standard">Standard</option>
              <option value="goblin">Goblin</option>
              <option value="demon">Demon</option>
            </select>
            <input value={row.team} onChange={(e) => update(i, { team: e.target.value })} placeholder="Tm" className="col-span-1 h-8 rounded border border-border bg-surface px-1 text-center text-xs uppercase outline-none" />
            <button onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))} className="col-span-1 grid h-8 place-items-center rounded border border-border text-muted hover:text-[var(--negative)]" aria-label="Remove row">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={() => setRows((r) => [...r, emptyRow()])} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover">
          <Plus className="h-3.5 w-3.5" /> Add row
        </button>
        <button onClick={save} className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-600">
          Save entries
        </button>
      </div>
    </div>
  );
}

function CsvTab({ boardDate, onImport, onClose }: { boardDate: string; onImport: (e: PrizePicksBoardEntry[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ entries: PrizePicksBoardEntry[]; errors: PrizePicksImportError[] } | null>(null);

  async function doPreview(csv: string) {
    const res = await csvProvider.importBoard(csv);
    setPreview({ entries: res.entries, errors: res.errors });
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diamond-prizepicks-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Paste CSV or upload a file. Header: <code className="text-[10px]">{CSV_HEADER}</code></p>
        <button onClick={downloadTemplate} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-surface-hover">
          <FileDown className="h-3 w-3" /> Template
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview(null); }}
        rows={6}
        placeholder={CSV_TEMPLATE}
        className="w-full rounded-lg border border-border bg-surface p-2 font-mono text-[11px] outline-none"
      />
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-hover">
        <Upload className="h-3.5 w-3.5" /> Upload .csv
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 512_000) { alert("File too large (max 500KB)."); return; }
            const t = await f.text();
            setText(t);
            void doPreview(t);
          }}
        />
      </label>

      {preview && (
        <div className="rounded-lg border border-border bg-surface-2/40 p-2 text-xs">
          <div className="mb-1 font-semibold">Preview: {preview.entries.length} valid · {preview.errors.length} errors</div>
          {preview.errors.length > 0 && (
            <ul className="mb-1 max-h-24 space-y-0.5 overflow-y-auto text-[var(--negative)]">
              {preview.errors.map((er, i) => <li key={i}>row {er.row}: {er.message}</li>)}
            </ul>
          )}
          <ul className="max-h-28 space-y-0.5 overflow-y-auto text-muted">
            {preview.entries.slice(0, 12).map((en) => (
              <li key={en.id}>{en.rawPlayerName} — {en.rawMarketLabel} {en.line} ({en.projectionType}){!en.marketKey && " ⚠ market review"}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button onClick={() => doPreview(text)} disabled={!text.trim()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-surface-hover">
          Preview
        </button>
        <button
          onClick={() => { if (preview?.entries.length) { onImport(preview.entries); onClose(); } }}
          disabled={!preview?.entries.length}
          className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-brand-600"
        >
          Import {preview?.entries.length ?? 0}
        </button>
      </div>
      <p className="text-[10px] text-muted-2">Board date {boardDate}. Imported values keep their source and capture timestamp; manual/CSV data is never shown as live.</p>
    </div>
  );
}
