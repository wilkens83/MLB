/* ============================================================================
   De-duplication / clustering. The same rumor repeated across many threads must
   count as ONE event with N supporting items — not N independent facts. We cluster
   classified items by (event type + normalized keyword bucket + a coarse time
   window). Deterministic and pure.
   ========================================================================== */

import type { ContextEventType } from "./types";
import type { ClassifiedItem } from "./classify";

const WINDOW_MS = 24 * 3600 * 1000; // cluster within a rolling 24h bucket

export interface EventCluster {
  type: ContextEventType;
  items: ClassifiedItem[];
  firstSeenAt: number;
  lastSeenAt: number;
  /** Distinct discussion threads (by post id / subreddit) backing this cluster. */
  uniqueThreads: number;
  subreddits: string[];
}

function timeBucket(ts: number): number {
  return Math.floor(ts / WINDOW_MS);
}

/**
 * Cluster classified items. Items of the same type + keyword bucket within the
 * same 24h window collapse into one cluster; unique-thread count reflects distinct
 * post ids so three comments in one thread are not three independent facts.
 */
export function clusterEvents(classified: ClassifiedItem[]): EventCluster[] {
  const groups = new Map<string, ClassifiedItem[]>();
  for (const c of classified) {
    const key = `${c.type}|${c.keywordKey}|${timeBucket(c.item.createdAt)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  const clusters: EventCluster[] = [];
  for (const items of groups.values()) {
    const times = items.map((c) => c.item.createdAt);
    const threadIds = new Set(items.map((c) => c.item.url.split("?")[0]));
    const subreddits = [...new Set(items.map((c) => c.item.subreddit))];
    clusters.push({
      type: items[0].type,
      items,
      firstSeenAt: Math.min(...times),
      lastSeenAt: Math.max(...times),
      uniqueThreads: threadIds.size,
      subreddits,
    });
  }
  // Most-recent, most-supported first.
  return clusters.sort((a, b) => b.lastSeenAt - a.lastSeenAt || b.items.length - a.items.length);
}
