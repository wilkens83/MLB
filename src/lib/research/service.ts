/* ============================================================================
   Research service — the server-only orchestrator that resolves a player's
   identity (via the MLB API), fetches Reddit via the provider, builds a
   deterministic VerificationContext from Statcast (velocity), and assembles the
   Playerresearch payload. Cached with a short TTL so searches never run per
   render. The research node is NON-CRITICAL: any failure yields an honest
   `unavailable` payload — it never throws into the analysis pipeline.
   ========================================================================== */

import { getPlayer, getCurrentMlbSeason } from "@/lib/mlb/api";
import { savantStatcastProvider } from "@/lib/providers/statcast";
import { buildPlayerResearch } from "./engine";
import { redditResearchProvider } from "./provider";
import { getContextEventStore } from "./store";
import type { PlayerResearch, RedditResearchProvider } from "./types";
import type { VerificationContext } from "./verify";

interface CacheEntry { at: number; value: PlayerResearch }
const cache = new Map<number, CacheEntry>();
const TTL_MS = 10 * 60 * 1000; // 10 min — searches never run on every render

/** Build the deterministic verification facts we can check cheaply (velocity). */
async function buildVerificationContext(playerId: number, isPitcher: boolean): Promise<VerificationContext> {
  if (!isPitcher) return {};
  const season = getCurrentMlbSeason();
  const [cur, prev] = await Promise.all([
    savantStatcastProvider.getPitcher(playerId, season).catch(() => null),
    savantStatcastProvider.getPitcher(playerId, season - 1).catch(() => null),
  ]);
  if (cur?.fastballVelo !== undefined && prev?.fastballVelo !== undefined) {
    const drop = prev.fastballVelo - cur.fastballVelo;
    return { veloDeclineDetected: drop >= 1.0, veloStable: drop < 1.0 };
  }
  return {};
}

export async function getPlayerResearch(
  playerId: number,
  opts: { provider?: RedditResearchProvider; force?: boolean } = {},
): Promise<PlayerResearch> {
  const now = Date.now();
  const cached = cache.get(playerId);
  if (!opts.force && cached && now - cached.at < TTL_MS) return cached.value;

  const provider = opts.provider ?? redditResearchProvider;
  try {
    const person = await getPlayer(playerId).catch(() => null);
    if (!person) {
      const unresolved: PlayerResearch = {
        playerId, status: "unavailable", events: [],
        sentiment: { relevantMentions: 0, status: "insufficient_sample" },
        trend: { mentions1h: 0, mentions6h: 0, mentions24h: 0, uniqueThreads24h: 0, trend: "stable" },
        note: "Player could not be resolved.", lastUpdated: now,
      };
      return unresolved;
    }
    const isPitcher = person.primaryPosition?.abbreviation === "P";
    const input = { playerId, playerName: person.fullName, team: person.currentTeam?.name };
    const [result, verifyCtx] = await Promise.all([
      provider.searchPlayer(input),
      buildVerificationContext(playerId, isPitcher),
    ]);
    const research = buildPlayerResearch(input, result, verifyCtx, now);

    // Persist the structured events (dedup by id) for auditability.
    if (research.status === "available") {
      const store = getContextEventStore();
      for (const e of research.events) await store.create(e);
    }

    cache.set(playerId, { at: now, value: research });
    return research;
  } catch (e) {
    // Non-critical: never throw into the analysis pipeline.
    return {
      playerId, status: "unavailable", events: [],
      sentiment: { relevantMentions: 0, status: "insufficient_sample" },
      trend: { mentions1h: 0, mentions6h: 0, mentions24h: 0, uniqueThreads24h: 0, trend: "stable" },
      note: `Research unavailable: ${e instanceof Error ? e.message : "error"}`, lastUpdated: now,
    };
  }
}

