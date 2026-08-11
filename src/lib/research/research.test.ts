import { describe, it, expect, beforeEach } from "bun:test";
import { generatePlayerQueries } from "./queries";
import { classifyItem, classifyItems, isSpam } from "./classify";
import { clusterEvents } from "./dedupe";
import { verifyEvent } from "./verify";
import { computeSentiment } from "./sentiment";
import { computeTrend } from "./trend";
import { buildPlayerResearch } from "./engine";
import { contextEventsToFeatures } from "./features";
import { InMemoryContextEventStore } from "./store";
import type { RedditItem, RedditResearchResult, ContextEvent } from "./types";

const NOW = 1_700_000_000_000;
const H = 3600 * 1000;

function item(over: Partial<RedditItem>): RedditItem {
  return {
    id: over.id ?? `t3_${Math.random().toString(36).slice(2)}`,
    type: "post", subreddit: "baseball", url: `https://www.reddit.com/r/baseball/${over.id ?? "x"}`,
    createdAt: NOW - H, fetchedAt: NOW, query: "q", ...over,
  };
}

/* ------------------------------- queries ---------------------------------- */

describe("search query generation (focused, never bare name)", () => {
  it("quotes the player and pairs each with a context term + relevant subs", () => {
    const qs = generatePlayerQueries({ playerId: 1, playerName: "Sonny Gray", team: "Cardinals", opponent: "Cubs" });
    expect(qs.length).toBeGreaterThan(5);
    expect(qs.every((q) => q.query.startsWith('"Sonny Gray" '))).toBe(true);
    expect(qs.some((q) => q.query.includes("pitch limit"))).toBe(true);
    // team subreddits resolved for both sides
    const subs = qs[0].subreddits;
    expect(subs).toContain("cardinals");
    expect(subs).toContain("chicubs");
    expect(subs).toContain("baseball");
  });
  it("returns nothing for an empty name (no bare-name search)", () => {
    expect(generatePlayerQueries({ playerId: 1, playerName: "  " })).toEqual([]);
  });
});

/* ------------------------------ classify ---------------------------------- */

describe("classification (deterministic, keyword-based)", () => {
  it("detects pitch limit, injury, scratch, velocity", () => {
    expect(classifyItem(item({ title: "Gray likely capped at 80 pitches tonight" }))?.type).toBe("pitch_limit");
    expect(classifyItem(item({ title: "Gray dealing with forearm tightness" }))?.type).toBe("injury");
    expect(classifyItem(item({ title: "Gray scratched from tonight's start" }))?.type).toBe("scratch");
    expect(classifyItem(item({ title: "Gray velocity is down 2 mph early" }))?.type).toBe("velocity_change");
  });
  it("drops irrelevant / spam content", () => {
    expect(classifyItem(item({ title: "LFG!!!" }))).toBeNull();
    expect(classifyItem(item({ title: "cashed my Gray over parlay, units on units" }))).toBeNull();
    expect(classifyItem(item({ title: "Who do I start, Gray or someone in a trade?" }))).toBeNull();
    expect(isSpam(item({ title: "same" }))).toBe(true);
  });
});

/* ---------------------------- de-duplication ------------------------------ */

describe("de-duplication (same rumor ≠ N facts)", () => {
  it("collapses the same pitch-limit rumor across threads into ONE event with N supports", () => {
    const items = classifyItems([
      item({ id: "a", url: "https://www.reddit.com/r/cardinals/a", title: "Gray expected to be limited to 80 pitches" }),
      item({ id: "b", url: "https://www.reddit.com/r/fantasybaseball/b", title: "Gray could have an 80 pitch cap" }),
      item({ id: "c", url: "https://www.reddit.com/r/baseball/c", title: "Manager says Gray around 80 pitches" }),
    ]);
    const clusters = clusterEvents(items);
    expect(clusters.length).toBe(1);
    expect(clusters[0].items.length).toBe(3);
    expect(clusters[0].uniqueThreads).toBe(3);
  });
  it("keeps unrelated events separate", () => {
    const items = classifyItems([
      item({ id: "a", title: "Gray capped at 80 pitches" }),
      item({ id: "b", title: "Gray dealing with elbow soreness" }),
    ]);
    expect(clusterEvents(items).length).toBe(2);
  });
});

/* ---------------------------- verification -------------------------------- */

describe("verification against authoritative facts", () => {
  const cred = { level: "medium" as const, reasons: [] };
  it("leaves a rumor UNVERIFIED with no authoritative facts", () => {
    const v = verifyEvent("pitch_limit", cred, {});
    expect(v.status).toBe("unverified");
    expect(v.confidence).toBeLessThan(0.6);
  });
  it("REJECTS a velocity concern when Statcast velocity is stable", () => {
    const v = verifyEvent("velocity_change", cred, { veloStable: true });
    expect(v.status).toBe("rejected");
    expect(v.note).toMatch(/stable/i);
  });
  it("CONFIRMS when an official confirmation exists, raising confidence", () => {
    const v = verifyEvent("pitch_limit", cred, { officialConfirmations: { pitch_limit: true } });
    expect(v.status).toBe("confirmed");
    expect(v.confidence).toBeGreaterThan(0.9);
  });
  it("REJECTS a scratch when the player is in the confirmed lineup", () => {
    expect(verifyEvent("scratch", cred, { playerInConfirmedLineup: true }).status).toBe("rejected");
  });
});

/* ------------------------ sentiment / trend / time ------------------------ */

describe("secondary signals", () => {
  it("reports insufficient_sample below the minimum", () => {
    expect(computeSentiment([item({ title: "over" })]).status).toBe("insufficient_sample");
  });
  it("computes a MORE/LESS lean with enough relevant items", () => {
    const items = Array.from({ length: 8 }, (_, i) => item({ id: `s${i}`, title: i < 6 ? "smash the over" : "fade the under" }));
    const s = computeSentiment(items);
    expect(s.status).toBe("available");
    expect(s.morePct!).toBeGreaterThan(s.lessPct!);
  });
  it("flags a rising trend from a burst of recent mentions", () => {
    const items = [item({ id: "r1", createdAt: NOW - 10 * 60000 }), item({ id: "r2", createdAt: NOW - 20 * 60000 })];
    const t = computeTrend(items, NOW);
    expect(t.mentions1h).toBe(2);
    expect(t.trend).toBe("rising");
  });
});

/* ------------------------------- engine ----------------------------------- */

describe("engine — availability is honest, never faked", () => {
  it("returns an empty, unavailable payload when the provider is unavailable", () => {
    const result: RedditResearchResult = { status: "unavailable", items: [], note: "disabled", fetchedAt: NOW };
    const r = buildPlayerResearch({ playerId: 1, playerName: "Sonny Gray" }, result, {}, NOW);
    expect(r.status).toBe("unavailable");
    expect(r.events).toEqual([]);
    expect(r.note).toBe("disabled");
  });
  it("builds verified, sorted ContextEvents from available items", () => {
    const result: RedditResearchResult = {
      status: "available", fetchedAt: NOW,
      items: [
        item({ id: "a", title: "Gray capped at 80 pitches tonight", createdAt: NOW - 30 * 60000 }),
        item({ id: "b", title: "Gray velocity down 2 mph", createdAt: NOW - 40 * 60000 }),
      ],
    };
    const r = buildPlayerResearch({ playerId: 1, playerName: "Sonny Gray" }, result, { veloStable: true }, NOW);
    expect(r.status).toBe("available");
    const velo = r.events.find((e) => e.type === "velocity_change")!;
    expect(velo.status).toBe("rejected"); // Statcast stable
    const pl = r.events.find((e) => e.type === "pitch_limit")!;
    expect(pl.status).toBe("unverified");
    expect(pl.severity).toBe("high");
  });
});

/* --------------------------- feature bridge ------------------------------- */

describe("event → feature conversion (CONFIRMED only)", () => {
  const ev = (over: Partial<ContextEvent>): ContextEvent => ({
    id: "e", playerId: 1, type: "pitch_limit", summary: "Possible pitch-count limit", status: "unverified",
    confidence: 0.4, severity: "high", sourceType: "reddit",
    reddit: { mentions: 3, subreddits: ["baseball"], firstSeenAt: NOW, lastSeenAt: NOW, uniqueThreads: 3 },
    credibility: { level: "medium", reasons: [] }, sources: [], fetchedAt: NOW, ...over,
  });
  it("ignores unverified/reported/rejected events entirely (no feature)", () => {
    const f = contextEventsToFeatures([ev({ status: "unverified" }), ev({ status: "reported" }), ev({ status: "rejected" })]);
    expect(f.usagePitchCeiling).toBeUndefined();
    expect(f.warnings).toEqual([]);
  });
  it("converts a CONFIRMED pitch limit into a usage ceiling flag", () => {
    const f = contextEventsToFeatures([ev({ status: "confirmed", summary: "Confirmed limited to 80 pitches" })]);
    expect(f.usagePitchCeiling).toBe(80);
    expect(f.warnings.join(" ")).toMatch(/pitch limit/i);
  });
  it("converts a CONFIRMED scratch into player-unavailable", () => {
    const f = contextEventsToFeatures([ev({ status: "confirmed", type: "scratch" })]);
    expect(f.playerUnavailable).toBe(true);
  });
});

/* --------------------------------- store ---------------------------------- */

describe("context event store (dedup by id)", () => {
  let store: InMemoryContextEventStore;
  beforeEach(() => { store = new InMemoryContextEventStore(); });
  it("upserts by id and lists per player without duplicates", async () => {
    const e: ContextEvent = {
      id: "reddit:1:pitch_limit:100", playerId: 1, type: "pitch_limit", summary: "x", status: "unverified",
      confidence: 0.4, severity: "high", sourceType: "reddit",
      reddit: { mentions: 3, subreddits: [], firstSeenAt: 1, lastSeenAt: 2, uniqueThreads: 3 },
      credibility: { level: "low", reasons: [] }, sources: [], fetchedAt: NOW,
    };
    await store.create(e);
    await store.create({ ...e, confidence: 0.5 }); // same id → upsert, not duplicate
    const list = await store.listForPlayer(1);
    expect(list.length).toBe(1);
    expect(list[0].confidence).toBe(0.5);
  });
});
