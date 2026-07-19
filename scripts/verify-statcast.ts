import { savantStatcastProvider } from "@/lib/providers/statcast";

async function main() {
  for (const season of [2026, 2025]) {
    console.log(`\n== Statcast season ${season} ==`);
    const judge = await savantStatcastProvider.getBatter(592450, season);
    if (judge) {
      console.log(
        `  Judge: xwOBA=${judge.xwoba} EV=${judge.exitVeloAvg} barrel%=${judge.barrelPct} hardhit%=${judge.hardHitPct} K%=${judge.kPct} avail=${judge.availableMetrics.length}`,
      );
    } else console.log("  Judge: no batter row");

    const skenes = await savantStatcastProvider.getPitcher(694973, season);
    if (skenes) {
      console.log(
        `  Skenes: K%=${skenes.kPct} BB%=${skenes.bbPct} xwOBA=${skenes.xwoba} whiff%=${skenes.whiffPct} FBvelo=${skenes.fastballVelo} GB%=${skenes.gbPct}`,
      );
    } else console.log("  Skenes: no pitcher row");
  }
  console.log("\nSTATCAST PROVIDER OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
