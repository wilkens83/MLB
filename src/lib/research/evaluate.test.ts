import { describe, it, expect } from "bun:test";
import { evaluateContextPredictiveValue, type ContextObservation } from "./evaluate";

function obs(id: number, outcome: 0 | 1, events: ContextObservation["events"] = []): ContextObservation {
  return { predictionId: `p${id}`, outcome, events };
}

describe("context predictive-value harness (validation gate, never a feedback loop)", () => {
  it("reports insufficient_history and UNVALIDATED below the observation floor", () => {
    const r = evaluateContextPredictiveValue([obs(1, 1), obs(2, 0)], { minObservations: 100 });
    expect(r.verdict).toBe("insufficient_history");
    expect(r.warnings.join(" ")).toMatch(/unvalidated/i);
    expect(r.totalObservations).toBe(2);
  });

  it("never claims 'validated' even with ample data — the strongest verdict is 'unvalidated'", () => {
    const rows = Array.from({ length: 200 }, (_, i) => obs(i, (i % 2) as 0 | 1));
    const r = evaluateContextPredictiveValue(rows);
    expect(r.verdict).toBe("unvalidated"); // there is no "validated" outcome by design
  });

  it("flags a per-event 'possible_signal' when presence lifts the outcome rate materially", () => {
    // 120 obs: with a confirmed pitch_limit, the OVER rarely hits (outcome mostly 0);
    // without it, the OVER hits ~50%. Sizable negative lift → possible_signal.
    const rows: ContextObservation[] = [];
    for (let i = 0; i < 60; i++) rows.push(obs(i, i < 6 ? 1 : 0, [{ type: "pitch_limit", status: "confirmed" }]));
    for (let i = 60; i < 120; i++) rows.push(obs(i, (i % 2) as 0 | 1));
    const r = evaluateContextPredictiveValue(rows, { minObservations: 100, minEventSample: 20, minLift: 0.1 });
    const row = r.byEvent.find((e) => e.type === "pitch_limit" && e.status === "confirmed")!;
    expect(row.withEventN).toBe(60);
    expect(row.withoutEventN).toBe(60);
    expect(row.lift).not.toBeNull();
    expect(row.lift!).toBeLessThan(-0.1); // OVER hits much less with a confirmed limit
    expect(row.verdict).toBe("possible_signal");
  });

  it("returns 'insufficient_data' for a per-event row with too few samples (never a claim)", () => {
    const rows: ContextObservation[] = [];
    for (let i = 0; i < 150; i++) rows.push(obs(i, (i % 2) as 0 | 1, i < 5 ? [{ type: "injury", status: "reported" }] : []));
    const r = evaluateContextPredictiveValue(rows, { minObservations: 100, minEventSample: 20 });
    const row = r.byEvent.find((e) => e.type === "injury" && e.status === "any")!;
    expect(row.withEventN).toBe(5);
    expect(row.verdict).toBe("insufficient_data");
    expect(row.lift).toBeNull();
  });

  it("reports 'no_signal' when presence does not move the outcome rate", () => {
    const rows: ContextObservation[] = [];
    // fatigue present on half, outcome independent of it
    for (let i = 0; i < 200; i++) rows.push(obs(i, (i % 2) as 0 | 1, i % 4 < 2 ? [{ type: "fatigue", status: "unverified" }] : []));
    const r = evaluateContextPredictiveValue(rows, { minObservations: 100, minEventSample: 20, minLift: 0.06 });
    const row = r.byEvent.find((e) => e.type === "fatigue" && e.status === "any")!;
    expect(row.verdict).toBe("no_signal");
    expect(Math.abs(row.lift ?? 1)).toBeLessThan(0.06);
  });
});
