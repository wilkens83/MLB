import { getTodaysGames, searchPlayers, getGameLog, getPlayer } from "@/lib/mlb/api";
import { extractPropSeries, seriesValues, statGroupForProp } from "@/lib/mlb/series";
import { analyzeProp } from "@/lib/prediction/engine";
import { buildContext } from "@/lib/mlb/context";

async function main() {
  console.log("== Today's games (live API) ==");
  const games = await getTodaysGames();
  console.log(`  ${games.length} games`);
  for (const g of games.slice(0, 4)) {
    const away = g.teams.away.team.name;
    const home = g.teams.home.team.name;
    const ap = g.teams.away.probablePitcher?.fullName ?? "TBD";
    const hp = g.teams.home.probablePitcher?.fullName ?? "TBD";
    console.log(`  ${g.status.detailedState.padEnd(12)} ${away} (${ap}) @ ${home} (${hp}) — ${g.venue?.name}`);
  }

  console.log("\n== Player search 'Judge' ==");
  const results = await searchPlayers("Judge");
  console.log(`  ${results.length} results; top: ${results[0]?.fullName} (${results[0]?.id})`);

  const judge = results[0];
  const player = await getPlayer(judge.id);
  console.log(`  profile: ${player?.fullName}, ${player?.primaryPosition?.abbreviation}, bats ${player?.batSide?.code}, team ${player?.currentTeam?.name}`);

  console.log("\n== Total Bases prop analysis from live 2025 log ==");
  const group = statGroupForProp("total_bases");
  const log = await getGameLog(judge.id, group, 2025);
  const samples = extractPropSeries("total_bases", log);
  const series = seriesValues(samples);
  console.log(`  ${series.length} games; last 10:`, series.slice(-10));

  const ctx = buildContext({ propKey: "total_bases", venueName: "Yankee Stadium", tempF: 78 });
  const analysis = analyzeProp({
    propKey: "total_bases",
    series,
    line: 1.5,
    overAmerican: -120,
    underAmerican: 100,
    context: ctx,
  });
  console.log(`  projection λ: ${analysis.projection.lambda.toFixed(2)} (context ×${analysis.projection.contextMultiplier.toFixed(3)})`);
  console.log(`  P(over 1.5): ${(analysis.simulation.probOver * 100).toFixed(1)}%  ci80: [${analysis.simulation.ci80}]`);
  const l10 = analysis.analytics.hitRates.find((h) => h.window === 10)!;
  console.log(`  L10 over rate: ${(l10.rate * 100).toFixed(0)}% (${l10.hits}/${l10.games})`);
  console.log(`  recommendation: ${analysis.recommendation.recommendation} @ ${analysis.recommendation.confidence}% conf`);
  console.log(`  best: ${JSON.stringify(analysis.recommendation.best)}`);

  console.log("\n== Pitcher strikeouts (probable pitcher today) ==");
  const pitcher = games
    .flatMap((g) => [g.teams.home.probablePitcher, g.teams.away.probablePitcher])
    .find(Boolean);
  if (pitcher) {
    const plog = await getGameLog(pitcher.id, "pitching", 2025);
    const ks = seriesValues(extractPropSeries("strikeouts", plog));
    console.log(`  ${pitcher.fullName}: ${ks.length} starts, last 8 K:`, ks.slice(-8));
    if (ks.length) {
      const kAnalysis = analyzeProp({
        propKey: "strikeouts",
        series: ks,
        line: 5.5,
        overAmerican: -110,
        underAmerican: -110,
      });
      console.log(
        `  λ=${kAnalysis.projection.lambda.toFixed(2)}  P(over 5.5)=${(kAnalysis.simulation.probOver * 100).toFixed(1)}%  rec=${kAnalysis.recommendation.recommendation}`,
      );
    }
  }

  console.log("\nLIVE DATA PIPELINE OK ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
