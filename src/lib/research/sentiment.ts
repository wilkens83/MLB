/* ============================================================================
   Community sentiment / discussion direction — a SECONDARY, clearly-separated
   signal. Keyword-based lean (MORE vs LESS) over relevant items only. It is never
   predictive and never fed into the model. Below a minimum sample it reports
   `insufficient_sample` rather than a spurious percentage.
   ========================================================================== */

import type { RedditItem, CommunitySentiment } from "./types";

const MIN_SAMPLE = 6;

const MORE_RE = /\b(over|more|smash|lock|hammer|easy over|going over|takes? the over)\b/i;
const LESS_RE = /\b(under|less|fade|avoid|no chance|takes? the under|going under)\b/i;
const POS_RE = /\b(great|strong|elite|dealing|locked in|healthy|good matchup)\b/i;
const NEG_RE = /\b(bad|struggling|concern|worried|risky|tough matchup|slump)\b/i;

/** Compute discussion direction over the relevant items. Never predictive. */
export function computeSentiment(items: RedditItem[]): CommunitySentiment {
  let more = 0, less = 0, pos = 0, neg = 0, relevant = 0;
  for (const it of items) {
    const t = `${it.title ?? ""} ${it.body ?? ""}`;
    const m = MORE_RE.test(t), l = LESS_RE.test(t), p = POS_RE.test(t), n = NEG_RE.test(t);
    if (!m && !l && !p && !n) continue;
    relevant++;
    if (m) more++;
    if (l) less++;
    if (p) pos++;
    if (n) neg++;
  }
  if (relevant < MIN_SAMPLE) {
    return { relevantMentions: relevant, status: "insufficient_sample" };
  }
  const dir = more + less;
  const val = pos + neg;
  return {
    morePct: dir ? round(more / dir) : undefined,
    lessPct: dir ? round(less / dir) : undefined,
    positivePct: val ? round(pos / val) : undefined,
    negativePct: val ? round(neg / val) : undefined,
    neutralPct: undefined,
    relevantMentions: relevant,
    status: "available",
  };
}

function round(x: number): number { return Math.round(x * 100) / 100; }
