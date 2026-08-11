/* ============================================================================
   Reddit research provider. Uses Reddit's public search JSON via a legitimate,
   rate-limited approach (a descriptive User-Agent, bounded queries) — NOT brittle
   aggressive scraping. It is DISABLED by default: without `REDDIT_RESEARCH_ENABLED=1`
   it returns a clean `unavailable` state and never fabricates posts. Server-only.
   ========================================================================== */

import { generatePlayerQueries } from "./queries";
import type { RedditResearchProvider, RedditResearchResult, RedditSearchInput, RedditItem } from "./types";

const USER_AGENT = "web:diamond-edge-research:1.0 (by /u/diamond-edge)";
const MAX_QUERIES = 6; // bound the request fan-out per player
const SEARCH_BASE = "https://www.reddit.com/search.json";

interface RedditChild {
  kind: string;
  data: {
    id: string;
    name?: string;
    title?: string;
    selftext?: string;
    body?: string;
    subreddit?: string;
    author?: string;
    score?: number;
    num_comments?: number;
    permalink?: string;
    url?: string;
    created_utc?: number;
    is_self?: boolean;
  };
}

function isEnabled(): boolean {
  return process.env.REDDIT_RESEARCH_ENABLED === "1";
}

function mapChild(child: RedditChild, query: string, fetchedAt: number): RedditItem | null {
  const d = child.data;
  if (!d.id || !d.subreddit) return null;
  const type = child.kind === "t1" ? "comment" : "post";
  const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : d.url ?? "";
  const externalUrl = d.url && !d.url.includes("reddit.com") && !d.is_self;
  return {
    id: d.name ?? `${child.kind}_${d.id}`,
    type,
    title: d.title,
    body: d.selftext || d.body,
    subreddit: d.subreddit,
    author: d.author,
    score: d.score,
    commentCount: d.num_comments,
    url: permalink || d.url || "",
    createdAt: (d.created_utc ?? 0) * 1000,
    fetchedAt,
    query,
    hasExternalLink: !!externalUrl,
  };
}

async function searchOne(query: string, lookbackHours: number): Promise<{ items: RedditItem[]; rateLimited: boolean }> {
  const t = lookbackHours <= 24 ? "day" : lookbackHours <= 168 ? "week" : "month";
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(query)}&sort=new&limit=25&t=${t}`;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
  if (res.status === 429) return { items: [], rateLimited: true };
  if (!res.ok) return { items: [], rateLimited: false };
  const json = (await res.json()) as { data?: { children?: RedditChild[] } };
  const fetchedAt = Date.now();
  const items = (json.data?.children ?? []).map((c) => mapChild(c, query, fetchedAt)).filter((i): i is RedditItem => i !== null);
  return { items, rateLimited: false };
}

export const redditResearchProvider: RedditResearchProvider = {
  name: "reddit-public-search",
  async searchPlayer(input: RedditSearchInput): Promise<RedditResearchResult> {
    const fetchedAt = Date.now();
    if (!isEnabled()) {
      return { status: "unavailable", items: [], note: "Reddit research is disabled (set REDDIT_RESEARCH_ENABLED=1).", fetchedAt };
    }
    const lookbackHours = input.lookbackHours ?? 24;
    const queries = generatePlayerQueries(input).slice(0, MAX_QUERIES).map((q) => q.query);
    const settled = await Promise.allSettled(queries.map((q) => searchOne(q, lookbackHours)));

    const byId = new Map<string, RedditItem>();
    let rateLimited = false;
    let anyOk = false;
    const cutoff = fetchedAt - lookbackHours * 3600_000;
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      anyOk = true;
      if (s.value.rateLimited) rateLimited = true;
      for (const it of s.value.items) {
        if (it.createdAt < cutoff) continue; // enforce recency
        byId.set(it.id, it); // dedup identical items across queries
      }
    }
    if (rateLimited && byId.size === 0) {
      return { status: "rate_limited", items: [], note: "Reddit rate-limited the request.", fetchedAt };
    }
    if (!anyOk) {
      return { status: "unavailable", items: [], note: "Reddit search failed for all queries.", fetchedAt };
    }
    return { status: "available", items: [...byId.values()], fetchedAt };
  },
};

/** A provider that is always cleanly unavailable — used when research is off. */
export const disabledRedditProvider: RedditResearchProvider = {
  name: "reddit-disabled",
  async searchPlayer(): Promise<RedditResearchResult> {
    return { status: "unavailable", items: [], note: "Reddit research provider is disabled.", fetchedAt: Date.now() };
  },
};
