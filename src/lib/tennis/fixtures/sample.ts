/* ============================================================================
   TEST-ONLY tennis fixtures. These are hand-authored sample records used to
   exercise the acquisition + validation pipeline WITHOUT any live provider
   credentials. They are labeled and MUST NEVER be served from a production data
   path (the fixture provider reports status "fixture" so callers can refuse it
   in production). Player/tournament names are real for realism, but every value
   here is illustrative sample data, not a live feed.
   ========================================================================== */

import type {
  TennisPlayer, TennisMatch, RankingSnapshot, Tournament,
} from "../domain";

export const FIXTURE_PLAYERS: TennisPlayer[] = [
  {
    id: "de-alcaraz-carlos",
    fullName: "Carlos Alcaraz",
    normalizedName: "alcaraz carlos",
    tour: "atp",
    countryCode: "ESP",
    dateOfBirth: "2003-05-05",
    plays: "right",
    backhand: "two_handed",
    heightCm: 183,
    turnedProYear: 2018,
    externalIds: { fixture: "fx-atp-001" },
  },
  {
    id: "de-sinner-jannik",
    fullName: "Jannik Sinner",
    normalizedName: "sinner jannik",
    tour: "atp",
    countryCode: "ITA",
    dateOfBirth: "2001-08-16",
    plays: "right",
    backhand: "two_handed",
    heightCm: 191,
    turnedProYear: 2018,
    externalIds: { fixture: "fx-atp-002" },
  },
  {
    id: "de-swiatek-iga",
    fullName: "Iga Swiatek",
    normalizedName: "swiatek iga",
    tour: "wta",
    countryCode: "POL",
    dateOfBirth: "2001-05-31",
    plays: "right",
    backhand: "two_handed",
    heightCm: 176,
    turnedProYear: 2016,
    externalIds: { fixture: "fx-wta-001" },
  },
  {
    id: "de-sabalenka-aryna",
    fullName: "Aryna Sabalenka",
    normalizedName: "sabalenka aryna",
    tour: "wta",
    countryCode: "BLR",
    dateOfBirth: "1998-05-05",
    plays: "right",
    backhand: "two_handed",
    heightCm: 182,
    turnedProYear: 2015,
    externalIds: { fixture: "fx-wta-002" },
  },
];

export const FIXTURE_TOURNAMENTS: Tournament[] = [
  {
    id: "de-tour-wimbledon-2025",
    name: "Wimbledon",
    tour: "atp",
    level: "grand_slam",
    surface: "grass",
    environment: "outdoor",
    city: "London",
    countryCode: "GBR",
    startDate: "2025-06-30",
    endDate: "2025-07-13",
    season: 2025,
    externalIds: { fixture: "fx-trn-001" },
  },
  {
    id: "de-tour-rolandgarros-2025",
    name: "Roland Garros",
    tour: "wta",
    level: "grand_slam",
    surface: "clay",
    environment: "outdoor",
    city: "Paris",
    countryCode: "FRA",
    startDate: "2025-05-25",
    endDate: "2025-06-08",
    season: 2025,
    externalIds: { fixture: "fx-trn-002" },
  },
];

export const FIXTURE_RANKINGS: RankingSnapshot[] = [
  { playerId: "de-sinner-jannik", tour: "atp", asOf: "2025-07-07", rank: 1, points: 10330 },
  { playerId: "de-alcaraz-carlos", tour: "atp", asOf: "2025-07-07", rank: 2, points: 8850 },
  { playerId: "de-sabalenka-aryna", tour: "wta", asOf: "2025-07-07", rank: 1, points: 11553 },
  { playerId: "de-swiatek-iga", tour: "wta", asOf: "2025-07-07", rank: 4, points: 7375 },
];

/** A completed best-of-5 grass-court match with full stat lines. */
export const FIXTURE_COMPLETED_MATCH: TennisMatch = {
  id: "de-match-2025-wimb-final",
  tournamentId: "de-tour-wimbledon-2025",
  season: 2025,
  surface: "grass",
  environment: "outdoor",
  format: "best_of_5",
  round: "final",
  state: "completed",
  startTime: "2025-07-13T14:00:00Z",
  home: {
    playerId: "de-sinner-jannik", playerName: "Jannik Sinner",
    side: "home", seed: 1, rankAtMatch: 1, isWinner: true,
  },
  away: {
    playerId: "de-alcaraz-carlos", playerName: "Carlos Alcaraz",
    side: "away", seed: 2, rankAtMatch: 2, isWinner: false,
  },
  sets: [
    { homeGames: 4, awayGames: 6 },
    { homeGames: 6, awayGames: 4 },
    { homeGames: 6, awayGames: 4 },
    { homeGames: 6, awayGames: 4 },
  ],
  stats: [
    {
      playerId: "de-sinner-jannik",
      aces: 14, doubleFaults: 2,
      firstServePct: 0.63, firstServeWonPct: 0.79, secondServeWonPct: 0.58,
      breakPointsFaced: 6, breakPointsSaved: 5,
      serviceGamesPlayed: 19, serviceGamesWon: 18,
      returnGamesPlayed: 19, returnGamesWon: 4,
      availableMetrics: ["aces", "doubleFaults", "firstServePct", "firstServeWonPct", "secondServeWonPct", "breakPointsFaced", "breakPointsSaved", "serviceGamesPlayed", "serviceGamesWon", "returnGamesPlayed", "returnGamesWon"],
    },
    {
      playerId: "de-alcaraz-carlos",
      aces: 7, doubleFaults: 3,
      firstServePct: 0.61, firstServeWonPct: 0.72, secondServeWonPct: 0.52,
      breakPointsFaced: 8, breakPointsSaved: 4,
      serviceGamesPlayed: 19, serviceGamesWon: 15,
      returnGamesPlayed: 19, returnGamesWon: 1,
      availableMetrics: ["aces", "doubleFaults", "firstServePct", "firstServeWonPct", "secondServeWonPct", "breakPointsFaced", "breakPointsSaved", "serviceGamesPlayed", "serviceGamesWon", "returnGamesPlayed", "returnGamesWon"],
    },
  ],
  externalIds: { fixture: "fx-mch-001" },
  sources: ["fixture"],
};

/** An upcoming scheduled fixture (no result yet). */
export const FIXTURE_SCHEDULED_MATCH: TennisMatch = {
  id: "de-match-2025-rg-sf",
  tournamentId: "de-tour-rolandgarros-2025",
  season: 2025,
  surface: "clay",
  environment: "outdoor",
  format: "best_of_3",
  round: "semifinal",
  state: "scheduled",
  startTime: "2025-06-05T13:00:00Z",
  home: { playerId: "de-swiatek-iga", playerName: "Iga Swiatek", side: "home", seed: 4, rankAtMatch: 4 },
  away: { playerId: "de-sabalenka-aryna", playerName: "Aryna Sabalenka", side: "away", seed: 1, rankAtMatch: 1 },
  sets: [],
  stats: [],
  externalIds: { fixture: "fx-mch-002" },
  sources: ["fixture"],
};

export const FIXTURE_MATCHES: TennisMatch[] = [FIXTURE_COMPLETED_MATCH, FIXTURE_SCHEDULED_MATCH];
