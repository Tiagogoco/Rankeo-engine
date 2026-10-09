export type EntityId = string;
export type SetNumber = 1 | 2 | 3;
export type GameDeductionMap = Partial<Record<SetNumber, number>>;

export interface LeagueRankingTieBreakEntry {
  entityId?: EntityId;
  seasonTotal: number;
  level: number;
  position: number;
  roundScore: number;
  matchesWon?: number | null;
  setsWon?: number | null;
  gamesWon?: number | null;
  setDiff?: number | null;
  gameDiff?: number | null;
}

export interface ScoreEntry {
  entityId: EntityId;
  roundScore: number;  // individual: total games won; pairs: sets won
  seasonTotal: number; // cumulative including this round
}

export type MovementResult =
  | {
      direction: "up" | "down" | "none";
      entityId: EntityId;
      fromLevel: number;
      toLevel: number;
    }
  | {
      direction: "tie_pending";
      entityId: EntityId;
      fromLevel: number;
      toLevel: null;
      position: 1 | 4;
    };

export interface PairRankingStats {
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  setDiff: number;
  gameDiff: number;
  pointsAdjustment: number;
  rankingPoints: number;
}

export interface PairRankingStatsEntry extends PairRankingStats {
  entityId: EntityId;
}

export type LeagueRankingStatsEntry = PairRankingStatsEntry;

export interface PairSetScoreEntry {
  entityId: EntityId;
  setNumber: number;
  gamesWon: number;
}

export interface ScheduleSlot {
  level: number;
  physicalCourt: number;
  scheduledTime: string; // "HH:MM"
}
