import { describe, it, expect, beforeEach } from "bun:test";
import "./adapter";
import { getSport } from "@/lib/sports/registry";
import { TENNIS_MARKETS, getTennisMarket } from "./domain/markets";
import { zTennisMatch } from "./schemas/tennis";
import { fixtureProvider } from "./providers/fixtureProvider";
import { sportradarProvider } from "./providers/liveProviders";
import { parseHistoricalCsv, isDangerousCell, createHistoricalCsvProvider } from "./providers/historicalCsv";
import { createManualProvider } from "./providers/manualProvider";
import { TennisProviderRegistry } from "./providers/registry";
import { __resetHealth } from "./providers/health";
import { normalizeName, nameTokensMatch, resolveIdentity, reconcilePlayers } from "./data/identity";
import { derivePlayerSeries, totalGames, hadTiebreak, holdProbFromPoint, gamesToPointProb } from "./data/derive";
import { TennisAcquisition } from "./data/acquisition";
import { InMemoryHistoricalStore } from "./data/store";
import {
  FIXTURE_PLAYERS, FIXTURE_MATCHES, FIXTURE_COMPLETED_MATCH, FIXTURE_SCHEDULED_MATCH,
} from "./fixtures/sample";
import type { TennisPlayer } from "./domain";

beforeEach(() => __resetHealth());

describe("tennis sport registration", () => {
  it("registers tennis as an enabled, UI-exposed sport", () => {
    const t = getSport("tennis");
    expect(t).toBeDefined();
    expect(t!.label).toBe("Tennis");
    // Acquisition + structural sim + market engine are verified, so tennis is
    // now exposed in the UI (the /tennis/* surface). See adapter.ts.
    expect(t!.enabled).toBe(true);
    expect(t!.basePath).toBe("/tennis");
  });

  it("exposes tennis markets via the adapter", () => {
    const t = getSport("tennis")!;
    expect(t.adapter.markets().length).toBe(TENNIS_MARKETS.length);
    expect(t.adapter.getMarket("aces")?.distFamily).toBe("negbinom");
  });
});

describe("tennis market catalog", () => {
  it("has unique keys and shared distribution families", () => {
    const keys = new Set(TENNIS_MARKETS.map((m) => m.key));
    expect(keys.size).toBe(TENNIS_MARKETS.length);
    for (const m of TENNIS_MARKETS) {
      expect(["poisson", "negbinom", "bernoulli", "normal"]).toContain(m.distFamily);
    }
  });
  it("marks tennis markets as structural", () => {
    expect(getTennisMarket("match_winner")?.structural).toBe(true);
    expect(getTennisMarket("total_games")?.perPlayer).toBe(false);
    expect(getTennisMarket("aces")?.perPlayer).toBe(true);
  });
});

describe("zod boundary validation", () => {
  it("accepts a well-formed fixture match", () => {
    expect(zTennisMatch.safeParse(FIXTURE_COMPLETED_MATCH).success).toBe(true);
  });
  it("rejects a match with an invalid surface", () => {
    const bad = { ...FIXTURE_COMPLETED_MATCH, surface: "ice" };
    expect(zTennisMatch.safeParse(bad).success).toBe(false);
  });
});

describe("fixture provider", () => {
  it("reports fixture status and serves scheduled/completed matches", async () => {
    expect(fixtureProvider.status()).toBe("fixture");
    const sched = await fixtureProvider.getSchedule({ dateIso: "2025-06-05" });
    expect(sched.some((m) => m.id === FIXTURE_SCHEDULED_MATCH.id)).toBe(true);
    const results = await fixtureProvider.getMatchResults({ tour: "atp", season: 2025 });
    expect(results.some((m) => m.id === FIXTURE_COMPLETED_MATCH.id)).toBe(true);
  });
});

describe("credentialed live providers", () => {
  it("are inert without credentials and never fabricate data", async () => {
    expect(sportradarProvider.status()).toBe("unconfigured");
    expect(await sportradarProvider.getSchedule({ dateIso: "2025-07-01" })).toEqual([]);
    expect(await sportradarProvider.getPlayer("anything")).toBeNull();
  });
});

describe("historical CSV provider", () => {
  const CSV = [
    "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round,w_ace,w_df,l_ace,l_df,winner_rank,loser_rank",
    "2025-540,Wimbledon,Grass,20250713,701,206173,Jannik Sinner,207989,Carlos Alcaraz,4-6 6-4 6-4 6-4,5,F,14,2,7,3,1,2",
    "2025-540,Wimbledon,Grass,20250711,700,207989,Carlos Alcaraz,105613,Taylor Fritz,6-4 5-7 6-3 7-6(4),5,SF,9,4,11,5,2,5",
  ].join("\n");

  it("parses the tennis-abstract schema into normalized matches", () => {
    const res = parseHistoricalCsv(CSV, "atp");
    expect(res.matches.length).toBe(2);
    const final = res.matches[0];
    expect(final.round).toBe("final");
    expect(final.format).toBe("best_of_5");
    expect(final.surface).toBe("grass");
    expect(final.home.playerName).toBe("Jannik Sinner");
    expect(final.home.isWinner).toBe(true);
    expect(final.sets.length).toBe(4);
    // aces available for both players
    const sinner = final.stats.find((s) => s.playerName === undefined && s.aces === 14);
    expect(sinner?.availableMetrics).toContain("aces");
  });

  it("parses tiebreak scores", () => {
    const res = parseHistoricalCsv(CSV, "atp");
    const sf = res.matches[1];
    const tbSet = sf.sets[3];
    expect(tbSet.homeGames).toBe(7);
    expect(tbSet.awayGames).toBe(6);
    expect(tbSet.awayTiebreak).toBe(4); // loser's TB points bracketed
  });

  it("rejects formula-injection cells", () => {
    expect(isDangerousCell("=cmd()")).toBe(true);
    expect(isDangerousCell("+1")).toBe(true);
    expect(isDangerousCell("Sinner")).toBe(false);
    const evil = [
      "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round",
      "x,Wimbledon,Grass,20250713,1,1,=HYPERLINK(1),2,Loser,6-0 6-0,3,F",
    ].join("\n");
    const res = parseHistoricalCsv(evil, "atp");
    expect(res.matches.length).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors[0]).toContain("formula-injection");
  });

  it("provider reports ready with a corpus and filters by season", async () => {
    const p = createHistoricalCsvProvider(CSV, "atp");
    expect(p.status()).toBe("ready");
    const m2025 = await p.getMatchResults({ tour: "atp", season: 2025 });
    expect(m2025.length).toBe(2);
    const m2024 = await p.getMatchResults({ tour: "atp", season: 2024 });
    expect(m2024.length).toBe(0);
  });
});

describe("manual provider", () => {
  it("serves human-entered matches and reports ready", async () => {
    const p = createManualProvider({ matches: [FIXTURE_SCHEDULED_MATCH], players: [FIXTURE_PLAYERS[2]] });
    expect(p.status()).toBe("ready");
    const sched = await p.getSchedule({ dateIso: "2025-06-05" });
    expect(sched.length).toBe(1);
    const player = await p.getPlayer("de-swiatek-iga");
    expect(player?.fullName).toBe("Iga Swiatek");
  });
  it("is unconfigured when empty", () => {
    expect(createManualProvider().status()).toBe("unconfigured");
  });
});

describe("provider registry failover", () => {
  it("skips fixture providers in production paths but uses them when allowed", async () => {
    const prod = new TennisProviderRegistry({ providers: [fixtureProvider], allowFixtures: false });
    const { data: none } = await prod.getSchedule({ dateIso: "2025-06-05" });
    expect(none.length).toBe(0);

    const test = new TennisProviderRegistry({ providers: [fixtureProvider], allowFixtures: true });
    const { data: some, provider } = await test.getSchedule({ dateIso: "2025-06-05" });
    expect(some.length).toBeGreaterThan(0);
    expect(provider).toBe("fixture");
  });

  it("falls over from an inert live provider to a ready CSV provider", async () => {
    const csv = [
      "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round",
      "1,Test,Hard,20250101,1,1,Alice Ace,2,Betty Base,6-3 6-3,3,F",
    ].join("\n");
    const reg = new TennisProviderRegistry({
      providers: [sportradarProvider, createHistoricalCsvProvider(csv, "wta")],
    });
    const { data, provider } = await reg.getMatchResults({ tour: "wta", season: 2025 });
    expect(data.length).toBe(1);
    expect(provider).toBe("historical-csv");
  });
});

describe("identity resolution (never name-alone)", () => {
  const pool: TennisPlayer[] = FIXTURE_PLAYERS;

  it("normalizes accented names", () => {
    expect(normalizeName("Stéfanos Tsitsipás")).toBe("stefanos tsitsipas");
    expect(nameTokensMatch("Carlos Alcaraz", "alcaraz carlos")).toBe(true);
  });

  it("rejects a name-only match", () => {
    const res = resolveIdentity({ name: "Carlos Alcaraz" }, pool);
    expect(res.status).toBe("unresolved");
    expect(res.reason).toContain("name-only");
  });

  it("resolves with name + corroborating DOB", () => {
    const res = resolveIdentity({ name: "Carlos Alcaraz", dateOfBirth: "2003-05-05" }, pool);
    expect(res.status).toBe("resolved");
    expect(res.player?.id).toBe("de-alcaraz-carlos");
  });

  it("resolves decisively on an external id", () => {
    const res = resolveIdentity({ name: "Wrong Name", externalIds: { fixture: "fx-atp-002" } }, pool);
    expect(res.status).toBe("resolved");
    expect(res.player?.id).toBe("de-sinner-jannik");
  });

  it("reconciles duplicates and merges external ids", () => {
    const dup: TennisPlayer = {
      ...FIXTURE_PLAYERS[0],
      externalIds: { sportradar: "sr:12345" },
    };
    const merged = reconcilePlayers([FIXTURE_PLAYERS[0], dup]);
    expect(merged.length).toBe(1);
    expect(merged[0].externalIds.fixture).toBe("fx-atp-001");
    expect(merged[0].externalIds.sportradar).toBe("sr:12345");
  });
});

describe("match-sample derivation", () => {
  it("derives aces series only where the stat exists", () => {
    const samples = derivePlayerSeries(FIXTURE_MATCHES, "de-sinner-jannik", "aces");
    expect(samples.length).toBe(1); // only the completed match
    expect(samples[0].value).toBe(14);
    expect(samples[0].opponentName).toBe("Carlos Alcaraz");
  });

  it("computes total games and games won", () => {
    expect(totalGames(FIXTURE_COMPLETED_MATCH)).toBe(4 + 6 + 6 + 4 + 6 + 4 + 6 + 4);
    const gw = derivePlayerSeries([FIXTURE_COMPLETED_MATCH], "de-sinner-jannik", "player_games_won");
    expect(gw[0].value).toBe(4 + 6 + 6 + 6); // Sinner's games across 4 sets
  });

  it("detects match winner and tiebreaks", () => {
    const w = derivePlayerSeries([FIXTURE_COMPLETED_MATCH], "de-sinner-jannik", "match_winner");
    expect(w[0].value).toBe(1);
    expect(hadTiebreak(FIXTURE_COMPLETED_MATCH)).toBe(false);
  });
});

describe("serve-hold identity", () => {
  it("hold probability is monotincreasing in point-win prob", () => {
    expect(holdProbFromPoint(0.5)).toBeCloseTo(0.5, 2);
    expect(holdProbFromPoint(0.65)).toBeGreaterThan(0.8);
    expect(holdProbFromPoint(0.75)).toBeGreaterThan(holdProbFromPoint(0.65));
  });
  it("inverts hold rate back to point prob", () => {
    const p = 0.68;
    const hold = holdProbFromPoint(p);
    expect(gamesToPointProb(hold)).toBeCloseTo(p, 1);
  });
});

describe("acquisition orchestration", () => {
  it("backfills into the store idempotently and derives player form", async () => {
    const csv = [
      "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round,w_ace,w_df,l_ace,l_df",
      "1,Test,Hard,20250110,1,100,Player One,200,Player Two,6-3 6-4,3,F,10,1,5,2",
      "1,Test,Hard,20250112,2,100,Player One,300,Player Three,7-6(3) 6-2,3,SF,12,0,6,3",
    ].join("\n");
    const store = new InMemoryHistoricalStore();
    const registry = new TennisProviderRegistry({ providers: [createHistoricalCsvProvider(csv, "atp")] });
    const acq = new TennisAcquisition({ registry, store });

    const first = await acq.backfillSeason("atp", 2025);
    expect(first.fetched).toBe(2);
    expect(first.stored).toBe(2);
    // idempotent: re-run does not duplicate
    await acq.backfillSeason("atp", 2025);
    expect(await store.count()).toBe(2);

    const form = await acq.getPlayerForm("csv:100", "aces");
    expect(form.sampleSize).toBe(2);
    expect(form.series).toEqual([10, 12]); // oldest→newest
    expect(form.serveReturn.sampleSize).toBe(0); // no service-games columns in this CSV
  });

  it("returns empty schedule for a historical-only registry", async () => {
    const csv = "tourney_id,tourney_name,surface,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round\n1,T,Hard,20250101,1,1,A B,2,C D,6-0 6-0,3,F";
    const registry = new TennisProviderRegistry({ providers: [createHistoricalCsvProvider(csv, "atp")] });
    const acq = new TennisAcquisition({ registry });
    const sched = await acq.getSchedule("2025-01-01");
    expect(sched.matches.length).toBe(0);
  });
});
