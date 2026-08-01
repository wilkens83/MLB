/* Regression guard for the PrizePicks economic-model rules: the PrizePicks path
   must NOT use a sportsbook price (e.g. -110), American-odds conversions, per-leg
   Kelly staking, or "fair odds" as its economic basis. Economic value comes from
   the complete entry against a configured payout table (see entry/payout.ts). */

import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Strip line + block comments so the guard checks CODE, not documentation that
    legitimately explains what the path must NOT do. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("PrizePicks path is sportsbook-economics-free", () => {
  const files = walk("src/lib/prizepicks");
  const banned = [
    /\bamericanToImplied\b/,
    /\bamericanToDecimal\b/,
    /\bkelly\s*\(/,
    /\bfairAmerican\b/,
    /(?<![\d.])-110(?![\d])/,
  ];

  test("no odds/Kelly/-110 basis anywhere under src/lib/prizepicks", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const re of banned) {
        if (re.test(src)) offenders.push(`${f} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the PrizePicks path does not import the sportsbook odds engine", () => {
    const importers = files.filter((f) => /from ["']@\/lib\/odds\/math["']/.test(stripComments(readFileSync(f, "utf8"))));
    expect(importers).toEqual([]);
  });
});
