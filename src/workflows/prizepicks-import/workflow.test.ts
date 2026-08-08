import { describe, it, expect } from "bun:test";
import { runPrizePicksImportWorkflow } from "./workflow";
import type { ImportDeps } from "./types";
import { InMemoryLineSnapshotStore } from "@/lib/prizepicks/ingestion/snapshotStore";
import type { CanonicalLineSnapshot } from "@/lib/prizepicks/ingestion/snapshot";
import type { PlayerCandidate, PrizePicksPlayerResolution } from "@/lib/prizepicks/types";
import type { GameResolution } from "@/lib/prizepicks/player-resolver";

const JUDGE: PlayerCandidate = { mlbPlayerId: 592450, fullName: "Aaron Judge", position: "RF", isPitcher: false, teamId: 147, teamName: "New York Yankees" };
const SKENES: PlayerCandidate = { mlbPlayerId: 694973, fullName: "Paul Skenes", position: "P", isPitcher: true, teamId: 134, teamName: "Pittsburgh Pirates" };

/** Deterministic mock resolver — no network. Judge resolves; Skenes hits a
    doubleheader; "Jon Doe" is ambiguous; anything else is not-found. */
const mockDeps = (store: InMemoryLineSnapshotStore): ImportDeps => ({
  async resolvePlayer({ rawPlayerName }): Promise<PrizePicksPlayerResolution> {
    const n = rawPlayerName.toLowerCase();
    if (n.includes("judge")) return { status: "resolved", candidates: [JUDGE], chosen: JUDGE, reason: "single" };
    if (n.includes("skenes")) return { status: "resolved", candidates: [SKENES], chosen: SKENES, reason: "single" };
    if (n.includes("doe")) return { status: "ambiguous", candidates: [JUDGE, SKENES], reason: "2 plausible players — needs review" };
    return { status: "not-found", candidates: [], reason: "no match" };
  },
  async resolveGame(player): Promise<GameResolution> {
    if (player.teamId === 147) return { status: "resolved", gamePk: 776001, opponentName: "Red Sox", gameStartTime: "2026-07-21T23:05:00Z", reason: "single game" };
    if (player.teamId === 134) return { status: "ambiguous", reason: "doubleheader — 2 games; pick the correct game" };
    return { status: "no-game", reason: "no game" };
  },
  store,
});

const HEADER = "board_date,captured_at,player,team,opponent,market,line,projection_type,notes";
const csv = (rows: string[]) => [HEADER, ...rows].join("\n");
const snaps = (r: { result: { ok: boolean; value?: { snapshots: unknown[] } } }) =>
  (r.result.ok ? r.result.value!.snapshots : []) as CanonicalLineSnapshot[];

describe("prizepicks-import@1", () => {
  it("imports a valid CSV into canonical snapshots (resolved → IMPORTED, not VERIFIED)", async () => {
    const store = new InMemoryLineSnapshotStore();
    const text = csv(["2026-07-21,2026-07-21T16:00:00Z,Aaron Judge,NYY,BOS,Total Bases,1.5,demon,"]);
    const { result, trace } = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: text }, mockDeps(store));
    expect(result.ok).toBe(true);
    const s = snaps({ result });
    expect(s.length).toBe(1);
    expect(s[0].verificationStatus).toBe("IMPORTED"); // a raw import is NEVER auto-VERIFIED
    expect(s[0].playerId).toBe(592450);
    expect(s[0].gamePk).toBe(776001);
    expect(s[0].marketKey).toBe("total_bases");
    expect(s[0].projectionType).toBe("demon");
    // full pipeline ran
    for (const id of ["loadInput", "parseRows", "normalizeMarkets", "resolvePlayers", "resolveGames", "validate", "reviewGate", "persistSnapshots"]) {
      expect(trace.nodes.map((n) => n.id)).toContain(id);
    }
  });

  it("rejects an unknown market and an invalid line (invalid rows never resolved)", async () => {
    const store = new InMemoryLineSnapshotStore();
    const text = csv([
      "2026-07-21,2026-07-21T16:00:00Z,Aaron Judge,NYY,BOS,Blorp Points,1.5,standard,", // unknown market
      "2026-07-21,2026-07-21T16:00:00Z,Aaron Judge,NYY,BOS,Hits,abc,standard,",          // invalid line
    ]);
    const { result } = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: text }, mockDeps(store));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.parseErrors).toBe(1); // the "abc" line failed to parse
    const s = snaps({ result });
    expect(s.find((x) => x.rawMarketLabel === "Blorp Points")?.verificationStatus).toBe("REJECTED");
  });

  it("never auto-resolves an ambiguous player (→ NEEDS_REVIEW, no playerId)", async () => {
    const store = new InMemoryLineSnapshotStore();
    const text = csv(["2026-07-21,2026-07-21T16:00:00Z,Jon Doe,NYY,BOS,Hits,0.5,standard,"]);
    const { result } = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: text }, mockDeps(store));
    const s = snaps({ result })[0];
    expect(s.verificationStatus).toBe("NEEDS_REVIEW");
    expect(s.playerId).toBeUndefined();
  });

  it("routes a doubleheader to NEEDS_REVIEW (never invents a gamePk)", async () => {
    const store = new InMemoryLineSnapshotStore();
    const text = csv(["2026-07-21,2026-07-21T16:00:00Z,Paul Skenes,PIT,CIN,Pitcher Strikeouts,6.5,standard,"]);
    const { result } = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: text }, mockDeps(store));
    const s = snaps({ result })[0];
    expect(s.verificationStatus).toBe("NEEDS_REVIEW");
    expect(s.gamePk).toBeUndefined();
    expect(s.reason).toContain("doubleheader");
  });

  it("resolves a bare-ambiguous market using the resolved player's role", async () => {
    const store = new InMemoryLineSnapshotStore();
    const text = csv(["2026-07-21,2026-07-21T16:00:00Z,Aaron Judge,NYY,BOS,Strikeouts,0.5,standard,"]);
    const { result } = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: text }, mockDeps(store));
    const s = snaps({ result })[0];
    expect(s.marketKey).toBe("batter_strikeouts"); // hitter role disambiguated it
    expect(s.verificationStatus).toBe("IMPORTED");
  });

  it("is idempotent on re-import and supersedes on a changed line", async () => {
    const store = new InMemoryLineSnapshotStore();
    const line15 = csv(["2026-07-21,2026-07-21T16:00:00Z,Aaron Judge,NYY,BOS,Total Bases,1.5,standard,"]);
    const first = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: line15 }, mockDeps(store));
    expect(first.result.ok && first.result.value.summary.persisted.inserted).toBe(1);
    // Re-import identical ⇒ idempotent no-op.
    const again = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: line15 }, mockDeps(store));
    expect(again.result.ok && again.result.value.summary.persisted.noop).toBe(1);
    // Changed line ⇒ new superseding snapshot; both versions persist.
    const line25 = csv(["2026-07-21,2026-07-21T18:00:00Z,Aaron Judge,NYY,BOS,Total Bases,2.5,standard,"]);
    const changed = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: line25 }, mockDeps(store));
    expect(changed.result.ok && changed.result.value.summary.persisted.superseded).toBe(1);
    expect(store.all().length).toBe(2);
    expect((await store.list("2026-07-21")).map((s) => s.line).sort()).toEqual([1.5, 2.5]);
  });

  it("only reaches VERIFIED through a trusted review of a resolved line", async () => {
    const store = new InMemoryLineSnapshotStore();
    const text = csv(["2026-07-21,2026-07-21T16:00:00Z,Aaron Judge,NYY,BOS,Total Bases,1.5,standard,"]);
    // First pass to learn the entryId.
    const first = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: text }, mockDeps(store));
    const entryId = snaps(first)[0].entryId;

    // A trusted review VERIFIES it.
    const verified = await runPrizePicksImportWorkflow(
      { boardDate: "2026-07-21", source: "csv", csvText: text, reviews: [{ entryId, decision: "VERIFIED" }] },
      mockDeps(new InMemoryLineSnapshotStore()),
    );
    expect(snaps(verified)[0].verificationStatus).toBe("VERIFIED");

    // A review VERIFYING an UNRESOLVED (ambiguous) line is ignored — cannot verify into existence.
    const ambiguous = csv(["2026-07-21,2026-07-21T16:00:00Z,Jon Doe,NYY,BOS,Hits,0.5,standard,"]);
    const amb = await runPrizePicksImportWorkflow({ boardDate: "2026-07-21", source: "csv", csvText: ambiguous }, mockDeps(new InMemoryLineSnapshotStore()));
    const ambId = snaps(amb)[0].entryId;
    const tryVerify = await runPrizePicksImportWorkflow(
      { boardDate: "2026-07-21", source: "csv", csvText: ambiguous, reviews: [{ entryId: ambId, decision: "VERIFIED" }] },
      mockDeps(new InMemoryLineSnapshotStore()),
    );
    expect(snaps(tryVerify)[0].verificationStatus).toBe("NEEDS_REVIEW");
  });

  it("supports the pre-parsed rows path (manual / reviewed-image import)", async () => {
    const store = new InMemoryLineSnapshotStore();
    const { result } = await runPrizePicksImportWorkflow({
      boardDate: "2026-07-21", source: "reviewed-image-import",
      rows: [{
        boardDate: "2026-07-21", capturedAt: "2026-07-21T16:00:00Z", sourceType: "reviewed-image-import",
        rawPlayerName: "Aaron Judge", rawMarketLabel: "Home Runs", line: 0.5, projectionType: "standard",
      }],
    }, mockDeps(store));
    const s = snaps({ result })[0];
    expect(s.source).toBe("reviewed-image-import");
    expect(s.marketKey).toBe("home_runs");
    expect(s.verificationStatus).toBe("IMPORTED"); // image import is never verified until reviewed
  });
});
