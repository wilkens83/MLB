import { test, expect, describe } from "bun:test";
import { parseCsvLine, parseCsv } from "./savantClient";

describe("Savant CSV parsing", () => {
  test("splits simple fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  test("honors quoted fields containing commas", () => {
    // Savant returns "Lindor, Francisco" as a single quoted field
    expect(parseCsvLine('"Lindor, Francisco",596019,2025')).toEqual([
      "Lindor, Francisco",
      "596019",
      "2025",
    ]);
  });
  test("handles escaped double quotes", () => {
    expect(parseCsvLine('"a""b",c')).toEqual(['a"b', "c"]);
  });
  test("parseCsv maps headers to values and skips blank lines", () => {
    const csv = ['"last_name, first_name","player_id","xwoba"', '"Judge, Aaron",592450,.415', ""].join("\n");
    const rows = parseCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0]["player_id"]).toBe("592450");
    expect(rows[0]["xwoba"]).toBe(".415");
    expect(rows[0]["last_name, first_name"]).toBe("Judge, Aaron");
  });
  test("returns empty array for header-only or empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("only,a,header")).toEqual([]);
  });
});
