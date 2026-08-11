/* ============================================================================
   Search-query generation. For a selected player we generate FOCUSED, context-term
   queries (never a bare name) and target relevant communities. Pure.
   ========================================================================== */

import type { RedditSearchInput } from "./types";

/** Context terms that surface actionable player signals. */
const CONTEXT_TERMS = [
  "injury", "scratch", "pitch count", "pitch limit", "velocity", "command",
  "walks", "bullpen", "opener", "lineup", "role", "IL", "return",
];

const BASE_SUBREDDITS = ["baseball", "fantasybaseball"];

/** MLB team name → subreddit (best-effort; unknown teams are simply omitted). */
const TEAM_SUBREDDITS: Record<string, string> = {
  "yankees": "NYYankees", "red sox": "redsox", "blue jays": "Torontobluejays",
  "rays": "tampabayrays", "orioles": "orioles", "guardians": "clevelandguardians",
  "twins": "minnesotatwins", "white sox": "whitesox", "tigers": "motorcity",
  "royals": "kansascityroyals", "astros": "astros", "rangers": "texasrangers",
  "mariners": "mariners", "angels": "angelsbaseball", "athletics": "oaklandathletics",
  "braves": "braves", "mets": "newyorkmets", "phillies": "phillies",
  "marlins": "letsgofish", "nationals": "nationals", "cubs": "chicubs",
  "cardinals": "cardinals", "brewers": "brewers", "reds": "reds", "pirates": "buccos",
  "dodgers": "dodgers", "padres": "padres", "giants": "sfgiants",
  "diamondbacks": "azdiamondbacks", "rockies": "coloradorockies",
};

function teamSub(team?: string): string | undefined {
  if (!team) return undefined;
  const t = team.toLowerCase();
  for (const [name, sub] of Object.entries(TEAM_SUBREDDITS)) if (t.includes(name)) return sub;
  return undefined;
}

export interface GeneratedQuery {
  query: string;
  contextTerm: string;
  subreddits: string[];
}

/**
 * Build focused per-context queries for a player. The player name is always
 * quoted and paired with a context term; subreddits include the base MLB
 * communities plus the player's and opponent's team subs when resolvable.
 */
export function generatePlayerQueries(input: RedditSearchInput): GeneratedQuery[] {
  const name = input.playerName.trim();
  if (!name) return [];
  const subs = [
    ...BASE_SUBREDDITS,
    ...[teamSub(input.team), teamSub(input.opponent)].filter((s): s is string => !!s),
  ];
  const uniqueSubs = [...new Set(subs)];
  return CONTEXT_TERMS.map((term) => ({
    query: `"${name}" ${term}`,
    contextTerm: term,
    subreddits: uniqueSubs,
  }));
}

/** The subreddits relevant to this player (for provider `subreddit:` scoping). */
export function relevantSubreddits(input: RedditSearchInput): string[] {
  return [...new Set([...BASE_SUBREDDITS, ...[teamSub(input.team), teamSub(input.opponent)].filter((s): s is string => !!s)])];
}
