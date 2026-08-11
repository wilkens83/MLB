/* ============================================================================
   Research engine — turns raw Reddit items into verified, deduplicated
   ContextEvents plus the secondary sentiment/trend signals. The pipeline is:

     items → spam filter + classify → cluster (dedup) → credibility → verify →
     ContextEvent (severity, confidence, sources)

   Nothing here touches a projection. The output is descriptive context only.
   ========================================================================== */

import type {
  RedditResearchResult, PlayerResearch, ContextEvent, RedditSearchInput,
} from "./types";
import { EVENT_SEVERITY } from "./types";
import { classifyItems } from "./classify";
import { clusterEvents, type EventCluster } from "./dedupe";
import { assessCredibility } from "./credibility";
import { verifyEvent, type VerificationContext } from "./verify";
import { computeSentiment } from "./sentiment";
import { computeTrend } from "./trend";

const SUMMARIES: Record<ContextEvent["type"], string> = {
  scratch: "Possible scratch / out of lineup",
  injury: "Possible injury concern",
  return_from_il: "Possible return from IL",
  pitch_limit: "Possible pitch-count limit",
  opener: "Possible opener / bullpen game",
  role_change: "Possible role change",
  velocity_change: "Possible velocity change",
  command_issue: "Possible command issue",
  fatigue: "Possible fatigue / heavy workload",
  lineup: "Lineup discussion",
  bullpen_game: "Possible bullpen game",
  other: "Community discussion",
};

function clusterToEvent(
  cluster: EventCluster,
  input: RedditSearchInput,
  verifyCtx: VerificationContext,
  now: number,
): ContextEvent {
  const credibility = assessCredibility(cluster, now);
  const verdict = verifyEvent(cluster.type, credibility, verifyCtx);
  return {
    id: `reddit:${input.playerId}:${cluster.type}:${cluster.firstSeenAt}`,
    playerId: input.playerId,
    type: cluster.type,
    summary: SUMMARIES[cluster.type],
    status: verdict.status,
    confidence: verdict.confidence,
    severity: EVENT_SEVERITY[cluster.type],
    sourceType: "reddit",
    reddit: {
      mentions: cluster.items.length,
      subreddits: cluster.subreddits,
      firstSeenAt: cluster.firstSeenAt,
      lastSeenAt: cluster.lastSeenAt,
      uniqueThreads: cluster.uniqueThreads,
    },
    credibility,
    sources: cluster.items.slice(0, 8).map((c) => ({
      url: c.item.url, subreddit: c.item.subreddit, createdAt: c.item.createdAt,
    })),
    verificationNote: verdict.note,
    fetchedAt: now,
  };
}

const SEVERITY_ORDER: Record<ContextEvent["severity"], number> = { critical: 0, high: 1, medium: 2, info: 3 };
const STATUS_ORDER: Record<ContextEvent["status"], number> = { confirmed: 0, reported: 1, unverified: 2, rejected: 3 };

/**
 * Build the full PlayerResearch payload from a provider result. When the provider
 * is unavailable/rate-limited, the events list is empty and the status is
 * surfaced honestly — never backfilled with fabricated content.
 */
export function buildPlayerResearch(
  input: RedditSearchInput,
  result: RedditResearchResult,
  verifyCtx: VerificationContext = {},
  now = Date.now(),
): PlayerResearch {
  if (result.status !== "available") {
    return {
      playerId: input.playerId, status: result.status, events: [],
      sentiment: { relevantMentions: 0, status: "insufficient_sample" },
      trend: { mentions1h: 0, mentions6h: 0, mentions24h: 0, uniqueThreads24h: 0, trend: "stable" },
      note: result.note, lastUpdated: now,
    };
  }

  const classified = classifyItems(result.items);
  const clusters = clusterEvents(classified);
  const events = clusters
    .map((c) => clusterToEvent(c, input, verifyCtx, now))
    .sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.reddit.lastSeenAt - a.reddit.lastSeenAt);

  return {
    playerId: input.playerId,
    status: "available",
    events,
    sentiment: computeSentiment(result.items),
    trend: computeTrend(result.items, now),
    lastUpdated: now,
  };
}
