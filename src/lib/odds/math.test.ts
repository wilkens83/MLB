import { test, expect, describe } from "bun:test";
import {
  americanToDecimal, decimalToAmerican, americanToImplied, decimalToImplied,
  removeVigTwoWay, holdPercent, expectedValue, edge, kelly, closingLineValue,
  detectArbitrage,
} from "./math";

describe("odds conversions", () => {
  test("american <-> decimal", () => {
    expect(americanToDecimal(100)).toBeCloseTo(2, 6);
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 3);
    expect(decimalToAmerican(2)).toBe(100);
    expect(decimalToAmerican(1.9091)).toBe(-110);
  });
  test("implied probability", () => {
    expect(americanToImplied(-110)).toBeCloseTo(0.5238, 4);
    expect(americanToImplied(100)).toBeCloseTo(0.5, 6);
    expect(decimalToImplied(2)).toBeCloseTo(0.5, 6);
  });
});

describe("vig removal", () => {
  test("-110/-110 fairs to 50/50", () => {
    const nv = removeVigTwoWay(-110, -110);
    expect(nv.over).toBeCloseTo(0.5, 6);
    expect(nv.under).toBeCloseTo(0.5, 6);
    expect(nv.hold).toBeGreaterThan(0);
  });
  test("no-vig probabilities sum to 1", () => {
    const nv = removeVigTwoWay(-140, 120);
    expect(nv.over + nv.under).toBeCloseTo(1, 6);
  });
  test("hold percent positive for a juiced market", () => {
    expect(holdPercent([-110, -110])).toBeGreaterThan(0.04);
  });
});

describe("EV, edge, Kelly", () => {
  test("expected value sign", () => {
    expect(expectedValue(0.6, 100)).toBeCloseTo(0.2, 6); // 60% at +100 => +0.2
    expect(expectedValue(0.4, -110)).toBeLessThan(0);
  });
  test("edge is model minus implied", () => {
    expect(edge(0.6, -110)).toBeCloseTo(0.6 - 0.5238, 3);
  });
  test("kelly positive only for +EV", () => {
    expect(kelly(0.6, 100)).toBeCloseTo(0.2, 2);
    expect(kelly(0.4, -110)).toBe(0);
  });
  test("fractional kelly scales", () => {
    expect(kelly(0.6, 100, 0.25)).toBeCloseTo(0.05, 2);
  });
});

describe("CLV and arbitrage", () => {
  test("closing line value positive when you beat the close", () => {
    expect(closingLineValue(120, 100)).toBeGreaterThan(0);
  });
  test("detects a two-way arb", () => {
    const arb = detectArbitrage([{ book: "A", american: 120 }], [{ book: "B", american: 110 }]);
    expect(arb?.isArb).toBe(true);
    expect(arb!.returnPct).toBeGreaterThan(0);
    const stake = arb!.legs.reduce((s, l) => s + l.stakePct, 0);
    expect(stake).toBeCloseTo(1, 6);
  });
  test("no arb on a normal juiced market", () => {
    const arb = detectArbitrage([{ book: "A", american: -110 }], [{ book: "B", american: -110 }]);
    expect(arb?.isArb).toBe(false);
  });
});
