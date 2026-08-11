/* ============================================================================
   Trend velocity + freshness. Reddit context decays quickly, so we count mentions
   in 1h / 6h / 24h windows and classify rising / stable / falling. This is a
   breaking-news detector, NOT a prediction input. Pure.
   ========================================================================== */

import type { RedditItem, RedditTrend } from "./types";

const H = 3600 * 1000;

export function computeTrend(items: RedditItem[], now = Date.now()): RedditTrend {
  const age = (it: RedditItem) => now - it.createdAt;
  const m1 = items.filter((it) => age(it) <= 1 * H).length;
  const m6 = items.filter((it) => age(it) <= 6 * H).length;
  const m24 = items.filter((it) => age(it) <= 24 * H).length;
  const threads24 = new Set(items.filter((it) => age(it) <= 24 * H).map((it) => it.url.split("?")[0])).size;

  // Rising when the recent hourly rate outpaces the 24h hourly rate.
  const rate1 = m1;
  const rate24 = m24 / 24;
  let trend: RedditTrend["trend"] = "stable";
  if (m24 > 0) {
    if (rate1 > rate24 * 2 && m1 >= 2) trend = "rising";
    else if (m6 === 0 && m24 > 0) trend = "falling";
  }
  return { mentions1h: m1, mentions6h: m6, mentions24h: m24, uniqueThreads24h: threads24, trend };
}

/** How fresh (minutes ago) the most recent supporting item is. */
export function minutesSince(ts: number, now = Date.now()): number {
  return Math.max(0, Math.round((now - ts) / 60000));
}
