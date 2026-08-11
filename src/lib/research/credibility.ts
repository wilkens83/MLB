/* ============================================================================
   Source credibility. Not every Reddit comment is equal. A cluster's credibility
   rises with an external/official link, a beat-reporter reference, multiple
   independent threads, relevant subreddits, and recency. Deterministic + pure.
   ========================================================================== */

import type { SourceCredibility } from "./types";
import type { EventCluster } from "./dedupe";

const OFFICIAL_LINK_RE = /(mlb\.com|\.mlb\.com|espn\.com|mlbtraderumors|theathletic|apnews|reuters)/i;
const BEAT_RE = /(beat (reporter|writer)|per @|reports?|according to|\bsource(s)?\b)/i;
const RELEVANT_SUBS = new Set(["baseball", "fantasybaseball"]);

const RECENT_MS = 6 * 3600 * 1000;

export function assessCredibility(cluster: EventCluster, now = Date.now()): SourceCredibility {
  const reasons: string[] = [];
  let score = 0;

  const anyExternal = cluster.items.some((c) => c.item.hasExternalLink);
  const anyOfficial = cluster.items.some((c) => OFFICIAL_LINK_RE.test(c.item.url) || OFFICIAL_LINK_RE.test(c.item.body ?? "") || OFFICIAL_LINK_RE.test(c.item.title ?? ""));
  const anyBeat = cluster.items.some((c) => BEAT_RE.test(`${c.item.title ?? ""} ${c.item.body ?? ""}`));
  const relevantSub = cluster.subreddits.some((s) => RELEVANT_SUBS.has(s.toLowerCase()) || cluster.subreddits.length > 0);
  const recent = now - cluster.lastSeenAt <= RECENT_MS;

  if (anyOfficial) { score += 2; reasons.push("links an official/established outlet"); }
  else if (anyExternal) { score += 1; reasons.push("links an external source"); }
  if (anyBeat) { score += 1; reasons.push("references a reporter/source"); }
  if (cluster.uniqueThreads >= 3) { score += 2; reasons.push(`${cluster.uniqueThreads} independent threads`); }
  else if (cluster.uniqueThreads === 2) { score += 1; reasons.push("2 independent threads"); }
  if (relevantSub) reasons.push("posted in relevant baseball community");
  if (recent) { score += 1; reasons.push("recent activity"); }
  if (!anyExternal && !anyOfficial && !anyBeat) reasons.push("no external source linked");

  const level: SourceCredibility["level"] = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { level, reasons };
}
