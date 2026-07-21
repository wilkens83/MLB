/* ============================================================================
   Prop catalog — the canonical registry of every market the platform supports.
   Each entry declares how the prop is measured from a box score and which
   statistical family the prediction engine should use to model it.
   ========================================================================== */

export type PropCategory = "batter" | "pitcher" | "team" | "game";

/**
 * Distribution family used by the projection engine:
 *  - "poisson"    : low-mean event counts (HR, walks, steals, ER)
 *  - "negbinom"   : overdispersed counts (strikeouts, total bases, hits+runs+rbi)
 *  - "bernoulli"  : yes/no outcomes (NRFI, RFI, moneyline)
 *  - "normal"     : approximately continuous / large counts (fantasy points, team totals)
 */
export type DistFamily = "poisson" | "negbinom" | "bernoulli" | "normal";

export interface PropDef {
  key: string;
  label: string;
  shortLabel: string;
  category: PropCategory;
  family: DistFamily;
  /** Typical sportsbook line, used as a sensible default when none is supplied. */
  defaultLine: number;
  /** Line increments offered by books (0.5 for most, 1 for some integer markets). */
  step: number;
  /** Higher-is-better direction for "over" being the bettor-friendly side by default. */
  unit: string;
  description: string;
  /** Which per-game box-score field(s) this prop reads. Used by the analytics layer. */
  statKeys: string[];
}

export const PROP_CATALOG: PropDef[] = [
  // ---- Pitcher ----
  {
    key: "strikeouts",
    label: "Strikeouts",
    shortLabel: "Ks",
    category: "pitcher",
    family: "negbinom",
    defaultLine: 5.5,
    step: 0.5,
    unit: "K",
    description: "Total batters struck out by the pitcher.",
    statKeys: ["strikeOuts"],
  },
  {
    key: "pitcher_outs",
    label: "Pitcher Outs",
    shortLabel: "Outs",
    category: "pitcher",
    family: "negbinom",
    defaultLine: 17.5,
    step: 0.5,
    unit: "outs",
    description: "Outs recorded (innings pitched × 3).",
    statKeys: ["outs"],
  },
  {
    key: "earned_runs",
    label: "Earned Runs",
    shortLabel: "ER",
    category: "pitcher",
    family: "poisson",
    defaultLine: 2.5,
    step: 0.5,
    unit: "ER",
    description: "Earned runs allowed.",
    statKeys: ["earnedRuns"],
  },
  {
    key: "hits_allowed",
    label: "Hits Allowed",
    shortLabel: "HA",
    category: "pitcher",
    family: "negbinom",
    defaultLine: 5.5,
    step: 0.5,
    unit: "hits",
    description: "Hits surrendered by the pitcher.",
    statKeys: ["hits"],
  },
  {
    key: "pitcher_walks",
    label: "Walks Allowed",
    shortLabel: "BB",
    category: "pitcher",
    family: "poisson",
    defaultLine: 1.5,
    step: 0.5,
    unit: "BB",
    description: "Walks issued by the pitcher.",
    statKeys: ["baseOnBalls"],
  },
  {
    key: "home_runs_allowed",
    label: "Home Runs Allowed",
    shortLabel: "HRA",
    category: "pitcher",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "HR",
    description: "Home runs allowed by the pitcher.",
    statKeys: ["homeRuns"],
  },

  // ---- Batter ----
  {
    key: "hits",
    label: "Hits",
    shortLabel: "H",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "hits",
    description: "Total hits by the batter.",
    statKeys: ["hits"],
  },
  {
    key: "home_runs",
    label: "Home Runs",
    shortLabel: "HR",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "HR",
    description: "Home runs hit.",
    statKeys: ["homeRuns"],
  },
  {
    key: "runs",
    label: "Runs",
    shortLabel: "R",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "runs",
    description: "Runs scored by the batter.",
    statKeys: ["runs"],
  },
  {
    key: "rbis",
    label: "RBIs",
    shortLabel: "RBI",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "RBI",
    description: "Runs batted in.",
    statKeys: ["rbi"],
  },
  {
    key: "total_bases",
    label: "Total Bases",
    shortLabel: "TB",
    category: "batter",
    family: "negbinom",
    defaultLine: 1.5,
    step: 0.5,
    unit: "bases",
    description: "Total bases (1B + 2×2B + 3×3B + 4×HR).",
    statKeys: ["totalBases"],
  },
  {
    key: "hits_runs_rbis",
    label: "Hits + Runs + RBIs",
    shortLabel: "H+R+RBI",
    category: "batter",
    family: "negbinom",
    defaultLine: 1.5,
    step: 0.5,
    unit: "combined",
    description: "Combined hits, runs and runs batted in.",
    statKeys: ["hits", "runs", "rbi"],
  },
  {
    key: "singles",
    label: "Singles",
    shortLabel: "1B",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "1B",
    description: "Singles hit (hits − 2B − 3B − HR).",
    statKeys: ["singles"],
  },
  {
    key: "doubles",
    label: "Doubles",
    shortLabel: "2B",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "2B",
    description: "Doubles hit.",
    statKeys: ["doubles"],
  },
  {
    key: "triples",
    label: "Triples",
    shortLabel: "3B",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "3B",
    description: "Triples hit.",
    statKeys: ["triples"],
  },
  {
    key: "walks",
    label: "Walks",
    shortLabel: "BB",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "BB",
    description: "Walks drawn by the batter.",
    statKeys: ["baseOnBalls"],
  },
  {
    key: "batter_strikeouts",
    label: "Batter Strikeouts",
    shortLabel: "K",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "K",
    description: "Times the batter strikes out.",
    statKeys: ["strikeOuts"],
  },
  {
    key: "steals",
    label: "Stolen Bases",
    shortLabel: "SB",
    category: "batter",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "SB",
    description: "Bases stolen.",
    statKeys: ["stolenBases"],
  },
  {
    key: "fantasy_points",
    label: "Fantasy Points",
    shortLabel: "FP",
    category: "batter",
    family: "normal",
    defaultLine: 7.5,
    step: 0.5,
    unit: "pts",
    description: "DFS fantasy points (DraftKings scoring).",
    statKeys: ["fantasyPoints"],
  },

  // ---- Team / Game ----
  {
    key: "first_inning_runs",
    label: "First Inning Runs",
    shortLabel: "1st Inn R",
    category: "game",
    family: "poisson",
    defaultLine: 0.5,
    step: 0.5,
    unit: "runs",
    description: "Total runs scored in the first inning by both teams.",
    statKeys: ["firstInningRuns"],
  },
  {
    key: "rfi",
    label: "Run First Inning (RFI)",
    shortLabel: "RFI",
    category: "team",
    family: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "yes/no",
    description: "Team scores in the first inning.",
    statKeys: ["firstInningRuns"],
  },
  {
    key: "nrfi",
    label: "No Run First Inning (NRFI)",
    shortLabel: "NRFI",
    category: "game",
    family: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "yes/no",
    description: "Neither team scores in the first inning.",
    statKeys: ["firstInningRuns"],
  },
  {
    key: "team_hits",
    label: "Team Hits",
    shortLabel: "Tm H",
    category: "team",
    family: "negbinom",
    defaultLine: 7.5,
    step: 0.5,
    unit: "hits",
    description: "Total hits by a team.",
    statKeys: ["hits"],
  },
  {
    key: "team_total",
    label: "Team Total Runs",
    shortLabel: "Tm Tot",
    category: "team",
    family: "poisson",
    defaultLine: 4.5,
    step: 0.5,
    unit: "runs",
    description: "Total runs scored by a team.",
    statKeys: ["runs"],
  },
  {
    key: "moneyline",
    label: "Moneyline",
    shortLabel: "ML",
    category: "game",
    family: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "win",
    description: "Team wins the game outright.",
    statKeys: ["win"],
  },
  {
    key: "spread",
    label: "Run Line / Spread",
    shortLabel: "RL",
    category: "game",
    family: "normal",
    defaultLine: -1.5,
    step: 0.5,
    unit: "runs",
    description: "Team covers the run line (typically ±1.5).",
    statKeys: ["runMargin"],
  },
  {
    key: "total_runs",
    label: "Total Runs",
    shortLabel: "O/U",
    category: "game",
    family: "poisson",
    defaultLine: 8.5,
    step: 0.5,
    unit: "runs",
    description: "Combined runs scored by both teams.",
    statKeys: ["totalRuns"],
  },
];

export const PROP_BY_KEY: Record<string, PropDef> = Object.fromEntries(
  PROP_CATALOG.map((p) => [p.key, p]),
);

export function propsByCategory(category: PropCategory): PropDef[] {
  return PROP_CATALOG.filter((p) => p.category === category);
}

export function getProp(key: string): PropDef | undefined {
  return PROP_BY_KEY[key];
}
