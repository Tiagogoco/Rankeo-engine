import type { EntityId } from "./types.js";

/**
 * Returns the physical court number for a given level.
 * Levels are distributed evenly across available courts.
 * Example: level 5 of 11 total, 3 courts → ceil(11/3)=4 per court → ceil(5/4)=2
 */
export function physicalCourt(
  level: number,
  totalLevels: number,
  availableCourts: number,
): number {
  const levelsPerCourt = Math.ceil(totalLevels / availableCourts);
  return Math.ceil(level / levelsPerCourt);
}

/**
 * Generates the 3 rotating set pairings for an individual level.
 * Each player plays with every other player exactly once across the 3 sets.
 * Order: [J1, J2, J3, J4] where J1 = position 1 (best seed) in the level.
 */
export function generateIndividualSets(
  players: [EntityId, EntityId, EntityId, EntityId],
): Array<{ set: number; teamA: [EntityId, EntityId]; teamB: [EntityId, EntityId] }> {
  const [j1, j2, j3, j4] = players;
  return [
    { set: 1, teamA: [j1, j2], teamB: [j3, j4] },
    { set: 2, teamA: [j1, j3], teamB: [j2, j4] },
    { set: 3, teamA: [j1, j4], teamB: [j2, j3] },
  ];
}
