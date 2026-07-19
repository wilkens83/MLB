import { runAnalysis } from "@/lib/mlb/analysis";

function fmtBreakdown(b: NonNullable<Awaited<ReturnType<typeof runAnalysis>>["breakdown"]>) {
  const lines = [`  base ${b.base}`];
  for (const f of b.factors) lines.push(`   ${f.direction === "up" ? "▲" : f.direction === "down" ? "▼" : "•"} ${f.label}: ${f.delta >= 0 ? "+" : ""}${f.delta} (×${f.multiplier})`);
  lines.push(`  final ${b.final}`);
  return lines.join("\n");
}

async function main() {
  console.log("== BATTER: Aaron Judge total_bases (PA sim) ==");
  const judge = await runAnalysis({
    playerId: 592450, propKey: "total_bases", line: 1.5, overAmerican: -120, underAmerican: 100,
  });
  console.log("  player:", judge.player?.name, "sample:", judge.meta.sampleSize, "modeledBy:", judge.analysis?.modeledBy);
  console.log("  opponent:", judge.opponent?.pitcherName ?? "none", "@", judge.opponent?.venueName);
  console.log("  statcast batter xwOBA:", judge.statcast.batter?.xwoba, "barrel%:", judge.statcast.batter?.barrelPct);
  console.log("  opp pitcher xwOBA:", judge.statcast.pitcher?.xwoba, "K%:", judge.statcast.pitcher?.kPct);
  if (judge.breakdown) console.log(fmtBreakdown(judge.breakdown));
  console.log("  P(over 1.5):", (judge.analysis!.simulation.probOver * 100).toFixed(1) + "%", "rec:", judge.analysis!.recommendation.recommendation);
  console.log("  dataQuality:", judge.dataQuality?.score, judge.dataQuality?.tier);
  console.log("  warnings:", judge.warnings.map((w) => w.code).join(", ") || "none");

  console.log("\n== BATTER: Judge batter_strikeouts (PA sim, K mult) ==");
  const jk = await runAnalysis({ playerId: 592450, propKey: "batter_strikeouts", line: 0.5, overAmerican: -140 });
  console.log("  modeledBy:", jk.analysis?.modeledBy, "P(over 0.5):", (jk.analysis!.simulation.probOver * 100).toFixed(1) + "%");
  if (jk.breakdown) console.log(fmtBreakdown(jk.breakdown));

  console.log("\n== PITCHER: Paul Skenes strikeouts (marginal) ==");
  const skenes = await runAnalysis({ playerId: 694973, propKey: "strikeouts", line: 6.5, overAmerican: -115, underAmerican: -105 });
  console.log("  player:", skenes.player?.name, "sample:", skenes.meta.sampleSize, "modeledBy:", skenes.analysis?.modeledBy);
  console.log("  statcast pitcher K%:", skenes.statcast.pitcher?.kPct, "whiff%:", skenes.statcast.pitcher?.whiffPct, "FBvelo:", skenes.statcast.pitcher?.fastballVelo);
  console.log("  λ:", skenes.analysis?.projection.lambda.toFixed(2), "P(over 6.5):", (skenes.analysis!.simulation.probOver * 100).toFixed(1) + "%", "rec:", skenes.analysis!.recommendation.recommendation);
  console.log("  dataQuality:", skenes.dataQuality?.score, skenes.dataQuality?.tier);

  console.log("\n== EDGE CASE: unknown player ==");
  const bad = await runAnalysis({ playerId: 1, propKey: "hits" });
  console.log("  error:", bad.error, "analysis:", bad.analysis);

  console.log("\n== provenance sample ==", JSON.stringify(skenes.provenance));
  console.log("\nPHASE 2 PIPELINE OK ✅");
}

main().catch((e) => { console.error(e); process.exit(1); });
