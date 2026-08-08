import { describe, it, expect } from "bun:test";
import { InMemoryLineSnapshotStore } from "./snapshotStore";
import { lineEntryId, lineInputHash, type CanonicalLineSnapshot } from "./snapshot";

function snap(over: Partial<CanonicalLineSnapshot> = {}): CanonicalLineSnapshot {
  const boardDate = over.boardDate ?? "2026-07-21";
  const player = over.playerName ?? "aaron judge";
  const market = over.marketKey ?? "total_bases";
  const line = over.line ?? 1.5;
  const projectionType = over.projectionType ?? "standard";
  return {
    entryId: lineEntryId(boardDate, player, market),
    boardDate, playerName: player, rawPlayerName: "Aaron Judge",
    playerId: 592450, gamePk: 1, marketKey: market, rawMarketLabel: "Total Bases",
    marketSupported: true, line, projectionType,
    capturedAt: over.capturedAt ?? "2026-07-21T16:00:00Z",
    source: "csv", verificationStatus: "IMPORTED",
    inputHash: lineInputHash({ boardDate, normalizedPlayerName: player, marketKey: market, line, projectionType }),
    ...over,
  };
}

describe("InMemoryLineSnapshotStore", () => {
  it("inserts a new snapshot", async () => {
    const store = new InMemoryLineSnapshotStore();
    const r = await store.persist(snap());
    expect(r.action).toBe("inserted");
    expect((await store.list("2026-07-21")).length).toBe(1);
  });

  it("is idempotent on an exact duplicate input hash (no second row)", async () => {
    const store = new InMemoryLineSnapshotStore();
    await store.persist(snap());
    const r = await store.persist(snap()); // identical
    expect(r.action).toBe("noop");
    expect(store.all().length).toBe(1);
  });

  it("supersedes on a changed line — both versions persist, prior untouched", async () => {
    const store = new InMemoryLineSnapshotStore();
    await store.persist(snap({ line: 1.5, capturedAt: "2026-07-21T16:00:00Z" }));
    const r = await store.persist(snap({ line: 2.5, capturedAt: "2026-07-21T17:00:00Z" }));
    expect(r.action).toBe("superseded");
    expect(r.snapshot.supersedesHash).toBeDefined();
    const all = store.all();
    expect(all.length).toBe(2); // append-only: the 1.5 line is not overwritten
    expect(all.map((s) => s.line).sort()).toEqual([1.5, 2.5]);
  });

  it("treats a changed projection type as a new snapshot", async () => {
    const store = new InMemoryLineSnapshotStore();
    await store.persist(snap({ projectionType: "standard" }));
    const r = await store.persist(snap({ projectionType: "demon" }));
    expect(r.action).toBe("superseded");
    expect(store.all().length).toBe(2);
  });

  it("lists persisted snapshots for reload", async () => {
    const store = new InMemoryLineSnapshotStore();
    await store.persist(snap({ marketKey: "total_bases" }));
    await store.persist(snap({ marketKey: "hits", line: 0.5 }));
    expect((await store.list("2026-07-21")).length).toBe(2);
    expect((await store.list("2026-07-22")).length).toBe(0);
  });
});
