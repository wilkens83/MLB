import { test, expect, describe } from "bun:test";
import {
  mulberry32, seedFromString, mean, variance, stdDev, median, quantile,
  percentileRank, ewma, poissonPmf, poissonCdf, samplePoisson, negBinomPmf,
  sampleNegBinom, gaussian, normalCdf, normalInv,
} from "./stats";

describe("RNG", () => {
  test("mulberry32 is deterministic for a seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });
  test("mulberry32 output is in [0,1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  test("seedFromString is stable and differs by input", () => {
    expect(seedFromString("abc")).toBe(seedFromString("abc"));
    expect(seedFromString("abc")).not.toBe(seedFromString("abd"));
  });
  test("gaussian has ~0 mean and ~1 sd", () => {
    const r = mulberry32(42);
    const xs = Array.from({ length: 20000 }, () => gaussian(r));
    expect(Math.abs(mean(xs))).toBeLessThan(0.05);
    expect(Math.abs(stdDev(xs) - 1)).toBeLessThan(0.05);
  });
});

describe("summary stats", () => {
  test("mean/variance/std", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(variance([2, 4, 6])).toBeCloseTo(4, 6);
    expect(stdDev([2, 4, 6])).toBeCloseTo(2, 6);
  });
  test("median and quantiles (type-7)", () => {
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 6);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
  test("percentileRank midrank", () => {
    expect(percentileRank([1, 2, 3, 4], 2)).toBeCloseTo(37.5, 6);
  });
});

describe("ewma recency weighting", () => {
  test("weights recent values more than old", () => {
    // ascending series -> recency-weighted mean should exceed the simple mean
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(ewma(xs, 0.4)).toBeGreaterThan(mean(xs));
  });
  test("no initialization lag: constant series returns the constant", () => {
    expect(ewma([5, 5, 5, 5, 5], 0.1)).toBeCloseTo(5, 6);
  });
  test("regression: long half-life on rising-then-steady series is not dragged to the oldest value", () => {
    const xs = [1, 5, 6, 6, 5, 7, 9, 7, 10, 7, 2, 10, 7, 7, 10, 8, 7, 5, 4, 7]; // mean 6.5
    const alpha = 1 - Math.exp(-Math.LN2 / 8);
    const r = ewma(xs, alpha);
    expect(r).toBeGreaterThan(5.5);
    expect(r).toBeLessThan(8);
  });
});

describe("Poisson", () => {
  test("pmf sums to ~1 over support", () => {
    let s = 0;
    for (let k = 0; k < 50; k++) s += poissonPmf(k, 5);
    expect(s).toBeCloseTo(1, 5);
  });
  test("cdf matches reference", () => {
    expect(poissonCdf(6, 6)).toBeCloseTo(0.6063, 3);
  });
  test("sampled mean converges to lambda", () => {
    const r = mulberry32(1);
    let acc = 0;
    const N = 40000;
    for (let i = 0; i < N; i++) acc += samplePoisson(4.3, r);
    expect(acc / N).toBeCloseTo(4.3, 1);
  });
});

describe("Negative binomial", () => {
  test("pmf sums to ~1", () => {
    let s = 0;
    for (let k = 0; k < 80; k++) s += negBinomPmf(k, 6, 10);
    expect(s).toBeCloseTo(1, 4);
  });
  test("sampled mean converges to mu and is overdispersed vs Poisson", () => {
    const r = mulberry32(9);
    const xs = Array.from({ length: 40000 }, () => sampleNegBinom(6, 5, r));
    expect(mean(xs)).toBeCloseTo(6, 1);
    // Var should exceed the mean (overdispersion)
    expect(variance(xs)).toBeGreaterThan(6);
  });
});

describe("Normal helpers", () => {
  test("normalCdf midpoint and tails", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
  });
  test("normalInv inverts normalCdf", () => {
    expect(normalInv(0.975)).toBeCloseTo(1.96, 2);
    expect(normalInv(0.5)).toBeCloseTo(0, 6);
  });
});
