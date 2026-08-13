import { describe, it, expect } from "bun:test";
import {
  runPickSelector, scorePick, edgeOf,
  type SelectorCandidate,
} from "./selector";

function cand(over: Partial<SelectorCandidate> = {}): SelectorCandidate {
  return {
    id: over.id ?? "c1",
    playerId: over.playerId ?? 1,
    playerName: over.playerName ?? "Player",
    gamePk: over.gamePk ?? 100,
    market: over.market ?? "strikeouts",
    line: over.line ?? 5.5,
    direction: over.direction ?? "more",
    selectedSideProbability: over.selectedSideProbability ?? 0.7,
    dataQuality: over.dataQuality ?? 0.95,
    confidence: over.confidence ?? 0.85,
    uncertainty: over.uncertainty ?? 0.2,
    decision: over.decision ?? "BET_MORE",
    lineupConfirmed: over.lineupConfirmed ?? true,
    ...over,
  };
}

describe("scorePick + edge", () => {
  it("edge is P(favored) − 0.5, never negative", () => {
    expect(edgeOf(cand({ selectedSideProbability: 0.71 }))).toBeCloseTo(0.21, 6);
    expect(edgeOf(cand({ selectedSideProbability: 0.5 }))).toBe(0);
  });

  it("is deterministic and monotonic in probability, data quality, and (inverse) uncertainty", () => {
    const base = cand();
    expect(scorePick(base, 0)).toBe(scorePick(base, 0)); // deterministic
    expect(scorePick(cand({ selectedSideProbability: 0.8 }), 0)).toBeGreaterThan(scorePick(cand({ selectedSideProbability: 0.6 }), 0));
    expect(scorePick(cand({ dataQuality: 0.95 }), 0)).toBeGreaterThan(scorePick(cand({ dataQuality: 0.5 }), 0));
    expect(scorePick(cand({ uncertainty: 0.1 }), 0)).toBeGreaterThan(scorePick(cand({ uncertainty: 0.8 }), 0));
    expect(scorePick(base, 0)).toBeGreaterThan(scorePick(base, 0.6)); // conflict lowers score
  });
});

describe("runPickSelector — grading + PASS discipline", () => {
  it("a strong, confirmed, high-edge pick grades top-tier and is bet-eligible", () => {
    const r = runPickSelector([cand({ selectedSideProbability: 0.72, dataQuality: 0.97, confidence: 0.9, uncertainty: 0.12 })]);
    expect(r.picks[0].grade === "A+" || r.picks[0].grade === "A").toBe(true);
    expect(r.picks[0].tier === "TOP" || r.picks[0].tier === "STRONG").toBe(true);
    expect(r.picks[0].betEligible).toBe(true);
  });

  it("insufficient edge → PASS with a human-readable reason (never forced)", () => {
    const r = runPickSelector([cand({ id: "x", selectedSideProbability: 0.54 })], { minProbability: 0.58, minEdge: 0.08 });
    expect(r.picks[0].grade).toBe("PASS");
    expect(r.picks[0].passReason).toMatch(/probability|edge/i);
    expect(r.picks[0].betEligible).toBe(false);
  });

  it("a firm NO_BET / UNAVAILABLE can never grade above PASS (veto-respecting)", () => {
    const noBet = runPickSelector([cand({ id: "n", decision: "NO_BET", selectedSideProbability: 0.8 })]);
    expect(noBet.picks[0].grade).toBe("PASS");
    expect(noBet.picks[0].passReason).toMatch(/veto|NO_BET/i);
    const unavail = runPickSelector([cand({ id: "u", decision: "UNAVAILABLE", selectedSideProbability: 0.9, dataQuality: 0.99 })]);
    expect(unavail.picks[0].grade).toBe("PASS");
    expect(unavail.picks[0].passReason).toMatch(/unavailable/i);
  });

  it("a firm WAIT keeps its quality grade but is not bet-eligible", () => {
    const r = runPickSelector([cand({ decision: "WAIT", selectedSideProbability: 0.72, dataQuality: 0.97, confidence: 0.9, uncertainty: 0.12 })]);
    expect(r.picks[0].grade).not.toBe("PASS");
    expect(r.picks[0].betEligible).toBe(false);
  });

  it("require-lineup-confirmed demotes an unconfirmed pick to PASS", () => {
    const r = runPickSelector([cand({ lineupConfirmed: false })], { requireLineupConfirmed: true });
    expect(r.picks[0].grade).toBe("PASS");
    expect(r.picks[0].passReason).toMatch(/lineup/i);
  });
});

describe("runPickSelector — caps, conflicts, ranking, summary", () => {
  it("respects max-same-player: the strongest survives, weaker same-player picks PASS", () => {
    const a = cand({ id: "a", playerId: 7, market: "strikeouts", selectedSideProbability: 0.75 });
    const b = cand({ id: "b", playerId: 7, market: "pitcher_outs", selectedSideProbability: 0.65, gamePk: 100 });
    const r = runPickSelector([a, b], { maxSamePlayer: 1, minEdge: 0.05 });
    const qualified = r.picks.filter((p) => p.grade !== "PASS");
    expect(qualified).toHaveLength(1);
    expect(qualified[0].candidate.id).toBe("a"); // higher score kept
    expect(r.picks.find((p) => p.candidate.id === "b")!.passReason).toMatch(/per player/i);
  });

  it("flags same-pitcher More K + More Hits as a conflict (not independent)", () => {
    const k = cand({ id: "k", playerId: 9, gamePk: 200, market: "strikeouts", direction: "more" });
    const h = cand({ id: "h", playerId: 9, gamePk: 200, market: "hits_allowed", direction: "more" });
    const r = runPickSelector([k, h], { maxSamePlayer: 2 });
    const kp = r.picks.find((p) => p.candidate.id === "k")!;
    expect(kp.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(kp.conflicts.join(" ")).toMatch(/negatively related|opposite/i);
  });

  it("ranks best-first and produces a coherent summary + grouping", () => {
    const picks = [
      cand({ id: "hi", playerId: 1, gamePk: 1, selectedSideProbability: 0.74, uncertainty: 0.1 }),
      cand({ id: "mid", playerId: 2, gamePk: 2, selectedSideProbability: 0.62, uncertainty: 0.3 }),
      cand({ id: "lo", playerId: 3, gamePk: 3, selectedSideProbability: 0.52 }),
    ];
    const r = runPickSelector(picks, { minProbability: 0.55, minEdge: 0.05 });
    expect(r.picks[0].score).toBeGreaterThanOrEqual(r.picks[1].score);
    expect(r.picks[1].score).toBeGreaterThanOrEqual(r.picks[2].score);
    // "lo" fails the min-probability filter → PASS group.
    expect(r.groups.PASS.some((p) => p.candidate.id === "lo")).toBe(true);
    // Summary counts sum to total; qualified average edge is set.
    const tierSum = Object.values(r.summary.counts).reduce((a, b) => a + b, 0);
    expect(tierSum).toBe(r.summary.total);
    expect(r.summary.total).toBe(3);
    if (r.summary.gradeCounts["PASS"] < 3) expect(r.summary.averageEdge).not.toBeNull();
  });

  it("market filter drops non-selected markets entirely", () => {
    const r = runPickSelector(
      [cand({ id: "k", market: "strikeouts" }), cand({ id: "hr", market: "home_runs_allowed", playerId: 2, gamePk: 2 })],
      { markets: ["strikeouts"] },
    );
    expect(r.summary.total).toBe(1);
    expect(r.picks[0].candidate.market).toBe("strikeouts");
  });

  it("is deterministic across runs (same input ⇒ identical result)", () => {
    const picks = [cand({ id: "a" }), cand({ id: "b", playerId: 2, gamePk: 2 })];
    expect(runPickSelector(picks)).toEqual(runPickSelector(picks));
  });

  it("empty board yields an empty, well-formed result", () => {
    const r = runPickSelector([]);
    expect(r.summary.total).toBe(0);
    expect(r.summary.averageEdge).toBeNull();
    expect(r.picks).toHaveLength(0);
  });
});
