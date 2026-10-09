import type { EntityId, ScoreEntry, MovementResult } from "./types.js";

/**
 * Calculates level movements after an individual round.
 * Requires exactly 4 ScoreEntry (one per player in the level).
 * roundScore = total games won across all 3 sets.
 *
 * Rules:
 * - Position 1: moves up (level - 1). Stays if already at level 1.
 * - Position 4: moves down (level + 1). Stays if already at last level.
 * - Positions 2-3: no movement.
 * - Tie at position 1: tie_pending only if there is a higher level.
 * - Tie at position 4: tie_pending only if there is a lower level.
 */
export function calculateMovements(
  scores: ScoreEntry[],
  level: number,
  totalLevels: number,
): MovementResult[] {
  if (scores.length !== 4) {
    throw new Error(
      `calculateMovements requires exactly 4 entries, got ${scores.length}`,
    );
  }

  const sorted = [...scores].sort((a, b) => b.roundScore - a.roundScore);
  const topTie = sorted[0].roundScore === sorted[1].roundScore;
  const bottomTie = sorted[2].roundScore === sorted[3].roundScore;
  const allTied = sorted[0].roundScore === sorted[3].roundScore;

  return sorted.map((entry, idx): MovementResult => {
    const position = (idx + 1) as 1 | 2 | 3 | 4;

    // Four-way ties retain the application's existing two-up/two-down review.
    const tiedAtTop = topTie && entry.roundScore === sorted[0].roundScore && (!allTied || position <= 2);
    const tiedAtBottom = bottomTie && entry.roundScore === sorted[3].roundScore && (!allTied || position >= 3);
    if (tiedAtTop) {
      if (level === 1) {
        return { direction: "none", entityId: entry.entityId, fromLevel: level, toLevel: level };
      }
      return { direction: "tie_pending", entityId: entry.entityId, fromLevel: level, toLevel: null, position: 1 };
    }

    if (tiedAtBottom) {
      if (level === totalLevels) {
        return { direction: "none", entityId: entry.entityId, fromLevel: level, toLevel: level };
      }
      return { direction: "tie_pending", entityId: entry.entityId, fromLevel: level, toLevel: null, position: 4 };
    }

    if (position === 1) {
      if (level === 1) {
        return { direction: "none", entityId: entry.entityId, fromLevel: level, toLevel: level };
      }
      return { direction: "up", entityId: entry.entityId, fromLevel: level, toLevel: level - 1 };
    }

    if (position === 4) {
      if (level === totalLevels) {
        return { direction: "none", entityId: entry.entityId, fromLevel: level, toLevel: level };
      }
      return { direction: "down", entityId: entry.entityId, fromLevel: level, toLevel: level + 1 };
    }

    return { direction: "none", entityId: entry.entityId, fromLevel: level, toLevel: level };
  });
}

/**
 * Calculates level movements after a pairs round.
 * Requires exactly 2 ScoreEntry (one per pair in the level).
 * roundScore = sets won in the best-of-3 match.
 *
 * Rules:
 * - Winner (more sets): moves up. Stays if already at level 1.
 * - Loser (fewer sets): moves down. Stays if already at last level.
 * - Tie (equal sets): tie_pending for both pairs.
 */
export function calculatePairsMovement(
  scores: [ScoreEntry, ScoreEntry],
  level: number,
  totalLevels: number,
): MovementResult[] {
  const [a, b] = scores;

  if (a.roundScore === b.roundScore) {
    return [
      { direction: "tie_pending", entityId: a.entityId, fromLevel: level, toLevel: null, position: 1 },
      { direction: "tie_pending", entityId: b.entityId, fromLevel: level, toLevel: null, position: 4 },
    ];
  }

  const [winner, loser] = a.roundScore > b.roundScore ? [a, b] : [b, a];

  return [
    {
      direction: level === 1 ? "none" : "up",
      entityId: winner.entityId,
      fromLevel: level,
      toLevel: level === 1 ? level : level - 1,
    },
    {
      direction: level === totalLevels ? "none" : "down",
      entityId: loser.entityId,
      fromLevel: level,
      toLevel: level === totalLevels ? level : level + 1,
    },
  ];
}

function movementForDirection(
  entityId: EntityId,
  level: number,
  totalLevels: number,
  direction: "up" | "down" | "none",
): MovementResult {
  const toLevel =
    direction === "up"
      ? Math.max(1, level - 1)
      : direction === "down"
        ? totalLevels > 0
          ? Math.min(totalLevels, level + 1)
          : level + 1
        : level;

  return {
    direction: toLevel === level ? "none" : direction,
    entityId,
    fromLevel: level,
    toLevel,
  };
}

export function calculateAutoLevelDownMovements(
  scores: ScoreEntry[],
  level: number,
  totalLevels: number,
  autoDownIds: Set<EntityId>,
): MovementResult[] | null {
  const forcedDownIds = scores
    .filter((entry) => autoDownIds.has(entry.entityId))
    .map((entry) => entry.entityId);

  if (forcedDownIds.length === 0) return null;

  if (forcedDownIds.length === 1) {
    const forcedDownId = forcedDownIds[0]!;
    const promotedId = [...scores]
      .sort((a, b) => b.roundScore - a.roundScore)
      .find((entry) => entry.entityId !== forcedDownId)?.entityId;

    return scores.map((entry) =>
      entry.entityId === forcedDownId
        ? movementForDirection(entry.entityId, level, totalLevels, "down")
        : movementForDirection(
            entry.entityId,
            level,
            totalLevels,
            promotedId && entry.entityId === promotedId ? "up" : "none",
          )
    );
  }

  return scores.map((entry) =>
    autoDownIds.has(entry.entityId)
      ? movementForDirection(entry.entityId, level, totalLevels, "down")
      : movementForDirection(entry.entityId, level, totalLevels, "none")
  );
}
