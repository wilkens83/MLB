/* ============================================================================
   Provider interfaces. The analytics layer depends on these abstractions, not
   on concrete data sources — so a source can be swapped or mocked in tests
   without touching the engine. Each provider maps its upstream responses into
   the normalized domain models in @/lib/domain/models.
   ========================================================================== */

import type {
  BallparkEntity,
  GameEntity,
  GameLogEntry,
  PlayerEntity,
  StatcastBatter,
  StatcastPitcher,
  WeatherEntity,
} from "@/lib/domain/models";

export interface ProviderHealth {
  name: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  failures: number;
  requests: number;
  avgResponseMs: number;
}

export interface MLBStatsProvider {
  readonly name: string;
  getSchedule(dateIso: string): Promise<GameEntity[]>;
  getGame(gamePk: number): Promise<GameEntity | null>;
  getPlayer(id: number): Promise<PlayerEntity | null>;
  getBatterGameLog(playerId: number, season?: number): Promise<GameLogEntry[]>;
  getPitcherGameLog(playerId: number, season?: number): Promise<GameLogEntry[]>;
}

export interface StatcastProvider {
  readonly name: string;
  getBatter(playerId: number, season?: number): Promise<StatcastBatter | null>;
  getPitcher(playerId: number, season?: number): Promise<StatcastPitcher | null>;
}

export interface ParkFactorProvider {
  readonly name: string;
  getFactor(venueName?: string): BallparkEntity;
}

export interface WeatherProvider {
  readonly name: string;
  getForGame(game: GameEntity): Promise<WeatherEntity>;
}
