import { describe, it, expect } from "bun:test";
import {
  parseScreenshotText,
  mergeScreenshots,
  extractScreenshots,
  splitPrimaryAndAlternatives,
} from "./screenshot";

const BIBEE_KS = `Player:
Tanner Bibee
Team:
CLE
Position:
P
Opponent:
DET
Game time:
Tue 6:40 PM

Pitcher Strikeouts
Standard 4.5
Goblin 3.5
Demon 5.5
Demon 6.5`;

describe("parseScreenshotText — player block", () => {
  it("extracts labeled identity fields", () => {
    const ex = parseScreenshotText(BIBEE_KS);
    expect(ex.playerName).toBe("Tanner Bibee");
    expect(ex.team).toBe("CLE");
    expect(ex.position).toBe("P");
    expect(ex.opponent).toBe("DET");
    expect(ex.gameTime).toBe("Tue 6:40 PM");
  });

  it("resolves the market and groups all thresholds under it", () => {
    const ex = parseScreenshotText(BIBEE_KS);
    expect(ex.markets).toHaveLength(1);
    const m = ex.markets[0];
    expect(m.marketKey).toBe("strikeouts");
    expect(m.marketSupported).toBe(true);
    expect(m.lines).toEqual([
      { line: 4.5, projectionType: "standard" },
      { line: 3.5, projectionType: "goblin" },
      { line: 5.5, projectionType: "demon" },
      { line: 6.5, projectionType: "demon" },
    ]);
    expect(ex.needsReview).toBe(false);
  });
});

describe("splitPrimaryAndAlternatives", () => {
  it("makes Standard the primary and the rest alternatives", () => {
    const ex = parseScreenshotText(BIBEE_KS);
    const { primary, alternatives } = splitPrimaryAndAlternatives(ex.markets[0].lines);
    expect(primary).toEqual({ line: 4.5, projectionType: "standard" });
    expect(alternatives).toHaveLength(3);
  });

  it("falls back to the first line when there is no Standard", () => {
    const { primary } = splitPrimaryAndAlternatives([
      { line: 3.5, projectionType: "goblin" },
      { line: 5.5, projectionType: "demon" },
    ]);
    expect(primary).toEqual({ line: 3.5, projectionType: "goblin" });
  });
});

describe("multiple markets + history", () => {
  const MULTI = `Aaron Judge
NYY
Opponent: BOS

Total Bases
Standard 1.5
Demon 2.5

Hits
Standard 0.5

L5 Avg 2.4
2, 1, 3, 4, 2`;

  it("parses several markets in one screenshot", () => {
    const ex = parseScreenshotText(MULTI);
    expect(ex.playerName).toBe("Aaron Judge");
    expect(ex.team).toBe("NYY");
    expect(ex.opponent).toBe("BOS");
    expect(ex.markets.map((m) => m.marketKey)).toEqual(["total_bases", "hits"]);
  });

  it("captures displayed history + average as source metadata", () => {
    const ex = parseScreenshotText(MULTI);
    expect(ex.averageL5).toBe(2.4);
    expect(ex.history.map((h) => h.value)).toEqual([2, 1, 3, 4, 2]);
  });
});

describe("needs-review behavior (never guess)", () => {
  it("flags a market with no thresholds", () => {
    const ex = parseScreenshotText(`Player:\nJoe Ryan\n\nPitcher Strikeouts`);
    expect(ex.markets[0].needsReview).toBe(true);
    expect(ex.needsReview).toBe(true);
  });

  it("flags an unknown market label for review instead of dropping it", () => {
    const ex = parseScreenshotText(`Player:\nJoe Ryan\n\nQuantum Flux\nStandard 1.5`);
    expect(ex.markets[0].marketKey).toBe("");
    expect(ex.markets[0].needsReview).toBe(true);
  });

  it("flags when the player name is missing", () => {
    const ex = parseScreenshotText(`Pitcher Strikeouts\nStandard 4.5`);
    expect(ex.reviewReasons).toContain("player name not found");
  });
});

describe("mergeScreenshots", () => {
  it("merges markets for the same player/game into one card", () => {
    const walks = parseScreenshotText(`Player:\nTanner Bibee\nTeam:\nCLE\nOpponent:\nDET\n\nWalks Allowed\nStandard 1.5\nGoblin 0.5`, 0);
    const er = parseScreenshotText(`Player:\nTanner Bibee\nTeam:\nCLE\nOpponent:\nDET\n\nEarned Runs Allowed\nStandard 2.5\nDemon 3.5`, 1);
    const merged = mergeScreenshots([walks, er]);
    expect(merged).toHaveLength(1);
    expect(merged[0].markets.map((m) => m.marketKey).sort()).toEqual(["earned_runs", "pitcher_walks"]);
  });

  it("does NOT merge when opponent conflicts (ambiguous identity)", () => {
    const a = parseScreenshotText(`Player:\nTanner Bibee\nTeam:\nCLE\nOpponent:\nDET\n\nHits Allowed\nStandard 5.5`, 0);
    const b = parseScreenshotText(`Player:\nTanner Bibee\nTeam:\nCLE\nOpponent:\nKC\n\nHits Allowed\nStandard 5.5`, 1);
    const merged = mergeScreenshots([a, b]);
    expect(merged).toHaveLength(2);
  });

  it("extractScreenshots parses + merges in one pass", () => {
    const merged = extractScreenshots([
      `Player:\nTanner Bibee\nTeam:\nCLE\nOpponent:\nDET\n\nPitcher Strikeouts\nStandard 4.5`,
      `Player:\nTanner Bibee\nTeam:\nCLE\nOpponent:\nDET\n\nHits Allowed\nStandard 5.5`,
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].markets).toHaveLength(2);
  });
});
