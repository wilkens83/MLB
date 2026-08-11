/* ============================================================================
   Deterministic classification + spam filtering of raw Reddit items into
   candidate context signals. Keyword-driven (auditable), NOT sentiment-driven and
   NOT probabilistic. An item that matches no actionable pattern is dropped.
   ========================================================================== */

import type { RedditItem, ContextEventType } from "./types";

interface Pattern {
  type: ContextEventType;
  re: RegExp;
}

/** Ordered patterns — earlier (more specific/severe) win when several match. */
const PATTERNS: Pattern[] = [
  { type: "scratch", re: /\b(scratched|late scratch|scratch|pulled from (the )?lineup|out of (the )?lineup)\b/i },
  { type: "injury", re: /\b(injur(y|ed)|hurt|strain(ed)?|sprain(ed)?|soreness|tightness|discomfort|placed on the il|to the il|left the game)\b/i },
  { type: "return_from_il", re: /\b(return(ing|s)? from (the )?il|activated from|off the il|reinstated|back from injury)\b/i },
  { type: "pitch_limit", re: /\b(pitch (count |)limit|pitch cap|capped at|limited to \d+|\d+[- ]pitch (cap|limit)|(around|about|to|at|near)\s+\d{2,3}\s*pitches|on a (pitch |)count)\b/i },
  { type: "opener", re: /\b(opener|bullpen game|piggyback)\b/i },
  { type: "role_change", re: /\b(moved to the (pen|bullpen|rotation)|role change|demot(ed|ion)|promot(ed|ion)|now (a )?(starter|reliever|closer))\b/i },
  { type: "velocity_change", re: /\b(velo(city)?( (is )?(down|drop|dip|declin))|lost velocity|sitting \d+ mph|down \d+ mph|velo concern)\b/i },
  { type: "command_issue", re: /\b(command (issue|problem|off)|control (issue|problem)|walk(ing)? (everyone|a ton|guys)|can'?t find the (zone|plate)|wild)\b/i },
  { type: "fatigue", re: /\b(fatigue|tired|gassed|worn down|heavy workload|overworked)\b/i },
  { type: "lineup", re: /\b(batting (1st|2nd|3rd|leadoff|cleanup|\dth)|lineup card|starting today|in the lineup)\b/i },
  { type: "bullpen_game", re: /\bbullpen game\b/i },
];

/** Low-signal patterns that mark an item as spam/noise. */
const SPAM_RE = [
  /^\W{0,3}(lfg|lets go|nice|lol|lmao|w|l|this|same|fr|based)\W{0,3}$/i, // one-word reactions
  /\b(bet slip|parlay|cash(ed)? out|hit my|tailing|units?)\b/i, // bet slips
  /\b(meme|shitpost|circlejerk)\b/i,
  /\b(trade (offer|advice|proposal)|would you (trade|drop)|who do i (start|sit))\b/i, // fantasy trade noise
];

const BOT_AUTHORS = /(bot|automoderator)/i;

export function isSpam(item: RedditItem): boolean {
  const text = `${item.title ?? ""} ${item.body ?? ""}`.trim();
  if (text.length < 8) return true; // too short to carry a signal
  if (item.author && BOT_AUTHORS.test(item.author)) return true;
  return SPAM_RE.some((re) => re.test(text));
}

export interface ClassifiedItem {
  item: RedditItem;
  type: ContextEventType;
  /** normalized keyword bucket for dedup clustering. */
  keywordKey: string;
}

/** Classify one item into a context type, or null if it carries no signal. */
export function classifyItem(item: RedditItem): ClassifiedItem | null {
  if (isSpam(item)) return null;
  const text = `${item.title ?? ""} ${item.body ?? ""}`;
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      return { item, type: p.type, keywordKey: normalizeKey(text, p.type) };
    }
  }
  return null;
}

/** Classify a batch, dropping spam and unmatched items. */
export function classifyItems(items: RedditItem[]): ClassifiedItem[] {
  return items.map(classifyItem).filter((c): c is ClassifiedItem => c !== null);
}

/** A coarse normalized key (type + salient tokens) so near-duplicate rumors cluster. */
function normalizeKey(text: string, type: ContextEventType): string {
  const nums = (text.match(/\b\d{2,3}\b/g) ?? []).slice(0, 1); // e.g. "80" pitches
  return `${type}:${nums.join("")}`;
}
