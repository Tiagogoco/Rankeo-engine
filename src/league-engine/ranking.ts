import type { EntityId, LeagueRankingTieBreakEntry } from "./types.js";

/**
 * Category order for auto-assigning players to levels.
 * primera = best (level 1), sexta = worst (highest level number).
 */
export const CATEGORY_ORDER = [
  "primera",
  "segunda",
  "tercera",
  "cuarta",
  "quinta",
  "sexta",
] as const;

export type PlayerCategory = (typeof CATEGORY_ORDER)[number];

/**
 * Auto-assigns players to levels based on their category.
 * Sorts players best→worst, then groups by playersPerLevel.
 * Players without a category are placed at the end.
 */
export function autoAssignLevels(
  players: { id: EntityId; category: string | null }[],
  playersPerLevel: 2 | 4,
): { entityId: EntityId; level: number }[] {
  const categoryIndex = (category: string | null) => {
    const index = CATEGORY_ORDER.indexOf(category as PlayerCategory);
    return index < 0 ? CATEGORY_ORDER.length : index;
  };
  const sorted = [...players].sort((a, b) => {
    const ai = categoryIndex(a.category);
    const bi = categoryIndex(b.category);
    return ai - bi;
  });

  return sorted.map((p, i) => ({
    entityId: p.id,
    level: Math.floor(i / playersPerLevel) + 1,
  }));
}

export function compareLeagueRankingEntries(
  a: LeagueRankingTieBreakEntry,
  b: LeagueRankingTieBreakEntry,
): number {
  const n = (value: number | null | undefined) => value ?? 0;

  return (
    b.seasonTotal - a.seasonTotal ||
    n(b.gameDiff) - n(a.gameDiff) ||
    n(b.setDiff) - n(a.setDiff) ||
    n(b.matchesWon) - n(a.matchesWon) ||
    n(b.setsWon) - n(a.setsWon) ||
    n(b.gamesWon) - n(a.gamesWon) ||
    a.level - b.level ||
    a.position - b.position ||
    b.roundScore - a.roundScore ||
    (a.entityId ?? "").localeCompare(b.entityId ?? "")
  );
}

/**
 * Determines the two champions when a season closes after round 6.
 *
 * championSeason: entity with highest season_total across all snapshots from round 6,
 * applying the league ranking tie-break criteria.
 * championLevel1: entity at position 1 in level 1 in round 6 specifically.
 *                 null if no round 6 data exists for level 1.
 */
export function calculateSeasonChampions(
  snapshots: Array<{
    entityId: EntityId;
    level: number;
    roundId: string;
    position: number;
    seasonTotal: number;
    roundScore: number;
  }>,
  round6Id: string,
): { championSeason: EntityId; championLevel1: EntityId | null } {
  const round6 = snapshots.filter((s) => s.roundId === round6Id);

  if (round6.length === 0) {
    throw new Error("No snapshots found for round 6");
  }

  const championSeason = [...round6].sort(compareLeagueRankingEntries)[0].entityId;

  const level1Winner = round6.find((s) => s.level === 1 && s.position === 1);

  return {
    championSeason,
    championLevel1: level1Winner?.entityId ?? null,
  };
}
