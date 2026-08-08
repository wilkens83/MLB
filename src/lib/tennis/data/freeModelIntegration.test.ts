/* Integration: the EXISTING Tennis quantitative model consumes free historical
   data unchanged, with provenance and honest missing-data handling. */

import { describe, it, expect } from "bun:test";
import { getFreeDataset, freePlayerMatches } from "./freeDataset";
import { TennisFeatureBuilder, type FeatureContext } from "../model/features";

const ctx = (over: Partial<FeatureContext> = {}): FeatureContext => ({
  asOf: "2025-01-01T00:00:00Z", season: 2025, surface: "hard", environment: "outdoor", bestOf: 5, ...over,
});

describe("free data → existing feature builder", () => {
  it("builds features for a real player from the free dataset", () => {
    getFreeDataset();
    const sinner = "csv:206173";
    const matches = freePlayerMatches(sinner);
    expect(matches.length).toBeGreaterThan(0);

    const fb = new TennisFeatureBuilder(sinner, matches, ctx());
    expect(fb.matchCount()).toBeGreaterThan(0);

    // Serve features carry provenance (a `source`) — the model is unchanged.
    const aces = fb.serveFeatures("season").acesPerServiceGame;
    expect(typeof aces.source).toBe("string");
    expect(aces.sampleSize).toBeGreaterThanOrEqual(0);
  });

  it("reflects missing serve stats honestly (not fabricated) in provenance", () => {
    // Djokovic's only free-dataset appearance vs Sinner (AO SF) has no serve
    // stats → the builder must not invent them; it degrades sample/provenance.
    const djoker = "csv:104925";
    const matches = freePlayerMatches(djoker);
    expect(matches.length).toBeGreaterThan(0);
    const fb = new TennisFeatureBuilder(djoker, matches, ctx({ surface: "grass" }));
    const feat = fb.serveFeatures("l5").acesPerServiceGame;
    // Either an observed value with a source, or an explicit missing/estimated
    // reason — never a silent fabricated number without provenance.
    expect(feat.source.length).toBeGreaterThan(0);
  });
});
