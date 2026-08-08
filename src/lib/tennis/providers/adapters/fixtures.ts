/* ============================================================================
   Contract fixtures — sanitized, minimal, representative response payloads for
   each live provider, shaped per the official documentation captured 2026-08.
   They contain NO API keys or personal account metadata and are the evidence the
   adapter contract tests assert against. When a real credential is later used,
   capture a fresh sanitized fixture from the live payload and diff it here.

   provenance:
     - api-tennis:   https://api-tennis.com/documentation  (methods + fields)
     - sportradar:   Sportradar Tennis v3 (developer.sportradar.com/tennis)
     - sportsdataio: SportsDataIO v3/tennis (data dictionary; documented shape,
                     field names to be re-confirmed against a live payload)
   ========================================================================== */

// ---- API-Tennis -----------------------------------------------------------

export const API_TENNIS_FIXTURES = {
  success: 1,
  result: [
    {
      event_key: 1234567,
      event_date: "2026-08-08",
      event_time: "13:00",
      event_first_player: "Carlos Alcaraz",
      first_player_key: 1001,
      event_second_player: "Jannik Sinner",
      second_player_key: 1002,
      event_final_result: "2 - 1",
      event_status: "Finished",
      event_winner: "First Player",
      event_type_type: "Atp Singles",
      tournament_name: "Cincinnati Masters",
      tournament_key: 55,
      tournament_round: "Final",
      tournament_season: "2026",
      scores: [
        { score_first: "6", score_second: "4", score_set: "1" },
        { score_first: "3", score_second: "6", score_set: "2" },
        { score_first: "7", score_second: "5", score_set: "3" },
      ],
    },
    {
      event_key: 1234568,
      event_date: "2026-08-08",
      event_time: "18:30",
      event_first_player: "Iga Swiatek",
      first_player_key: 2001,
      event_second_player: "Aryna Sabalenka",
      second_player_key: 2002,
      event_status: "Not Started",
      event_type_type: "Wta Singles",
      tournament_name: "Cincinnati Open",
      tournament_key: 56,
      tournament_round: "Semi-final",
      tournament_season: "2026",
    },
  ],
};

export const API_TENNIS_STANDINGS = {
  success: 1,
  result: [
    { place: "1", player: "Jannik Sinner", player_key: 1002, league: "ATP", movement: "same", country: "Italy", points: "11830" },
    { place: "2", player: "Carlos Alcaraz", player_key: 1001, league: "ATP", movement: "up", country: "Spain", points: "8850" },
  ],
};

export const API_TENNIS_PLAYERS = {
  success: 1,
  result: [
    { player_key: 1001, player_name: "Carlos Alcaraz", player_country: "Spain", player_bday: "2003-05-05", stats: [] },
  ],
};

// ---- Sportradar Tennis v3 -------------------------------------------------

export const SPORTRADAR_SUMMARIES = {
  summaries: [
    {
      sport_event: {
        id: "sr:sport_event:100001",
        start_time: "2026-08-08T13:00:00+00:00",
        sport_event_context: {
          competition: { name: "Cincinnati Masters" },
          season: { year: "2026", name: "ATP Cincinnati 2026" },
          round: { name: "final" },
          category: { name: "ATP" },
        },
        sport_event_conditions: { court: { surface: "Hard court outdoor" } },
        competitors: [
          { id: "sr:competitor:2001", name: "Alcaraz, Carlos", country_code: "ESP", qualifier: "home" },
          { id: "sr:competitor:2002", name: "Sinner, Jannik", country_code: "ITA", qualifier: "away" },
        ],
      },
      sport_event_status: {
        status: "closed",
        winner_id: "sr:competitor:2001",
        period_scores: [
          { home_score: 6, away_score: 4, number: 1, type: "set" },
          { home_score: 3, away_score: 6, number: 2, type: "set" },
          { home_score: 7, away_score: 5, number: 3, type: "set" },
        ],
      },
    },
  ],
};

export const SPORTRADAR_RANKINGS = {
  rankings: [
    {
      name: "ATP",
      gender: "men",
      type_id: 1,
      competitor_rankings: [
        { rank: 1, points: 11830, competitor: { id: "sr:competitor:2002", name: "Sinner, Jannik", country_code: "ITA" } },
        { rank: 2, points: 8850, competitor: { id: "sr:competitor:2001", name: "Alcaraz, Carlos", country_code: "ESP" } },
      ],
    },
  ],
};

export const SPORTRADAR_PROFILE = {
  competitor: {
    id: "sr:competitor:2001",
    name: "Alcaraz, Carlos",
    country_code: "ESP",
    date_of_birth: "2003-05-05",
    handedness: "right",
  },
  info: { handedness: "right", height: 183, pro_year: 2018 },
};

// ---- SportsDataIO Tennis --------------------------------------------------

export const SPORTSDATAIO_GAMES = [
  {
    GameId: 900001,
    CompetitionName: "Cincinnati Masters",
    Season: 2026,
    Round: "Final",
    DateTime: "2026-08-08T13:00:00",
    Status: "Final",
    Surface: "Hard",
    Winner: "PlayerOne",
    PlayerOneId: 3001,
    PlayerTwoId: 3002,
    PlayerOne: "Carlos Alcaraz",
    PlayerTwo: "Jannik Sinner",
    Sets: [
      { Number: 1, PlayerOneScore: 6, PlayerTwoScore: 4 },
      { Number: 2, PlayerOneScore: 3, PlayerTwoScore: 6 },
      { Number: 3, PlayerOneScore: 7, PlayerTwoScore: 5 },
    ],
  },
];

export const SPORTSDATAIO_PLAYERS = [
  { PlayerId: 3001, FirstName: "Carlos", LastName: "Alcaraz", CommonName: "Carlos Alcaraz", BirthDate: "2003-05-05T00:00:00", Nationality: "Spain", Hand: "Right", Height: 183 },
];
