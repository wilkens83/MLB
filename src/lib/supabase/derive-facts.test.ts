import { test, expect, describe } from "bun:test";
import { deriveMarketFacts, deriveEntryPayoutVerified } from "./derive-facts";

/* Without a configured service-role key (the test / keyless environment) the
   trusted derivation must degrade to the CONSERVATIVE defaults so a firm BET is
   impossible — the client can never supply these facts. */

describe("server-derived facts — conservative fallback without a database", () => {
  test("market validation state defaults to RESEARCH_ONLY", async () => {
    const f = await deriveMarketFacts("strikeouts");
    expect(f.marketValidationState).toBe("RESEARCH_ONLY");
  });

  test("no circuit breaker is asserted without evidence", async () => {
    const f = await deriveMarketFacts("strikeouts");
    expect(f.calibrationDegraded).toBe(false);
    expect(f.featureDriftExceeded).toBe(false);
    expect(f.outsideTrainingSupport).toBe(false);
  });

  test("payout is never treated as verified without a persisted verified snapshot", async () => {
    expect(await deriveEntryPayoutVerified("power", 3)).toBe(false);
    expect(await deriveEntryPayoutVerified("flex", 6)).toBe(false);
  });
});
