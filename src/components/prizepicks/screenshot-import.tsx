"use client";

import { useMemo, useState } from "react";
import { ImagePlus, Trash2, Wand2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildBoardEntry } from "@/lib/prizepicks/providers";
import { allMarkets } from "@/lib/prizepicks/market-map";
import {
  extractScreenshots,
  splitPrimaryAndAlternatives,
  type ScreenshotExtraction,
} from "@/lib/prizepicks/screenshot";
import type { PrizePicksBoardEntry, RawEntry, ProjectionType } from "@/lib/prizepicks/types";

/** One uploaded screenshot: optional preview + the transcribed/reviewed text. */
interface ShotBlock {
  id: string;
  previewUrl?: string;
  fileName?: string;
  text: string;
}

/** A reviewable, editable market row derived from an extraction. */
interface ReviewRow {
  key: string;
  playerName: string;
  team?: string;
  position?: string;
  opponent?: string;
  gameTime?: string;
  rawMarketLabel: string;
  market: string; // canonical label (editable via select)
  line: string;
  projectionType: ProjectionType;
  alternativeLines: { line: number; projectionType: ProjectionType }[];
  sourceHistory: { value: number; opponent?: string; date?: string }[];
  sourceAverageL5?: number;
  needsReview: boolean;
  reviewReasons: string[];
  include: boolean;
}

const PLACEHOLDER = `Player:
Tanner Bibee
Team:
CLE
Position:
P
Opponent:
DET
Game time:
Tue 6:40 PM

Pitcher Strikeouts
Standard 4.5
Goblin 3.5
Demon 5.5

Hits Allowed
Standard 5.5
Demon 6.5`;

let uid = 0;
const nextId = () => `shot_${Date.now().toString(36)}_${uid++}`;

export function ScreenshotImportTab({
  boardDate,
  onImport,
  onClose,
}: {
  boardDate: string;
  onImport: (entries: PrizePicksBoardEntry[]) => void;
  onClose: () => void;
}) {
  const markets = useMemo(() => allMarkets(), []);
  const [shots, setShots] = useState<ShotBlock[]>([{ id: nextId(), text: "" }]);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const additions: ShotBlock[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8_000_000) { alert(`${f.name}: image too large (max 8MB).`); continue; }
      additions.push({ id: nextId(), previewUrl: URL.createObjectURL(f), fileName: f.name, text: "" });
    }
    if (additions.length) setShots((s) => [...s.filter((x) => x.text || x.previewUrl), ...additions]);
  }

  function updateShot(id: string, text: string) {
    setShots((s) => s.map((x) => (x.id === id ? { ...x, text } : x)));
  }
  function removeShot(id: string) {
    setShots((s) => {
      const target = s.find((x) => x.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = s.filter((x) => x.id !== id);
      return next.length ? next : [{ id: nextId(), text: "" }];
    });
  }

  function extract() {
    const texts = shots.map((s) => s.text).filter((t) => t.trim().length > 0);
    const merged: ScreenshotExtraction[] = texts.length ? extractScreenshots(texts) : [];
    const nextRows: ReviewRow[] = [];
    merged.forEach((ex, ei) => {
      ex.markets.forEach((m, mi) => {
        const { primary, alternatives } = splitPrimaryAndAlternatives(m.lines);
        const label = markets.find((x) => x.canonical === m.marketKey)?.label ?? m.rawMarketLabel;
        nextRows.push({
          key: `${ei}_${mi}`,
          playerName: ex.playerName,
          team: ex.team,
          position: ex.position,
          opponent: ex.opponent,
          gameTime: ex.gameTime,
          rawMarketLabel: m.rawMarketLabel,
          market: label,
          line: primary ? String(primary.line) : "",
          projectionType: primary?.projectionType ?? "standard",
          alternativeLines: alternatives.map((a) => ({ line: a.line, projectionType: a.projectionType })),
          sourceHistory: ex.history,
          sourceAverageL5: ex.averageL5,
          needsReview: m.needsReview || !ex.playerName || !primary,
          reviewReasons: [...ex.reviewReasons, ...m.reviewReasons],
          include: true,
        });
      });
    });
    setRows(nextRows);
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((r) => (r ? r.map((row) => (row.key === key ? { ...row, ...patch } : row)) : r));
  }

  function confirmImport() {
    if (!rows) return;
    const now = new Date().toISOString();
    const entries: PrizePicksBoardEntry[] = [];
    for (const row of rows) {
      if (!row.include) continue;
      if (!row.playerName.trim() || !row.line.trim()) continue;
      const line = Number(row.line);
      if (!Number.isFinite(line)) continue;
      const raw: RawEntry = {
        boardDate,
        capturedAt: now,
        sourceType: "reviewed-image-import",
        sourceReference: "screenshot",
        rawPlayerName: row.playerName.trim(),
        teamAbbreviation: row.team,
        opponentAbbreviation: row.opponent,
        rawMarketLabel: row.market,
        line,
        projectionType: row.projectionType,
        alternativeLines: row.alternativeLines.length ? row.alternativeLines : undefined,
        sourceHistory: row.sourceHistory.length ? row.sourceHistory : undefined,
        sourceAverageL5: row.sourceAverageL5,
        gameStartTime: row.gameTime,
        notes: row.needsReview ? "imported from screenshot — review flagged" : undefined,
      };
      entries.push(buildBoardEntry(raw));
    }
    if (entries.length) onImport(entries);
    onClose();
  }

  const includeCount = rows?.filter((r) => r.include && r.playerName && r.line).length ?? 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Upload your PrizePicks screenshot(s) and paste the text you see for each. Diamond Edge does not
        read pixels or scrape PrizePicks — the image is kept only as your reference, and the text you
        review below is what gets imported. Multiple screenshots for the same player/game are merged.
      </p>

      {/* Screenshot blocks */}
      {rows === null && (
        <>
          <div className="space-y-2">
            {shots.map((shot, i) => (
              <div key={shot.id} className="rounded-lg border border-border p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  {shot.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shot.previewUrl} alt={shot.fileName ?? "screenshot"} className="h-12 w-12 rounded border border-border object-cover" />
                  ) : (
                    <div className="grid h-12 w-12 place-items-center rounded border border-dashed border-border text-muted-2">
                      <ImagePlus className="h-4 w-4" />
                    </div>
                  )}
                  <span className="truncate text-[11px] text-muted">{shot.fileName ?? `Screenshot ${i + 1}`}</span>
                  <button onClick={() => removeShot(shot.id)} className="ml-auto grid h-7 w-7 place-items-center rounded border border-border text-muted hover:text-[var(--negative)]" aria-label="Remove screenshot">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={shot.text}
                  onChange={(e) => updateShot(shot.id, e.target.value)}
                  rows={5}
                  placeholder={i === 0 ? PLACEHOLDER : "Paste this screenshot's text…"}
                  className="w-full rounded-lg border border-border bg-surface p-2 font-mono text-[11px] outline-none"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-hover">
              <ImagePlus className="h-3.5 w-3.5" /> Add screenshot(s)
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </label>
            <button onClick={() => setShots((s) => [...s, { id: nextId(), text: "" }])} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-hover">
              Add text block
            </button>
            <button
              onClick={extract}
              disabled={!shots.some((s) => s.text.trim())}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-brand-600"
            >
              <Wand2 className="h-3.5 w-3.5" /> Extract &amp; review
            </button>
          </div>
        </>
      )}

      {/* Review step */}
      {rows !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold">Review extracted picks · {rows.length} found</div>
            <button onClick={() => setRows(null)} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-foreground">
              <X className="h-3 w-3" /> Back to upload
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface-2/40 p-3 text-xs text-muted">
              Nothing could be extracted. Check the pasted text and try again.
            </div>
          ) : (
            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => (
                <div key={row.key} className={cn("rounded-lg border p-2.5", row.needsReview ? "border-[var(--warning)]/40 bg-[var(--warning)]/5" : "border-border")}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <input type="checkbox" checked={row.include} onChange={(e) => updateRow(row.key, { include: e.target.checked })} className="h-3.5 w-3.5" />
                    <input
                      value={row.playerName}
                      onChange={(e) => updateRow(row.key, { playerName: e.target.value })}
                      placeholder="Player"
                      className="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs outline-none"
                    />
                    <input
                      value={row.team ?? ""}
                      onChange={(e) => updateRow(row.key, { team: e.target.value.toUpperCase() || undefined })}
                      placeholder="Tm"
                      className="h-7 w-12 rounded border border-border bg-surface px-1 text-center text-[11px] uppercase outline-none"
                    />
                    <input
                      value={row.opponent ?? ""}
                      onChange={(e) => updateRow(row.key, { opponent: e.target.value.toUpperCase() || undefined })}
                      placeholder="Opp"
                      className="h-7 w-12 rounded border border-border bg-surface px-1 text-center text-[11px] uppercase outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select value={row.market} onChange={(e) => updateRow(row.key, { market: e.target.value })} className="h-7 flex-1 rounded border border-border bg-surface px-1 text-xs outline-none">
                      {!markets.some((m) => m.label === row.market) && <option value={row.market}>{row.rawMarketLabel || "— select market —"}</option>}
                      {markets.map((m) => <option key={m.canonical} value={m.label}>{m.label}</option>)}
                    </select>
                    <input
                      value={row.line}
                      onChange={(e) => updateRow(row.key, { line: e.target.value })}
                      placeholder="Line"
                      inputMode="decimal"
                      className="h-7 w-14 rounded border border-border bg-surface px-1 text-center text-xs tabular-nums outline-none"
                    />
                    <select value={row.projectionType} onChange={(e) => updateRow(row.key, { projectionType: e.target.value as ProjectionType })} className="h-7 w-24 rounded border border-border bg-surface px-1 text-xs outline-none">
                      <option value="standard">Standard</option>
                      <option value="goblin">Goblin</option>
                      <option value="demon">Demon</option>
                    </select>
                  </div>

                  {/* Alternative thresholds (same market) */}
                  {row.alternativeLines.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted">
                      <span className="font-semibold uppercase tracking-wide">Alt lines:</span>
                      {row.alternativeLines.map((a, i) => (
                        <span key={i} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 tabular-nums capitalize">
                          {a.projectionType} {a.line}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* PrizePicks source history (never a model input) */}
                  {(row.sourceHistory.length > 0 || row.sourceAverageL5 !== undefined) && (
                    <div className="mt-1 text-[10px] text-muted-2">
                      PP history: {row.sourceHistory.map((h) => h.value).join(", ") || "—"}
                      {row.sourceAverageL5 !== undefined && <> · L5 avg {row.sourceAverageL5}</>}
                    </div>
                  )}

                  {row.needsReview && (
                    <div className="mt-1.5 flex items-start gap-1 text-[10px] text-[var(--warning)]">
                      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                      <span>Needs review: {row.reviewReasons.join("; ") || "verify fields"}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setRows(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover">
              Back
            </button>
            <button
              onClick={confirmImport}
              disabled={includeCount === 0}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-brand-600"
            >
              Import {includeCount}
            </button>
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted-2">
        Board date {boardDate}. Screenshot values keep their source (reviewed image import) and capture
        time; PrizePicks history is source metadata only and never replaces official MLB data.
      </p>
    </div>
  );
}
