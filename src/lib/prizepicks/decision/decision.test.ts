import { test, expect, describe } from "bun:test";
import { evaluateEntry, type EntryFacts, type LegFacts } from "./evaluate-entry";
import { DEFAULT_DECISION_POLICY } from "./policy";
import { decisionResultSchema } from "./types";

function cleanLeg(over: Partial<LegFacts> = {}): LegFacts {
  return {
    playerId: 1, gamePk: 10, market: "strikeouts", line: 5.5, isPitcher: true,
    playerResolved: true, gameResolved: true, marketSupported: true,
    probabilitiesAvailable: true, probabilityMore: 0.66, probabilityLess: 0.34, probabilityPush: 0,
    confidenceScore: 85, dataQualityScore: 90, volatilityScore: 40, fragilityScore: 20,
    worstCaseSelectedProbability: 0.63,
    lineupRequired: false, lineupConfirmed: true, pitcherMateriallyRelevant: true, starterConfirmed: true,
    lineAgeMinutes: 5, gameStarted: false, snapshotBeforeEvent: true, featureCutoffBeforeStart: true,
    pregameSnapshotExists: true, modelVersionApproved: true, marketValidationState: "VALIDATED",
    ...over,
  };
}
function cleanEntry(legs: LegFacts[], over: Partial<EntryFacts> = {}): EntryFacts {
  return {
    legs, entryFormat: "power", method: "joint-simulation",
    payoutConfigured: true, payoutTableId: "pp-default-2026.1-power-2", payoutTableVersion: "pp-default-2026.1",
    economics: { configured: true, expectedReturn: 1.2, expectedProfit: 0.2, variance: 0.5, downsideProbability: 0.4 },
    modelVersion: "2.0.0-statcast", featureCutoff: "2026-07-31T22:00:00Z", dataAsOf: "2026-07-31T22:00:00Z",
    ...over,
  };
}
const ev = (e: EntryFacts) => evaluateEntry(e, DEFAULT_DECISION_POLICY);

describe("BET decisions", () => {
  test("BET_MORE when everything clears", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("BET_MORE");
    expect(r.legDecisions.every((d) => d.decision === "BET_MORE")).toBe(true);
    expect(r.entryDecision.vetoes).toHaveLength(0);
  });
  test("BET_LESS when the Less side clears", () => {
    const less = cleanLeg({ probabilityMore: 0.34, probabilityLess: 0.66 });
    const r = ev(cleanEntry([less, cleanLeg({ playerId: 2, probabilityMore: 0.33, probabilityLess: 0.67 })]));
    expect(r.entryDecision.decision).toBe("BET_LESS");
  });
  test("every result validates against the Zod schema", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })]));
    expect(decisionResultSchema.safeParse(r.entryDecision).success).toBe(true);
    expect(r.legDecisions.every((d) => decisionResultSchema.safeParse(d).success)).toBe(true);
  });
});

describe("WAIT decisions", () => {
  test("WAIT when a hitter lineup is unconfirmed", () => {
    const hitter = cleanLeg({ isPitcher: false, market: "total_bases", lineupRequired: true, lineupConfirmed: false, pitcherMateriallyRelevant: false });
    const r = ev(cleanEntry([hitter, cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("WAIT");
    expect(r.entryDecision.nextReviewAt).toBeTruthy();
  });
  test("WAIT when the probable pitcher is unconfirmed", () => {
    const r = ev(cleanEntry([cleanLeg({ starterConfirmed: false }), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("WAIT");
  });
  test("WAIT when the payout table is being configured", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })], { payoutConfigured: false, payoutFixable: true, economics: { configured: false } }));
    expect(r.entryDecision.decision).toBe("WAIT");
    expect(r.entryDecision.releaseConditions?.join(" ")).toMatch(/payout/i);
  });
});

describe("NO_BET decisions", () => {
  const noBet = (o: Partial<LegFacts>) => ev(cleanEntry([cleanLeg(o), cleanLeg({ playerId: 2 })])).entryDecision.decision;
  test("probability below threshold", () => expect(noBet({ probabilityMore: 0.55, probabilityLess: 0.45 })).toBe("NO_BET"));
  test("confidence below threshold", () => expect(noBet({ confidenceScore: 60 })).toBe("NO_BET"));
  test("data quality below threshold (above hard floor)", () => expect(noBet({ dataQualityScore: 70 })).toBe("NO_BET"));
  test("fragility above threshold (below hard ceiling)", () => expect(noBet({ fragilityScore: 45 })).toBe("NO_BET"));
  test("worst-case sensitivity below threshold", () => expect(noBet({ worstCaseSelectedProbability: 0.55 })).toBe("NO_BET"));
  test("entry expected return at/below threshold", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })], { economics: { configured: true, expectedReturn: 0.91 } }));
    expect(r.entryDecision.decision).toBe("NO_BET");
    expect(r.entryDecision.vetoes.some((v) => v.code === "ENTRY_EV_BELOW_MIN")).toBe(true);
  });
  test("correlation concentration", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })], { correlationConcentration: true }));
    expect(r.entryDecision.decision).toBe("NO_BET");
  });
  test("independence approximation with material correlation blocks BET", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })], { method: "independence-approximation", correlationMaterialButUnmodeled: true }));
    expect(r.entryDecision.decision).toBe("NO_BET");
    expect(r.entryDecision.vetoes.some((v) => v.code === "UNMODELED_CORRELATION")).toBe(true);
  });
  test("research-only market blocks a firm BET", () => {
    const r = ev(cleanEntry([cleanLeg({ marketValidationState: "RESEARCH_ONLY" }), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("NO_BET");
  });
  test("suspended market blocks a firm BET", () => {
    const r = ev(cleanEntry([cleanLeg({ marketValidationState: "SUSPENDED" }), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("NO_BET");
  });
  test("stale line blocks a firm BET", () => {
    const r = ev(cleanEntry([cleanLeg({ lineAgeMinutes: 30 }), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("NO_BET");
    expect(r.legDecisions[0].vetoes.some((v) => v.code === "LINE_STALE")).toBe(true);
  });
});

describe("UNAVAILABLE decisions", () => {
  const un = (o: Partial<LegFacts>) => ev(cleanEntry([cleanLeg(o), cleanLeg({ playerId: 2 })])).entryDecision.decision;
  test("player mapping unresolved", () => expect(un({ playerResolved: false })).toBe("UNAVAILABLE"));
  test("unsupported market", () => expect(un({ marketSupported: false })).toBe("UNAVAILABLE"));
  test("snapshot after game start", () => expect(un({ snapshotBeforeEvent: false })).toBe("UNAVAILABLE"));
  test("invalid probability distribution", () => expect(un({ probabilitiesAvailable: false })).toBe("UNAVAILABLE"));
  test("future-data leakage", () => expect(un({ featureCutoffBeforeStart: false })).toBe("UNAVAILABLE"));
  test("ambiguous doubleheader", () => expect(un({ doubleheaderAmbiguous: true })).toBe("UNAVAILABLE"));
  test("both sides qualify → contradiction", () => expect(un({ probabilityMore: 0.7, probabilityLess: 0.7 })).toBe("UNAVAILABLE"));
});

describe("precedence + vetoes", () => {
  test("veto precedence: UNAVAILABLE dominates a low-probability NO_BET", () => {
    const r = ev(cleanEntry([cleanLeg({ playerResolved: false, probabilityMore: 0.51, probabilityLess: 0.49 }), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decision).toBe("UNAVAILABLE");
  });
  test("decision precedence: WAIT beats NO_BET across legs", () => {
    const waiting = cleanLeg({ starterConfirmed: false }); // WAIT
    const rejected = cleanLeg({ playerId: 2, probabilityMore: 0.5, probabilityLess: 0.5 }); // NO_BET
    expect(ev(cleanEntry([waiting, rejected])).entryDecision.decision).toBe("WAIT");
  });
  test("a BET is impossible whenever any veto exists", () => {
    const r = ev(cleanEntry([cleanLeg({ marketValidationState: "SUSPENDED" }), cleanLeg({ playerId: 2 })]));
    expect(["BET_MORE", "BET_LESS"]).not.toContain(r.entryDecision.decision);
    expect(r.legDecisions[0].vetoes.length).toBeGreaterThan(0);
  });
  test("policy + model + payout versions are recorded on every decision", () => {
    const r = ev(cleanEntry([cleanLeg(), cleanLeg({ playerId: 2 })]));
    expect(r.entryDecision.decisionPolicyVersion).toBe(DEFAULT_DECISION_POLICY.version);
    expect(r.entryDecision.modelVersion).toBe("2.0.0-statcast");
    expect(r.entryDecision.payoutTableVersion).toBe("pp-default-2026.1");
    expect(r.entryDecision.configChecksum).toMatch(/^[0-9a-f]{8}$/);
  });
});
