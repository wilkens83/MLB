import { test, expect, describe } from "bun:test";
import {
  type AutocompletePlayer,
  marketRoleHint,
  sortByRolePreference,
  nextActiveIndex,
  toSelectedPlayer,
} from "./autocomplete";

function player(over: Partial<AutocompletePlayer> & { id: number }): AutocompletePlayer {
  return {
    name: `Player ${over.id}`,
    position: "P",
    team: "Team",
    isPitcher: true,
    ...over,
  };
}

// A "gray"-style ambiguous surname search: one pitcher, one hitter, one pitcher.
const grays: AutocompletePlayer[] = [
  player({ id: 1, name: "Josiah Gray", position: "P", team: "Washington Nationals", isPitcher: true }),
  player({ id: 2, name: "Some Gray Hitter", position: "2B", team: "Los Angeles Angels", isPitcher: false }),
  player({ id: 3, name: "Sonny Gray", position: "P", team: "St. Louis Cardinals", isPitcher: true }),
];

describe("marketRoleHint", () => {
  test("maps market category to the MLB search role (never filters)", () => {
    expect(marketRoleHint("pitcher")).toBe("pitcher");
    expect(marketRoleHint("hitter")).toBe("batter");
    expect(marketRoleHint(undefined)).toBeUndefined();
  });
});

describe("sortByRolePreference", () => {
  test("pitcher market: pitchers first, all results retained (stable)", () => {
    const out = sortByRolePreference(grays, "pitcher");
    expect(out.map((p) => p.id)).toEqual([1, 3, 2]); // pitchers keep original order, hitter last
    expect(out.length).toBe(grays.length); // nothing dropped
  });

  test("hitter market: hitters first, all results retained (stable)", () => {
    const out = sortByRolePreference(grays, "batter");
    expect(out.map((p) => p.id)).toEqual([2, 1, 3]); // hitter first, pitchers keep original order
    expect(out.length).toBe(grays.length);
  });

  test("no role: original order preserved", () => {
    expect(sortByRolePreference(grays, undefined).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  test("empty input stays empty (no-results path)", () => {
    expect(sortByRolePreference([], "pitcher")).toEqual([]);
  });
});

describe("nextActiveIndex (keyboard navigation)", () => {
  test("ArrowDown moves down and clamps at the last row", () => {
    expect(nextActiveIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextActiveIndex("ArrowDown", 2, 3)).toBe(2);
  });
  test("ArrowUp moves up and clamps at the first row", () => {
    expect(nextActiveIndex("ArrowUp", 2, 3)).toBe(1);
    expect(nextActiveIndex("ArrowUp", 0, 3)).toBe(0);
  });
  test("other keys leave the index unchanged; empty list resets to 0", () => {
    expect(nextActiveIndex("Enter", 2, 3)).toBe(2);
    expect(nextActiveIndex("ArrowDown", 5, 0)).toBe(0);
  });
});

describe("toSelectedPlayer (canonical identity captured on pick)", () => {
  test("carries id, name, team and position; blanks become undefined", () => {
    expect(toSelectedPlayer(grays[2])).toEqual({
      playerId: 3,
      playerName: "Sonny Gray",
      teamId: undefined,
      teamName: "St. Louis Cardinals",
      position: "P",
    });
    const fa = player({ id: 9, name: "Free Agent", position: "", team: "", teamId: undefined });
    expect(toSelectedPlayer(fa)).toEqual({
      playerId: 9,
      playerName: "Free Agent",
      teamId: undefined,
      teamName: undefined,
      position: undefined,
    });
  });
});
