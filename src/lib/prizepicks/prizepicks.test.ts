import { test, expect, describe } from "bun:test";
import { resolveMarket, normalizeLabel } from "./market-map";
import { normalizePlayerName, normalizeProjectionType, stripAccents } from "./normalize";
import { parseBoardCsv } from "./csv";
import { computeRanking, classifySignal, DEFAULT_THRESHOLDS } from "./ranking";
import { gradeResult, computeActual, statGroupForMarket } from "./grading";
import type { CandidateEvaluation } from "./types";

describe("market normalization", () => {
  test("canonical labels resolve", () => {
    expect(resolveMarket("Pitcher Strikeouts").market?.canonical).toBe("strikeouts");
    expect(resolveMarket("Total Bases").market?.canonical).toBe("total_bases");
    expect(resolveMarket("Hits + Runs + RBIs").market?.canonical).toBe("hits_runs_rbis");
    expect(resolveMarket("H+R+RBI").market?.canonical).toBe("hits_runs_rbis");
  });
  test("label variants resolve", () => {
    expect(resolveMarket("Pitcher Ks").market?.canonical).toBe("strikeouts");
    expect(resolveMarket("Earned Runs Allowed").market?.canonical).toBe("earned_runs");
    expect(resolveMarket("Walks Allowed").market?.canonical).toBe("pitcher_walks");
    expect(resolveMarket("HR").market?.canonical).toBe("home_runs");
  });
  test("CRITICAL: hitter vs pitcher strikeouts never confused", () => {
    // Explicit labels are unambiguous
    expect(resolveMarket("Pitcher Strikeouts").market?.canonical).toBe("strikeouts");
    expect(resolveMarket("Batter Strikeouts").market?.canonical).toBe("batter_strikeouts");
    expect(resolveMarket("Hitter Strikeouts").market?.canonical).toBe("batter_strikeouts");
    // Bare "Strikeouts" is ambiguous without a role hint
    expect(resolveMarket("Strikeouts").status).toBe("ambiguous");
    expect(resolveMarket("Strikeouts", "pitcher").market?.canonical).toBe("strikeouts");
    expect(resolveMarket("Strikeouts", "hitter").market?.canonical).toBe("batter_strikeouts");
  });
  test("CRITICAL: hitter walks vs pitcher walks-allowed", () => {
    expect(resolveMarket("Walks Allowed").market?.canonical).toBe("pitcher_walks");
    expect(resolveMarket("Walks").status).toBe("ambiguous");
    expect(resolveMarket("Walks", "pitcher").market?.canonical).toBe("pitcher_walks");
    expect(resolveMarket("Walks", "hitter").market?.canonical).toBe("walks");
  });
  test("unknown markets go to review, never guessed", () => {
    expect(resolveMarket("Quantum Dingers").status).toBe("unknown");
    expect(resolveMarket("Quantum Dingers").market).toBeUndefined();
  });
  test("unsupported markets are flagged supported:false", () => {
    expect(resolveMarket("First Inning Runs Allowed").market?.supported).toBe(false);
    expect(resolveMarket("Pitcher Fantasy Score").market?.supported).toBe(false);
    expect(resolveMarket("Hitter Fantasy Score").market?.supported).toBe(true);
  });
  test("normalizeLabel collapses punctuation", () => {
    expect(normalizeLabel("Hits + Runs + RBIs")).toBe("hits runs rbis");
  });
});

describe("name normalization", () => {
  test("strips accents", () => {
    expect(stripAccents("José Ramírez")).toBe("Jose Ramirez");
    expect(normalizePlayerName("José Ramírez")).toBe("jose ramirez");
  });
  test("removes suffixes", () => {
    expect(normalizePlayerName("Bobby Witt Jr.")).toBe("bobby witt");
    expect(normalizePlayerName("Ronald Acuña Jr.")).toBe("ronald acuna");
    expect(normalizePlayerName("Ken Griffey III")).toBe("ken griffey");
  });
  test("handles hyphens and punctuation", () => {
    expect(normalizePlayerName("Lourdes Gurriel Jr.")).toBe("lourdes gurriel");
    expect(normalizePlayerName("J.T. Realmuto")).toBe("jt realmuto");
  });
  test("projection type normalization", () => {
    expect(normalizeProjectionType("standard")).toBe("standard");
    expect(normalizeProjectionType("Goblin")).toBe("goblin");
    expect(normalizeProjectionType("DEMON")).toBe("demon");
    expect(normalizeProjectionType("weird")).toBe("unknown");
    expect(normalizeProjectionType(undefined)).toBe("standard");
  });
});

describe("CSV import", () => {
  const csv = [
    "board_date,captured_at,player,team,opponent,market,line,projection_type,notes",
    "2026-07-21,2026-07-21T16:05:00-04:00,Paul Skenes,PIT,CIN,Pitcher Strikeouts,6.5,standard,",
    "2026-07-21,2026-07-21T16:06:00-04:00,Aaron Judge,NYY,BOS,Total Bases,1.5,demon,big spot",
  ].join("\n");

  test("parses valid rows", () => {
    const r = parseBoardCsv(csv, { sourceReference: "board.csv" });
    expect(r.entries.length).toBe(2);
    expect(r.errors.length).toBe(0);
    expect(r.entries[0].rawPlayerName).toBe("Paul Skenes");
    expect(r.entries[0].sourceType).toBe("csv");
    expect(r.entries[1].projectionType).toBe("demon");
    expect(r.entries[1].teamAbbreviation).toBe("NYY");
  });
  test("reports invalid line, never silently drops", () => {
    const bad = ["board_date,captured_at,player,team,opponent,market,line,projection_type,notes",
      "2026-07-21,2026-07-21T16:05:00-04:00,Paul Skenes,PIT,CIN,Pitcher Strikeouts,notanumber,standard,"].join("\n");
    const r = parseBoardCsv(bad);
    expect(r.entries.length).toBe(0);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].field).toBe("line");
  });
  test("detects duplicates", () => {
    const dup = [csv, "2026-07-21,2026-07-21T16:07:00-04:00,Paul Skenes,PIT,CIN,Pitcher Strikeouts,6.5,standard,"].join("\n");
    const r = parseBoardCsv(dup);
    expect(r.duplicates).toBe(1);
    expect(r.entries.length).toBe(2);
  });
  test("missing required column reported", () => {
    const r = parseBoardCsv("player,market,line\nJudge,Hits,1.5");
    expect(r.errors.some((e) => e.message.includes("board_date"))).toBe(true);
  });
});

function evalStub(over: Partial<CandidateEvaluation> = {}): CandidateEvaluation {
  return {
    entryId: "e1", mlbPlayerId: 1, gamePk: 1, marketKey: "strikeouts", line: 6.5,
    projection: 7.2, median: 7, probMore: 0.62, probLess: 0.38, probPush: 0,
    projectionDiff: 0.7, hitRates: { l5: 0.6, l10: 0.7, l20: 0.65, season: 0.66 },
    dataQuality: 78, modelAgreement: 0.7, sampleSize: 20, warnings: [],
    modelVersion: "test", calculatedAt: new Date().toISOString(), pregame: true,
    ...over,
  };
}

describe("ranking + signals", () => {
  test("score in [0,100] and higher prob ranks higher", () => {
    const lo = computeRanking(evalStub({ probMore: 0.53, probLess: 0.47 }), { resolved: true, lineAgeMs: 0 });
    const hi = computeRanking(evalStub({ probMore: 0.72, probLess: 0.28 }), { resolved: true, lineAgeMs: 0 });
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(hi.score).toBeLessThanOrEqual(100);
    expect(lo.score).toBeGreaterThanOrEqual(0);
  });
  test("direction follows the stronger side", () => {
    expect(computeRanking(evalStub({ probMore: 0.7, probLess: 0.3 }), { resolved: true }).direction).toBe("more");
    expect(computeRanking(evalStub({ probMore: 0.3, probLess: 0.7 }), { resolved: true }).direction).toBe("less");
  });
  test("strong requires quality + agreement + no critical warning + pregame", () => {
    expect(computeRanking(evalStub(), { resolved: true, lineAgeMs: 0 }).signal).toBe("strong");
  });
  test("unresolved entry can never be strong", () => {
    const r = computeRanking(evalStub(), { resolved: false });
    expect(r.signal).toBe("avoid");
  });
  test("critical warning forces avoid", () => {
    const r = computeRanking(evalStub({ warnings: [{ code: "stale_line", severity: "high" }] }), { resolved: true });
    expect(r.signal).toBe("avoid");
  });
  test("role uncertainty penalizes and blocks strong", () => {
    const r = computeRanking(evalStub({ warnings: [{ code: "unconfirmed_lineup", severity: "warn" }] }), { resolved: true, lineAgeMs: 0 });
    expect(r.signal).not.toBe("strong");
    expect(r.components.roleUncertaintyPenalty).toBeLessThan(0);
  });
  test("post-start (non-pregame) cannot be strong", () => {
    const r = classifySignal(evalStub({ pregame: false }), { resolved: true }, 0.7, 80, DEFAULT_THRESHOLDS);
    expect(r).not.toBe("strong");
  });
});

describe("result grading", () => {
  test("grades more/less/push", () => {
    expect(gradeResult(6.5, 8)).toBe("more");
    expect(gradeResult(6.5, 5)).toBe("less");
    expect(gradeResult(7, 7)).toBe("push");
  });
  test("computes actual from box score (raw ints)", () => {
    const box = { hits: 3, doubles: 1, triples: 0, homeRuns: 1, runs: 2, rbi: 3, baseOnBalls: 1, strikeOuts: 1, stolenBases: 1, totalBases: 7 };
    expect(computeActual("hits", box)).toBe(3);
    expect(computeActual("singles", box)).toBe(1); // 3 - 1 - 0 - 1
    expect(computeActual("total_bases", box)).toBe(7);
    expect(computeActual("hits_runs_rbis", box)).toBe(8); // 3+2+3
    expect(computeActual("home_runs", box)).toBe(1);
  });
  test("pitcher outs from innings pitched", () => {
    expect(computeActual("pitcher_outs", { inningsPitched: "6.2" })).toBe(20);
    expect(computeActual("strikeouts", { strikeOuts: 9 })).toBe(9);
  });
  test("ungradable markets return null", () => {
    expect(computeActual("first_inning_runs", {})).toBeNull();
    expect(computeActual("pitcher_fantasy_score", {})).toBeNull();
  });
  test("stat group routing", () => {
    expect(statGroupForMarket("strikeouts")).toBe("pitching");
    expect(statGroupForMarket("hits")).toBe("hitting");
  });
});
