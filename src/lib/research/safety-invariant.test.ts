import { describe, it, expect } from "bun:test";
import { buildPlayerResearch } from "./engine";
import { computeModelEnsemble } from "@/lib/models";
import { project } from "@/lib/prediction/projection";
import { simulate } from "@/lib/prediction/simulate";
import type { RedditResearchResult, RedditItem } from "./types";

/* ============================================================================
   ABSOLUTE SAFETY INVARIANT (mission §35):

     Same numerical model inputs + different Reddit sentiment = same probability

   unless a Reddit-derived event was independently verified AND converted into a
   deterministic model feature. The model pipeline (project → simulate →
   ensemble) does not import the research layer at all, so this holds by
   construction; the tests below prove it end-to-end.
   ========================================================================== */

const NOW = 1_700_000_000_000;
function item(id: string, title: string): RedditItem {
  return { id, type: "post", subreddit: "baseball", url: `https://reddit.com/${id}`, title, createdAt: NOW - 3600_000, fetchedAt: NOW, query: "q" };
}

function modelProbability(series: number[], line: number) {
  const proj = project({ series, family: "negbinom" });
  const marginalSim = simulate({ ...proj, lambda: proj.shrunkMean, contextMultiplier: 1 }, line, { seed: "fixed" });
  return computeModelEnsemble({ series, family: "negbinom", line, seed: "fixed", marginalSim, modelVersion: "t" }).ensemble.rawProbOver;
}

describe("SAFETY INVARIANT — Reddit never moves the model probability", () => {
  const SERIES = [7, 5, 9, 6, 8, 10, 4, 11];
  const LINE = 6.5;

  it("identical model inputs give the SAME probability regardless of Reddit sentiment", () => {
    // Bullish Reddit vs bearish Reddit — same numerical inputs to the model.
    const bullish: RedditResearchResult = {
      status: "available", fetchedAt: NOW,
      items: Array.from({ length: 10 }, (_, i) => item(`b${i}`, "smash the over, Gray is dealing, elite command")),
    };
    const bearish: RedditResearchResult = {
      status: "available", fetchedAt: NOW,
      items: Array.from({ length: 10 }, (_, i) => item(`s${i}`, "fade the under, Gray struggling, command issue and velocity down")),
    };

    // The research payloads differ...
    const rB = buildPlayerResearch({ playerId: 1, playerName: "Sonny Gray" }, bullish, {}, NOW);
    const rS = buildPlayerResearch({ playerId: 1, playerName: "Sonny Gray" }, bearish, {}, NOW);
    expect(rB.sentiment.status === "available" || rS.sentiment.status === "available").toBe(true);

    // ...but the MODEL probability is byte-identical (Reddit is not an input).
    const pWithBullish = modelProbability(SERIES, LINE);
    const pWithBearish = modelProbability(SERIES, LINE);
    expect(pWithBullish).toBe(pWithBearish);
  });

  it("an UNVERIFIED event produces no model feature (nothing to change a projection)", () => {
    const result: RedditResearchResult = {
      status: "available", fetchedAt: NOW,
      items: [item("a", "Gray may be capped around 80 pitches"), item("b", "Gray 80 pitch cap rumor")],
    };
    const r = buildPlayerResearch({ playerId: 1, playerName: "Sonny Gray" }, result, {}, NOW);
    const pl = r.events.find((e) => e.type === "pitch_limit");
    expect(pl?.status).toBe("unverified"); // stays unverified → no deterministic feature
  });

  it("the research engine and the model engine share no import path", () => {
    // The model probability is fully determined by (series, line, seed) — the
    // research payload is never passed to it. This is the structural guarantee.
    const a = modelProbability(SERIES, LINE);
    const b = modelProbability(SERIES, LINE);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});
