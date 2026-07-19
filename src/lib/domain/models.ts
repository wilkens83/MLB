/* ============================================================================
   Normalized internal domain models. The analytics engine consumes ONLY these
   types — never raw external API shapes. Providers are responsible for mapping
   their source responses into these entities.
   ========================================================================== */

export type Handedness = "L" | "R" | "S" | "unknown";

export interface PlayerEntity {
  id: number;
  name: string;
  position: string;
  isPitcher: boolean;
  teamId?: number;
  teamName?: string;
  bats: Handedness;
  throws: Handedness;
  number?: string;
}

export interface TeamEntity {
  id: number;
  name: string;
  abbreviation?: string;
  venueName?: string;
}

export interface GameEntity {
  gamePk: number;
  date: string;
  state: "preview" | "live" | "final";
  detailedState: string;
  venueName?: string;
  dayNight: "day" | "night" | "unknown";
  home: GameSideEntity;
  away: GameSideEntity;
  currentInning?: number;
  inningState?: string;
}

export interface GameSideEntity {
  teamId: number;
  teamName: string;
  score?: number;
  isWinner?: boolean;
  probablePitcherId?: number;
  probablePitcherName?: string;
  wins?: number;
  losses?: number;
}

/** One game's worth of a single derived stat, ordered oldest→newest by caller. */
export interface GameLogEntry {
  date?: string;
  opponentId?: number;
  opponentName?: string;
  isHome?: boolean;
  gamePk?: number;
  /** Raw box-score fields relevant to props (already normalized keys). */
  stat: Record<string, number>;
}

export interface BallparkEntity {
  venueName: string;
  runs: number;
  hr: number;
  hits: number;
}

export interface WeatherEntity {
  venueName?: string;
  tempF?: number;
  condition?: string;
  windMph?: number;
  windDir?: string;
  available: boolean;
}

export interface LineupSlot {
  playerId: number;
  playerName: string;
  battingOrder: number;
  position: string;
}

export interface LineupEntity {
  gamePk: number;
  teamId: number;
  confirmed: boolean;
  slots: LineupSlot[];
  available: boolean;
}

export interface SportsbookLine {
  propKey: string;
  line: number;
  overAmerican?: number;
  underAmerican?: number;
  book?: string;
  /** Source of the price: "manual" when user-entered. No paid feed is wired. */
  source: "manual" | "feed";
}

/**
 * Statcast metric bundle for a player. Every field is optional — a metric that
 * the source does not provide stays `undefined` and MUST be surfaced as
 * "unavailable" in the UI rather than defaulted to a number.
 */
export interface StatcastBatter {
  playerId: number;
  season: number;
  pa?: number;
  ab?: number;
  kPct?: number;
  bbPct?: number;
  battingAvg?: number;
  slg?: number;
  obp?: number;
  woba?: number;
  xwoba?: number;
  exitVeloAvg?: number;
  launchAngleAvg?: number;
  sweetSpotPct?: number;
  barrelPct?: number;
  hardHitPct?: number;
  whiffPct?: number;
  swingPct?: number;
  /** Which named metrics were present in the source row. */
  availableMetrics: string[];
  fetchedAt: number;
}

export interface StatcastPitcher {
  playerId: number;
  season: number;
  ip?: number;
  pa?: number;
  kPct?: number;
  bbPct?: number;
  woba?: number;
  xwoba?: number;
  exitVeloAvgAllowed?: number;
  barrelPctAllowed?: number;
  hardHitPctAllowed?: number;
  whiffPct?: number;
  gbPct?: number;
  fbPct?: number;
  ldPct?: number;
  fastballVelo?: number;
  availableMetrics: string[];
  fetchedAt: number;
}

/** A single named contribution to a projection, in the prop's own units. */
export interface AdjustmentFactor {
  key: string;
  label: string;
  /** Additive delta applied to the running projection (prop units). */
  delta: number;
  /** The multiplier this factor represented (1.0 = neutral), for transparency. */
  multiplier: number;
  direction: "up" | "down" | "neutral";
}

export interface AdjustmentBreakdown {
  base: number;
  factors: AdjustmentFactor[];
  final: number;
}

export type WarningCode =
  | "small_sample"
  | "unconfirmed_lineup"
  | "missing_statcast"
  | "uncertain_starter"
  | "missing_weather"
  | "model_disagreement"
  | "manual_odds"
  | "stale_data";

export interface PredictionWarning {
  code: WarningCode;
  message: string;
  severity: "info" | "warn" | "high";
}

/** Provenance recorded with every prediction (2M governance foundation). */
export interface PredictionProvenance {
  modelVersion: string;
  seed: string;
  dataTimestamp: number;
  sources: { name: string; available: boolean; fetchedAt?: number }[];
}

export interface DataQuality {
  /** 0..100 composite of sample size + source availability. */
  score: number;
  sampleSize: number;
  hasStatcast: boolean;
  hasOpponent: boolean;
  hasWeather: boolean;
  hasLineup: boolean;
  tier: "high" | "medium" | "low";
}
