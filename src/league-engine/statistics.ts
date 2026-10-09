import type { EntityId, SetNumber, GameDeductionMap, PairRankingStats, PairRankingStatsEntry, LeagueRankingStatsEntry, PairSetScoreEntry } from "./types.js";

export function applyGameDeductions<T extends { entityId: EntityId; setNumber: number; gamesWon: number }>(
  setScores: T[],
  deductions: Map<EntityId, GameDeductionMap>,
): T[] {
  return setScores.map((score) => {
    const setNumber = score.setNumber as SetNumber;
    const gamesDeduction = deductions.get(score.entityId)?.[setNumber] ?? 0;
    if (gamesDeduction <= 0) return score;

    return {
      ...score,
      gamesWon: Math.max(0, score.gamesWon - gamesDeduction),
    };
  });
}

export function emptyPairRankingStats(): PairRankingStats {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    matchesLost: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
    setDiff: 0,
    gameDiff: 0,
    pointsAdjustment: 0,
    rankingPoints: 0,
  };
}

function completePairRankingStats(
  stats: Omit<PairRankingStats, "setDiff" | "gameDiff" | "rankingPoints">,
): PairRankingStats {
  const setDiff = stats.setsWon - stats.setsLost;
  const gameDiff = stats.gamesWon - stats.gamesLost;
  return {
    ...stats,
    setDiff,
    gameDiff,
    rankingPoints: stats.matchesWon + stats.setsWon + stats.pointsAdjustment,
  };
}

function completeGameDiffRankingStats(
  stats: Omit<PairRankingStats, "setDiff" | "gameDiff" | "rankingPoints">,
): PairRankingStats {
  const setDiff = stats.setsWon - stats.setsLost;
  const gameDiff = stats.gamesWon - stats.gamesLost;
  return {
    ...stats,
    setDiff,
    gameDiff,
    rankingPoints: gameDiff + stats.pointsAdjustment,
  };
}

export function addPairRankingStats(
  a: PairRankingStats,
  b: PairRankingStats,
): PairRankingStats {
  return completePairRankingStats({
    matchesPlayed: a.matchesPlayed + b.matchesPlayed,
    matchesWon: a.matchesWon + b.matchesWon,
    matchesLost: a.matchesLost + b.matchesLost,
    setsWon: a.setsWon + b.setsWon,
    setsLost: a.setsLost + b.setsLost,
    gamesWon: a.gamesWon + b.gamesWon,
    gamesLost: a.gamesLost + b.gamesLost,
    pointsAdjustment: a.pointsAdjustment + b.pointsAdjustment,
  });
}

export function addGameDiffRankingStats(
  a: PairRankingStats,
  b: PairRankingStats,
): PairRankingStats {
  return completeGameDiffRankingStats({
    matchesPlayed: a.matchesPlayed + b.matchesPlayed,
    matchesWon: a.matchesWon + b.matchesWon,
    matchesLost: a.matchesLost + b.matchesLost,
    setsWon: a.setsWon + b.setsWon,
    setsLost: a.setsLost + b.setsLost,
    gamesWon: a.gamesWon + b.gamesWon,
    gamesLost: a.gamesLost + b.gamesLost,
    pointsAdjustment: a.pointsAdjustment + b.pointsAdjustment,
  });
}

/**
 * Calculates detailed ranking stats for an individual level.
 *
 * Individuals rotate partners, so there is no stable match winner per entity.
 * Ranking points are game difference: games won minus games lost.
 */
export function calculateIndividualRoundStats(
  setScores: PairSetScoreEntry[],
  gameDeductions: Map<EntityId, GameDeductionMap> = new Map(),
): LeagueRankingStatsEntry[] {
  const entityIds = [...new Set(setScores.map((s) => s.entityId))];
  if (entityIds.length !== 4) {
    throw new Error(
      `calculateIndividualRoundStats requires exactly 4 players, got ${entityIds.length}`,
    );
  }

  const stats = new Map<EntityId, PairRankingStats>();
  for (const entityId of entityIds) {
    stats.set(entityId, { ...emptyPairRankingStats(), matchesPlayed: 1 });
  }

  const setsByNumber = new Map<number, PairSetScoreEntry[]>();
  for (const score of setScores) {
    const scores = setsByNumber.get(score.setNumber) ?? [];
    scores.push(score);
    setsByNumber.set(score.setNumber, scores);
  }

  for (const [setNumber, setEntries] of setsByNumber) {
    if (setEntries.length !== 4) {
      throw new Error(
        `Set ${setNumber}: calculateIndividualRoundStats requires 4 player scores, got ${setEntries.length}`,
      );
    }

    const scoreGroups = new Map<number, EntityId[]>();
    for (const entry of setEntries) {
      const group = scoreGroups.get(entry.gamesWon) ?? [];
      group.push(entry.entityId);
      scoreGroups.set(entry.gamesWon, group);
    }

    const groups = [...scoreGroups.entries()];
    if (groups.length !== 2 || groups.some(([, players]) => players.length !== 2)) {
      throw new Error(
        `Set ${setNumber}: individual scores must identify two teams of two players`,
      );
    }

    const [[aGames, aPlayers], [bGames, bPlayers]] = groups;
    for (const entityId of aPlayers) {
      const playerStats = stats.get(entityId)!;
      const gamesWon = Math.max(
        0,
        aGames - (gameDeductions.get(entityId)?.[setNumber as SetNumber] ?? 0),
      );
      playerStats.gamesWon += gamesWon;
      playerStats.gamesLost += bGames;
      if (gamesWon > bGames) playerStats.setsWon += 1;
      if (gamesWon < bGames) playerStats.setsLost += 1;
    }
    for (const entityId of bPlayers) {
      const playerStats = stats.get(entityId)!;
      const gamesWon = Math.max(
        0,
        bGames - (gameDeductions.get(entityId)?.[setNumber as SetNumber] ?? 0),
      );
      playerStats.gamesWon += gamesWon;
      playerStats.gamesLost += aGames;
      if (gamesWon > aGames) playerStats.setsWon += 1;
      if (gamesWon < aGames) playerStats.setsLost += 1;
    }
  }

  return entityIds.map((entityId) => ({
    entityId,
    ...completeGameDiffRankingStats(stats.get(entityId)!),
  }));
}

/**
 * Calculates detailed ranking stats for a pairs level match.
 *
 * Ranking points follow the Puebla-style table:
 * points = matches won + sets won (+ optional adjustments stored separately).
 * A 2-0 or 2-1 win is worth 3 points; a 1-2 loss is worth 1.
 */
export function calculatePairRoundStats(
  setScores: PairSetScoreEntry[],
): [PairRankingStatsEntry, PairRankingStatsEntry] {
  const entityIds = [...new Set(setScores.map((s) => s.entityId))];
  if (entityIds.length !== 2) {
    throw new Error(
      `calculatePairRoundStats requires exactly 2 pairs, got ${entityIds.length}`,
    );
  }

  const stats = new Map<EntityId, PairRankingStats>();
  for (const entityId of entityIds) {
    stats.set(entityId, { ...emptyPairRankingStats(), matchesPlayed: 1 });
  }

  const setsByNumber = new Map<number, Map<EntityId, number>>();
  for (const score of setScores) {
    if (!setsByNumber.has(score.setNumber)) {
      setsByNumber.set(score.setNumber, new Map());
    }
    setsByNumber.get(score.setNumber)!.set(score.entityId, score.gamesWon);
  }

  for (const pairScores of setsByNumber.values()) {
    const entries = [...pairScores.entries()];
    if (entries.length !== 2) continue;

    const [a, b] = entries;
    const aStats = stats.get(a[0])!;
    const bStats = stats.get(b[0])!;

    aStats.gamesWon += a[1];
    aStats.gamesLost += b[1];
    bStats.gamesWon += b[1];
    bStats.gamesLost += a[1];

    if (a[1] > b[1]) {
      aStats.setsWon += 1;
      bStats.setsLost += 1;
    } else if (b[1] > a[1]) {
      bStats.setsWon += 1;
      aStats.setsLost += 1;
    }
  }

  const [aId, bId] = entityIds;
  const aStats = stats.get(aId)!;
  const bStats = stats.get(bId)!;

  if (aStats.setsWon > bStats.setsWon) {
    aStats.matchesWon = 1;
    bStats.matchesLost = 1;
  } else if (bStats.setsWon > aStats.setsWon) {
    bStats.matchesWon = 1;
    aStats.matchesLost = 1;
  }

  return entityIds.map((entityId) => ({
    entityId,
    ...completePairRankingStats(stats.get(entityId)!),
  })) as [PairRankingStatsEntry, PairRankingStatsEntry];
}
