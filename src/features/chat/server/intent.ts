/* ============================================================================
   Deterministic intent classifier. Maps a natural-language question to a plan of
   controlled tool calls. Used by the mock provider (default, no API key) and as
   a safety fallback. It NEVER invents data — it only decides which typed tools to
   run; the tools return the real numbers.
   ========================================================================== */

import { parseWindow } from "./date";

export type IntentKind =
  | "games"
  | "pitcher-k-rankings"
  | "hitter-hr-rankings"
  | "compare"
  | "projection"
  | "why"
  | "prizepicks-board"
  | "prizepicks-edges"
  | "data-health"
  | "followup-filter"
  | "unsupported"
  | "clarify"
  | "help";

export interface IntentFilters {
  minOverProbability?: number;
  handedness?: "L" | "R";
  limit?: number;
  belowLine?: boolean;
}

export interface Intent {
  kind: IntentKind;
  filters: IntentFilters;
  /** Candidate player-name phrases to resolve via searchPlayers. */
  playerNames: string[];
  prop?: string;
  window?: number;
  /** Set for unsupported/clarify to explain to the user. */
  note?: string;
}

const PROP_KEYWORDS: { re: RegExp; prop: string }[] = [
  { re: /strikeout|k'?s\b|punch/, prop: "strikeouts" },
  { re: /home[- ]?run|\bhr\b|homer/, prop: "home_runs" },
  { re: /total b?ase/, prop: "total_bases" },
  { re: /\brbi/, prop: "rbis" },
  { re: /\bhits?\b/, prop: "hits" },
  { re: /\bruns?\b/, prop: "runs" },
  { re: /\bwalks?\b|bases on balls/, prop: "walks" },
  { re: /earned run/, prop: "earned_runs" },
  { re: /stolen|steals?\b/, prop: "steals" },
];

/** Data domains the chat cannot answer from available sources — answer honestly. */
const UNSUPPORTED: { re: RegExp; note: string }[] = [
  { re: /bullpen|reliever/, note: "Bullpen-quality modeling is not part of the available data set." },
  { re: /injur|\bil\b|day-to-day/, note: "The app has no reliable injury feed, so injury questions cannot be answered." },
  { re: /weather|wind|temperature|rain/, note: "Live weather is not currently wired into the chat tools." },
  { re: /first[- ]?inning|nrfi|\bfi\b scoring/, note: "First-inning / NRFI markets are not yet exposed to the chat tools." },
];

/** Sentence-initial command words that can masquerade as a capitalized name. */
const COMMAND_WORDS = new Set([
  "compare", "show", "which", "only", "why", "rank", "list", "get", "give", "tell",
  "find", "search", "who", "what", "when", "does", "do", "is", "are", "should", "how",
  "project", "the", "me", "top", "best", "and",
]);

function extractPlayerNames(message: string): string[] {
  // Capitalized multi-word sequences (naive but works with searchPlayers fuzz).
  const matches = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+)\b/g) ?? [];
  const cleaned = matches
    .map((phrase) => {
      // Drop leading command words ("Compare Aaron Judge" -> "Aaron Judge").
      const words = phrase.split(/\s+/);
      while (words.length > 1 && COMMAND_WORDS.has(words[0].toLowerCase())) words.shift();
      return words.join(" ");
    })
    .filter((p) => p.split(/\s+/).length >= 2); // keep full names only
  return [...new Set(cleaned)].slice(0, 4);
}

function detectProp(text: string): string | undefined {
  for (const { re, prop } of PROP_KEYWORDS) if (re.test(text)) return prop;
  return undefined;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const COUNT = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";
function asCount(token: string): number | undefined {
  const n = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
  return n && n > 0 && n <= 50 ? n : undefined;
}

function detectFilters(text: string): IntentFilters {
  const filters: IntentFilters = {};
  const prob = text.match(/(?:above|over|greater than|at least|>=?)\s*(\d{1,3})\s*%/);
  if (prob) filters.minOverProbability = Math.min(1, Number(prob[1]) / 100);
  const probWord = text.match(/(\d{1,3})\s*%\s*(?:or (?:more|higher)|\+)/);
  if (!prob && probWord) filters.minOverProbability = Math.min(1, Number(probWord[1]) / 100);
  if (/left[- ]?hand|\blhp\b|lefty|lefties/.test(text)) filters.handedness = "L";
  if (/right[- ]?hand|\brhp\b|righty|righties/.test(text)) filters.handedness = "R";
  // "top 5", "best five", "first 10"
  const topN = text.match(new RegExp(`(?:top|first|best)\\s+${COUNT}`));
  // "five strongest", "10 best", "five home-run projections"
  const nSuperlative = text.match(new RegExp(`${COUNT}\\s+(?:strongest|best|highest|top|home|hitters?|pitchers?|players?)`));
  const countToken = topN?.[1] ?? nSuperlative?.[1];
  if (countToken) filters.limit = asCount(countToken);
  if (/below (?:the )?(?:line|projection)|under (?:the )?projection/.test(text)) filters.belowLine = true;
  return filters;
}

const FOLLOWUP_RE = /^(only|just|now|and|also|filter|keep|show (?:me )?only|what about|of those|from (?:that|those))/i;

export function classifyIntent(
  message: string,
  opts: { hasPriorList: boolean } = { hasPriorList: false },
): Intent {
  const text = message.toLowerCase().trim();
  const filters = detectFilters(text);
  const window = parseWindow(text);
  const prop = detectProp(text);
  const names = extractPlayerNames(message);

  // Follow-up refinement of a previous list ("only left-handed", "above 60%").
  const isFollowup =
    opts.hasPriorList &&
    (FOLLOWUP_RE.test(text) ||
      (Object.keys(filters).length > 0 && names.length === 0 && !/\b(compare|games|prizepicks|health|missing)\b/.test(text)));
  if (isFollowup && (filters.minOverProbability !== undefined || filters.handedness || filters.belowLine || filters.limit)) {
    return { kind: "followup-filter", filters, playerNames: [], window };
  }

  // "Why" explanation of the prior pick / a named player's lean.
  if (/^why\b/.test(text) || /why (?:does|is|did|would) the model/.test(text)) {
    return { kind: "why", filters, playerNames: names, prop, window };
  }

  // Unsupported domains — answer honestly, never fabricate.
  for (const u of UNSUPPORTED) {
    if (u.re.test(text)) return { kind: "unsupported", filters, playerNames: names, note: u.note, prop };
  }

  // PrizePicks.
  if (/prize ?picks|\bpp\b board/.test(text)) {
    if (/edge|value|best|highest|top|lean|which lines/.test(text))
      return { kind: "prizepicks-edges", filters, playerNames: [], window };
    return { kind: "prizepicks-board", filters, playerNames: [], window };
  }

  // Data health / missing data.
  if (/missing data|data (?:health|missing|gap)|system health|what data|is savant|providers? (?:up|down|status)/.test(text)) {
    return { kind: "data-health", filters, playerNames: [], window };
  }

  // Comparison.
  if (/\bcompare\b|\bvs\.?\b|\bversus\b/.test(text) && names.length >= 2) {
    return { kind: "compare", filters, playerNames: names.slice(0, 2), prop, window };
  }

  // Rankings.
  if (prop === "strikeouts" && /pitcher|projection|best|top|highest|leader/.test(text)) {
    return { kind: "pitcher-k-rankings", filters, playerNames: [], window };
  }
  if (prop === "home_runs" && /probab|projection|best|top|highest|strongest|most likely/.test(text)) {
    return { kind: "hitter-hr-rankings", filters, playerNames: [], window };
  }

  // Single-player projection (name + prop).
  if (names.length >= 1 && prop) {
    return { kind: "projection", filters, playerNames: [names[0]], prop, window };
  }

  // Slate / games.
  if (/games?|slate|schedule|playing (?:today|tonight)|matchups?/.test(text)) {
    return { kind: "games", filters, playerNames: [], window };
  }

  // Greeting / help / capability question.
  if (/^(hi|hey|hello|help|what can you|how do you)/.test(text)) {
    return { kind: "help", filters, playerNames: [], window };
  }

  return { kind: "clarify", filters, playerNames: names, prop, window, note: undefined };
}
