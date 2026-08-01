import { test, expect, describe } from "bun:test";
import { classifyIntent } from "./intent";

describe("intent classification", () => {
  test("pitcher strikeout rankings", () => {
    const i = classifyIntent("Which pitchers have the best strikeout projections today?");
    expect(i.kind).toBe("pitcher-k-rankings");
  });
  test("hitter home-run rankings", () => {
    const i = classifyIntent("Show me the five strongest home-run projections");
    expect(i.kind).toBe("hitter-hr-rankings");
    expect(i.filters.limit).toBe(5);
  });
  test("compare two players extracts both names, strips command word", () => {
    const i = classifyIntent("Compare Aaron Judge and Juan Soto");
    expect(i.kind).toBe("compare");
    expect(i.playerNames).toEqual(["Aaron Judge", "Juan Soto"]);
  });
  test("single player + prop → projection", () => {
    const i = classifyIntent("What is Aaron Judge total bases projection?");
    expect(i.kind).toBe("projection");
    expect(i.prop).toBe("total_bases");
    expect(i.playerNames[0]).toBe("Aaron Judge");
  });
  test("why question", () => {
    expect(classifyIntent("Why does the model favor the top player?").kind).toBe("why");
  });
  test("prizepicks edges vs board", () => {
    expect(classifyIntent("Which PrizePicks lines have the highest edge?").kind).toBe("prizepicks-edges");
    expect(classifyIntent("Show my PrizePicks board").kind).toBe("prizepicks-board");
  });
  test("data health / missing", () => {
    expect(classifyIntent("What data is missing today?").kind).toBe("data-health");
  });
  test("entry analysis with power/flex detection", () => {
    expect(classifyIntent("Analyze my entry").kind).toBe("entry-analysis");
    expect(classifyIntent("Is my entry correlated?").kind).toBe("entry-analysis");
    const power = classifyIntent("Analyze my power play entry");
    expect(power.kind).toBe("entry-analysis");
    expect(power.entryType).toBe("power");
    expect(classifyIntent("Analyze my flex entry").entryType).toBe("flex");
  });
  test("games/slate", () => {
    expect(classifyIntent("What games are on today?").kind).toBe("games");
  });
  test("unsupported domains answered honestly", () => {
    expect(classifyIntent("Which teams have the weakest bullpen?").kind).toBe("unsupported");
    expect(classifyIntent("Any injuries tonight?").kind).toBe("unsupported");
    expect(classifyIntent("Which games score in the first inning?").kind).toBe("unsupported");
  });
  test("probability filter is parsed", () => {
    const i = classifyIntent("Show players with a probability above 60%");
    expect(i.filters.minOverProbability).toBeCloseTo(0.6, 5);
  });
});

describe("follow-up detection", () => {
  test("'only ... above 60%' is a follow-up filter when a prior list exists", () => {
    const i = classifyIntent("Only show players with a probability above 60%", { hasPriorList: true });
    expect(i.kind).toBe("followup-filter");
    expect(i.filters.minOverProbability).toBeCloseTo(0.6, 5);
  });
  test("without a prior list it is not a follow-up", () => {
    const i = classifyIntent("Only show players with a probability above 60%", { hasPriorList: false });
    expect(i.kind).not.toBe("followup-filter");
  });
  test("'only left-handed' follow-up carries handedness", () => {
    const i = classifyIntent("Only keep left-handed pitchers", { hasPriorList: true });
    expect(i.kind).toBe("followup-filter");
    expect(i.filters.handedness).toBe("L");
  });
});
