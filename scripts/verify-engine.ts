import { analyzeProp } from "@/lib/prediction/engine";
import { poissonPmf, poissonCdf, samplePoisson, mulberry32 } from "@/lib/math/stats";
import { americanToImplied, removeVigTwoWay, kelly, detectArbitrage } from "@/lib/odds/math";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}

console.log("== Distribution sanity ==");
// Poisson PMF sums to ~1 over support
let s = 0;
for (let k = 0; k < 40; k++) s += poissonPmf(k, 6);
assert(Math.abs(s - 1) < 1e-6, `poisson pmf sums to 1 (got ${s.toFixed(6)})`);
assert(Math.abs(poissonCdf(6, 6) - 0.6063) < 0.01, "poisson cdf(6,6)≈0.606");

// Monte Carlo mean of Poisson(6) ≈ 6
const rng = mulberry32(42);
let acc = 0;
const N = 50000;
for (let i = 0; i < N; i++) acc += samplePoisson(6, rng);
const mcMean = acc / N;
assert(Math.abs(mcMean - 6) < 0.1, `MC poisson mean≈6 (got ${mcMean.toFixed(3)})`);

console.log("== Odds math ==");
assert(Math.abs(americanToImplied(-110) - 0.5238) < 0.001, "implied(-110)≈0.5238");
const nv = removeVigTwoWay(-110, -110);
assert(Math.abs(nv.over - 0.5) < 1e-6, "no-vig -110/-110 → 0.5");
assert(kelly(0.6, 100) > 0.19 && kelly(0.6, 100) < 0.21, "kelly(0.6,+100)≈0.2");
assert(kelly(0.4, -110) === 0, "kelly negative-EV → 0");
const arb = detectArbitrage([{ book: "A", american: 120 }], [{ book: "B", american: 110 }]);
assert(arb!.isArb === true, "arb detected on +120 / +110");

console.log("== Strikeouts prop (deGrom-like, K line 7.5) ==");
const ks = [9, 7, 11, 6, 8, 10, 5, 12, 7, 9, 8, 6, 10, 11, 7];
const a = analyzeProp({
  propKey: "strikeouts",
  series: ks,
  line: 7.5,
  overAmerican: -115,
  underAmerican: -105,
});
console.log("  projection λ:", a.projection.lambda.toFixed(2), "dispersion:", a.projection.dispersion?.toFixed(1));
console.log("  P(over 7.5):", (a.simulation.probOver * 100).toFixed(1) + "%");
console.log("  ci80:", a.simulation.ci80, "ci95:", a.simulation.ci95);
console.log("  L10 hit rate:", (a.analytics.hitRates.find((h) => h.window === 10)!.rate * 100).toFixed(0) + "%");
console.log("  recommendation:", a.recommendation.recommendation, "conf:", a.recommendation.confidence);
console.log("  best edge:", a.recommendation.best);
assert(a.simulation.probOver > 0.5 && a.simulation.probOver < 0.9, "over prob in sane range");
assert(a.simulation.distribution.length > 5, "distribution has buckets");
assert(Math.abs(a.simulation.distribution.reduce((x, b) => x + b.probability, 0) - 1) < 0.05, "dist sums≈1");

console.log("== HR prop (line 0.5, poisson) ==");
const hrs = [0, 1, 0, 0, 2, 0, 1, 0, 0, 1];
const hr = analyzeProp({ propKey: "home_runs", series: hrs, line: 0.5, overAmerican: 250 });
console.log("  P(HR over 0.5):", (hr.simulation.probOver * 100).toFixed(1) + "%", "λ:", hr.projection.lambda.toFixed(2));
assert(hr.simulation.probOver > 0.2 && hr.simulation.probOver < 0.6, "HR over prob sane");

console.log("\nALL ENGINE CHECKS PASSED ✅");
