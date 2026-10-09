import { describe, it, expect } from "vitest";
import {
  physicalCourt,
  generateIndividualSets,
  calculateMovements,
  calculateAutoLevelDownMovements,
  applyGameDeductions,
  calculateIndividualRoundStats,
  calculatePairRoundStats,
  calculatePairsMovement,
  calculateSeasonChampions,
  compareLeagueRankingEntries,
  type ScoreEntry,
} from "../../src/league-engine/index.js";

// ============================================================
// physicalCourt
// ============================================================

describe("physicalCourt", () => {
  it("assigns level 1 to court 1", () => {
    expect(physicalCourt(1, 8, 2)).toBe(1);
  });

  it("assigns level 5 to court 2 with 8 levels, 2 courts", () => {
    // ceil(8/2)=4 per court → ceil(5/4)=2
    expect(physicalCourt(5, 8, 2)).toBe(2);
  });

  it("handles 11 levels, 3 courts correctly", () => {
    // ceil(11/3)=4 per court
    expect(physicalCourt(1, 11, 3)).toBe(1);   // ceil(1/4)=1
    expect(physicalCourt(4, 11, 3)).toBe(1);   // ceil(4/4)=1
    expect(physicalCourt(5, 11, 3)).toBe(2);   // ceil(5/4)=2
    expect(physicalCourt(8, 11, 3)).toBe(2);   // ceil(8/4)=2
    expect(physicalCourt(9, 11, 3)).toBe(3);   // ceil(9/4)=3
    expect(physicalCourt(11, 11, 3)).toBe(3);  // ceil(11/4)=3
  });

  it("gives each level its own court when courts >= totalLevels", () => {
    // ceil(3/5)=1 per court → level N → court N
    expect(physicalCourt(1, 3, 5)).toBe(1);
    expect(physicalCourt(2, 3, 5)).toBe(2);
    expect(physicalCourt(3, 3, 5)).toBe(3);
  });

  it("gives each level its own court when courts === totalLevels", () => {
    // ceil(4/4)=1 per court → level N → court N
    expect(physicalCourt(1, 4, 4)).toBe(1);
    expect(physicalCourt(4, 4, 4)).toBe(4);
  });

  it("works with a single court", () => {
    expect(physicalCourt(1, 10, 1)).toBe(1);
    expect(physicalCourt(10, 10, 1)).toBe(1);
  });
});

// ============================================================
// generateIndividualSets
// ============================================================

describe("generateIndividualSets", () => {
  const players: [string, string, string, string] = ["j1", "j2", "j3", "j4"];
  const sets = generateIndividualSets(players);

  it("generates exactly 3 sets", () => {
    expect(sets).toHaveLength(3);
  });

  it("produces the correct pairings", () => {
    expect(sets[0]).toEqual({ set: 1, teamA: ["j1", "j2"], teamB: ["j3", "j4"] });
    expect(sets[1]).toEqual({ set: 2, teamA: ["j1", "j3"], teamB: ["j2", "j4"] });
    expect(sets[2]).toEqual({ set: 3, teamA: ["j1", "j4"], teamB: ["j2", "j3"] });
  });

  it("each player appears in teamA or teamB of every set", () => {
    for (const player of players) {
      for (const s of sets) {
        const allPlayers = [...s.teamA, ...s.teamB];
        expect(allPlayers).toContain(player);
      }
    }
  });

  it("j1 partners with every other player exactly once across 3 sets", () => {
    const j1Partners = sets.map((s) =>
      s.teamA.includes("j1") ? s.teamA.find((p) => p !== "j1") : s.teamB.find((p) => p !== "j1"),
    );
    expect(new Set(j1Partners).size).toBe(3); // partners with j2, j3, j4 once each
  });
});

// ============================================================
// calculateMovements — individual (4 players)
// ============================================================

describe("calculateMovements", () => {
  const makeScores = (
    scores: [number, number, number, number],
    seasonTotals?: [number, number, number, number],
  ): ScoreEntry[] =>
    scores.map((roundScore, i) => ({
      entityId: `p${i + 1}`,
      roundScore,
      seasonTotal: seasonTotals ? seasonTotals[i] : roundScore,
    }));

  it("throws if not exactly 4 entries", () => {
    expect(() => calculateMovements(makeScores([5, 4, 3, 2]).slice(0, 3), 2, 5)).toThrow();
  });

  it("position 1 moves up (level > 1)", () => {
    const results = calculateMovements(makeScores([10, 8, 6, 4]), 3, 5);
    const first = results.find((r) => r.entityId === "p1")!;
    expect(first.direction).toBe("up");
    expect(first.toLevel).toBe(2);
  });

  it("position 1 stays at level 1 (cannot go higher)", () => {
    const results = calculateMovements(makeScores([10, 8, 6, 4]), 1, 5);
    const first = results.find((r) => r.entityId === "p1")!;
    expect(first.direction).toBe("none");
    expect(first.toLevel).toBe(1);
  });

  it("position 4 moves down (level < totalLevels)", () => {
    const results = calculateMovements(makeScores([10, 8, 6, 4]), 3, 5);
    const last = results.find((r) => r.entityId === "p4")!;
    expect(last.direction).toBe("down");
    expect(last.toLevel).toBe(4);
  });

  it("position 4 stays at last level (cannot go lower)", () => {
    const results = calculateMovements(makeScores([10, 8, 6, 4]), 5, 5);
    const last = results.find((r) => r.entityId === "p4")!;
    expect(last.direction).toBe("none");
    expect(last.toLevel).toBe(5);
  });

  it("positions 2 and 3 always stay (no movement)", () => {
    const results = calculateMovements(makeScores([10, 8, 6, 4]), 3, 5);
    const second = results.find((r) => r.entityId === "p2")!;
    const third = results.find((r) => r.entityId === "p3")!;
    expect(second.direction).toBe("none");
    expect(third.direction).toBe("none");
  });

  it("tie at top → both top players get tie_pending with position 1", () => {
    // p1 and p2 tie at 10
    const results = calculateMovements(makeScores([10, 10, 6, 4]), 3, 5);
    const tied = results.filter((r) => r.direction === "tie_pending");
    expect(tied).toHaveLength(2);
    tied.forEach((r) => {
      expect(r.toLevel).toBeNull();
      if (r.direction === "tie_pending") expect(r.position).toBe(1);
    });
  });

  it("tie at top on level 1 → tied top players stay, no pending tie to move up", () => {
    const results = calculateMovements(makeScores([10, 10, 6, 4]), 1, 5);
    const tiedTop = results.filter((r) => r.entityId === "p1" || r.entityId === "p2");

    expect(results.filter((r) => r.direction === "tie_pending")).toHaveLength(0);
    tiedTop.forEach((r) => {
      expect(r.direction).toBe("none");
      expect(r.toLevel).toBe(1);
    });
  });

  it("tie at bottom → both bottom players get tie_pending with position 4", () => {
    // p3 and p4 tie at 4
    const results = calculateMovements(makeScores([10, 8, 4, 4]), 3, 5);
    const tied = results.filter((r) => r.direction === "tie_pending");
    expect(tied).toHaveLength(2);
    tied.forEach((r) => {
      expect(r.toLevel).toBeNull();
      if (r.direction === "tie_pending") expect(r.position).toBe(4);
    });
  });

  it("tie at bottom on last level → tied bottom players stay, no pending tie to move down", () => {
    const results = calculateMovements(makeScores([10, 8, 4, 4]), 5, 5);
    const tiedBottom = results.filter((r) => r.entityId === "p3" || r.entityId === "p4");

    expect(results.filter((r) => r.direction === "tie_pending")).toHaveLength(0);
    tiedBottom.forEach((r) => {
      expect(r.direction).toBe("none");
      expect(r.toLevel).toBe(5);
    });
  });

  it("four-way tie → all four players get tie_pending", () => {
    const results = calculateMovements(makeScores([5, 5, 5, 5]), 3, 5);
    const tied = results.filter((r) => r.direction === "tie_pending");
    expect(tied).toHaveLength(4);
  });

  it("returns 4 results sorted by roundScore descending", () => {
    const results = calculateMovements(makeScores([4, 10, 6, 8]), 2, 4);
    expect(results[0].entityId).toBe("p2"); // 10
    expect(results[1].entityId).toBe("p4"); // 8
    expect(results[2].entityId).toBe("p3"); // 6
    expect(results[3].entityId).toBe("p1"); // 4
  });

  it("fromLevel is always the current level for all results", () => {
    const results = calculateMovements(makeScores([10, 8, 6, 4]), 3, 5);
    results.forEach((r) => expect(r.fromLevel).toBe(3));
  });
});

// ============================================================
// calculateAutoLevelDownMovements — penalties
// ============================================================

describe("calculateAutoLevelDownMovements", () => {
  const makeScores = (scores: [number, number, number, number]): ScoreEntry[] =>
    scores.map((roundScore, i) => ({
      entityId: `p${i + 1}`,
      roundScore,
      seasonTotal: roundScore,
    }));

  it("forces one penalized player down and promotes the best non-penalized player", () => {
    const results = calculateAutoLevelDownMovements(
      makeScores([12, 10, 8, 6]),
      3,
      5,
      new Set(["p2"]),
    );
    expect(results).not.toBeNull();
    if (!results) throw new Error("Expected movements");

    const p1 = results.find((r) => r.entityId === "p1")!;
    const p2 = results.find((r) => r.entityId === "p2")!;
    const p3 = results.find((r) => r.entityId === "p3")!;

    expect(p1.direction).toBe("up");
    expect(p1.toLevel).toBe(2);
    expect(p2.direction).toBe("down");
    expect(p2.toLevel).toBe(4);
    expect(p3.direction).toBe("none");
  });

  it("forces multiple penalized players down and keeps the rest", () => {
    const results = calculateAutoLevelDownMovements(
      makeScores([12, 10, 8, 6]),
      3,
      5,
      new Set(["p2", "p3"]),
    );

    expect(results?.find((r) => r.entityId === "p1")?.direction).toBe("none");
    expect(results?.find((r) => r.entityId === "p2")?.direction).toBe("down");
    expect(results?.find((r) => r.entityId === "p3")?.direction).toBe("down");
    expect(results?.find((r) => r.entityId === "p4")?.direction).toBe("none");
  });
});

// ============================================================
// applyGameDeductions — per-set penalties
// ============================================================

describe("applyGameDeductions", () => {
  it("subtracts games by entity and set, clamping at zero", () => {
    const adjusted = applyGameDeductions(
      [
        { entityId: "p1", setNumber: 1, gamesWon: 6 },
        { entityId: "p1", setNumber: 2, gamesWon: 1 },
        { entityId: "p2", setNumber: 1, gamesWon: 4 },
      ],
      new Map([
        ["p1", { 1: 2, 2: 3 }],
        ["p2", { 1: 1 }],
      ]),
    );

    expect(adjusted).toEqual([
      { entityId: "p1", setNumber: 1, gamesWon: 4 },
      { entityId: "p1", setNumber: 2, gamesWon: 0 },
      { entityId: "p2", setNumber: 1, gamesWon: 3 },
    ]);
  });
});

// ============================================================
// calculatePairsMovement — pairs (2 pairs)
// ============================================================

describe("calculatePairsMovement", () => {
  const makeEntry = (id: string, roundScore: number): ScoreEntry => ({
    entityId: id,
    roundScore,
    seasonTotal: roundScore,
  });

  it("[demo] winner moves up, loser moves down in a middle level", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 2), makeEntry("pairB", 1)],
      3,
      5,
    );
    const winner = results.find((r) => r.entityId === "pairA")!;
    const loser = results.find((r) => r.entityId === "pairB")!;
    expect(winner.direction).toBe("up");
    expect(winner.toLevel).toBe(2);
    expect(loser.direction).toBe("down");
    expect(loser.toLevel).toBe(4);
  });

  it("winner stays at level 1 (cannot go higher)", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 2), makeEntry("pairB", 0)],
      1,
      5,
    );
    const winner = results.find((r) => r.entityId === "pairA")!;
    expect(winner.direction).toBe("none");
    expect(winner.toLevel).toBe(1);
  });

  it("loser stays at last level (cannot go lower)", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 2), makeEntry("pairB", 0)],
      5,
      5,
    );
    const loser = results.find((r) => r.entityId === "pairB")!;
    expect(loser.direction).toBe("none");
    expect(loser.toLevel).toBe(5);
  });

  it("equal sets → both pairs get tie_pending", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 1), makeEntry("pairB", 1)],
      3,
      5,
    );
    expect(results).toHaveLength(2);
    results.forEach((r) => {
      expect(r.direction).toBe("tie_pending");
      expect(r.toLevel).toBeNull();
    });
  });

  it("returns exactly 2 results", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 3), makeEntry("pairB", 0)],
      2,
      4,
    );
    expect(results).toHaveLength(2);
  });

  it("fromLevel is always the current level for both results", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 2), makeEntry("pairB", 1)],
      4,
      6,
    );
    results.forEach((r) => expect(r.fromLevel).toBe(4));
  });

  it("second argument wins if it has higher score", () => {
    const results = calculatePairsMovement(
      [makeEntry("pairA", 1), makeEntry("pairB", 2)],
      3,
      5,
    );
    const winner = results.find((r) => r.entityId === "pairB")!;
    expect(winner.direction).toBe("up");
  });
});

// ============================================================
// calculatePairRoundStats — pairs ranking table stats
// ============================================================

describe("calculatePairRoundStats", () => {
  it("gives 3 ranking points for a straight sets win", () => {
    const [winner, loser] = calculatePairRoundStats([
      { entityId: "pairA", setNumber: 1, gamesWon: 6 },
      { entityId: "pairB", setNumber: 1, gamesWon: 4 },
      { entityId: "pairA", setNumber: 2, gamesWon: 6 },
      { entityId: "pairB", setNumber: 2, gamesWon: 3 },
    ]);

    expect(winner).toMatchObject({
      entityId: "pairA",
      matchesPlayed: 1,
      matchesWon: 1,
      matchesLost: 0,
      setsWon: 2,
      setsLost: 0,
      gamesWon: 12,
      gamesLost: 7,
      setDiff: 2,
      gameDiff: 5,
      rankingPoints: 3,
    });
    expect(loser).toMatchObject({
      entityId: "pairB",
      matchesPlayed: 1,
      matchesWon: 0,
      matchesLost: 1,
      setsWon: 0,
      setsLost: 2,
      gamesWon: 7,
      gamesLost: 12,
      setDiff: -2,
      gameDiff: -5,
      rankingPoints: 0,
    });
  });

  it("gives one point to the losing pair when it wins one set", () => {
    const stats = calculatePairRoundStats([
      { entityId: "pairA", setNumber: 1, gamesWon: 6 },
      { entityId: "pairB", setNumber: 1, gamesWon: 4 },
      { entityId: "pairA", setNumber: 2, gamesWon: 4 },
      { entityId: "pairB", setNumber: 2, gamesWon: 6 },
      { entityId: "pairA", setNumber: 3, gamesWon: 10 },
      { entityId: "pairB", setNumber: 3, gamesWon: 8 },
    ]);

    const winner = stats.find((s) => s.entityId === "pairA")!;
    const loser = stats.find((s) => s.entityId === "pairB")!;

    expect(winner.rankingPoints).toBe(3);
    expect(loser.rankingPoints).toBe(1);
    expect(winner.setDiff).toBe(1);
    expect(loser.setDiff).toBe(-1);
    expect(winner.gameDiff).toBe(2);
    expect(loser.gameDiff).toBe(-2);
  });

  it("throws when the score does not include exactly two pairs", () => {
    expect(() =>
      calculatePairRoundStats([
        { entityId: "pairA", setNumber: 1, gamesWon: 6 },
      ]),
    ).toThrow();
  });
});

// ============================================================
// calculateIndividualRoundStats — individual game difference ranking
// ============================================================

describe("calculateIndividualRoundStats", () => {
  it("uses game difference as ranking points for each player", () => {
    const stats = calculateIndividualRoundStats([
      { entityId: "p1", setNumber: 1, gamesWon: 6 },
      { entityId: "p2", setNumber: 1, gamesWon: 6 },
      { entityId: "p3", setNumber: 1, gamesWon: 3 },
      { entityId: "p4", setNumber: 1, gamesWon: 3 },
      { entityId: "p1", setNumber: 2, gamesWon: 6 },
      { entityId: "p3", setNumber: 2, gamesWon: 6 },
      { entityId: "p2", setNumber: 2, gamesWon: 2 },
      { entityId: "p4", setNumber: 2, gamesWon: 2 },
      { entityId: "p1", setNumber: 3, gamesWon: 6 },
      { entityId: "p4", setNumber: 3, gamesWon: 6 },
      { entityId: "p2", setNumber: 3, gamesWon: 1 },
      { entityId: "p3", setNumber: 3, gamesWon: 1 },
    ]);

    const winner = stats.find((s) => s.entityId === "p1")!;

    expect(winner).toMatchObject({
      matchesPlayed: 1,
      matchesWon: 0,
      matchesLost: 0,
      setsWon: 3,
      setsLost: 0,
      gamesWon: 18,
      gamesLost: 6,
      setDiff: 3,
      gameDiff: 12,
      rankingPoints: 12,
    });
  });

  it("[demo] applies per-player game deductions without changing teammates or opponents", () => {
    const stats = calculateIndividualRoundStats(
      [
        { entityId: "p1", setNumber: 1, gamesWon: 6 },
        { entityId: "p2", setNumber: 1, gamesWon: 6 },
        { entityId: "p3", setNumber: 1, gamesWon: 3 },
        { entityId: "p4", setNumber: 1, gamesWon: 3 },
      ],
      new Map([["p1", { 1: 2 }]]),
    );

    const penalized = stats.find((s) => s.entityId === "p1")!;
    const teammate = stats.find((s) => s.entityId === "p2")!;
    const opponent = stats.find((s) => s.entityId === "p3")!;

    expect(penalized).toMatchObject({ gamesWon: 4, gamesLost: 3, gameDiff: 1 });
    expect(teammate).toMatchObject({ gamesWon: 6, gamesLost: 3, gameDiff: 3 });
    expect(opponent).toMatchObject({ gamesWon: 3, gamesLost: 6, gameDiff: -3 });
  });

  it("throws when a set does not identify two teams of two players", () => {
    expect(() =>
      calculateIndividualRoundStats([
        { entityId: "p1", setNumber: 1, gamesWon: 6 },
        { entityId: "p2", setNumber: 1, gamesWon: 5 },
        { entityId: "p3", setNumber: 1, gamesWon: 4 },
        { entityId: "p4", setNumber: 1, gamesWon: 3 },
      ]),
    ).toThrow();
  });
});

// ============================================================
// compareLeagueRankingEntries
// ============================================================

describe("compareLeagueRankingEntries", () => {
  it("breaks equal ranking points by game difference before level", () => {
    const entries = [
      {
        entityId: "pairA",
        seasonTotal: 12,
        level: 1,
        position: 1,
        roundScore: 3,
        gameDiff: 23,
        setDiff: 8,
        matchesWon: 4,
        setsWon: 8,
        gamesWon: 50,
      },
      {
        entityId: "pairB",
        seasonTotal: 12,
        level: 2,
        position: 1,
        roundScore: 3,
        gameDiff: 27,
        setDiff: 8,
        matchesWon: 4,
        setsWon: 8,
        gamesWon: 48,
      },
    ];

    expect([...entries].sort(compareLeagueRankingEntries)[0].entityId).toBe("pairB");
  });
});

// ============================================================
// calculateSeasonChampions
// ============================================================

describe("calculateSeasonChampions", () => {
  const r6 = "round-6-id";

  const makeSnapshot = (
    entityId: string,
    level: number,
    roundId: string,
    position: number,
    seasonTotal: number,
    roundScore = seasonTotal,
  ) => ({ entityId, level, roundId, position, seasonTotal, roundScore });

  it("throws when no round 6 snapshots exist", () => {
    expect(() => calculateSeasonChampions([], r6)).toThrow();
  });

  it("champion of season has the highest season total", () => {
    const snapshots = [
      makeSnapshot("p1", 1, r6, 1, 80),
      makeSnapshot("p2", 1, r6, 2, 60),
      makeSnapshot("p3", 2, r6, 1, 95), // highest total but not level 1 position 1
      makeSnapshot("p4", 2, r6, 2, 50),
    ];
    const { championSeason } = calculateSeasonChampions(snapshots, r6);
    expect(championSeason).toBe("p3");
  });

  it("breaks season champion ties by level, position, then round score", () => {
    const snapshots = [
      makeSnapshot("p1", 2, r6, 1, 100, 20),
      makeSnapshot("p2", 1, r6, 2, 100, 22),
      makeSnapshot("p3", 1, r6, 1, 100, 18),
      makeSnapshot("p4", 1, r6, 1, 100, 24),
    ];

    const { championSeason } = calculateSeasonChampions(snapshots, r6);
    expect(championSeason).toBe("p4");
  });

  it("champion of level 1 is position 1 at level 1 in round 6", () => {
    const snapshots = [
      makeSnapshot("p1", 1, r6, 1, 80), // level 1 position 1
      makeSnapshot("p2", 1, r6, 2, 60),
      makeSnapshot("p3", 2, r6, 1, 95),
    ];
    const { championLevel1 } = calculateSeasonChampions(snapshots, r6);
    expect(championLevel1).toBe("p1");
  });

  it("champions can be the same entity", () => {
    const snapshots = [
      makeSnapshot("p1", 1, r6, 1, 100), // both highest total and level 1 position 1
      makeSnapshot("p2", 1, r6, 2, 70),
      makeSnapshot("p3", 2, r6, 1, 80),
    ];
    const { championSeason, championLevel1 } = calculateSeasonChampions(snapshots, r6);
    expect(championSeason).toBe("p1");
    expect(championLevel1).toBe("p1");
  });

  it("championLevel1 is null when level 1 position 1 is absent from round 6", () => {
    const snapshots = [
      makeSnapshot("p1", 2, r6, 1, 80),
      makeSnapshot("p2", 2, r6, 2, 60),
    ];
    const { championLevel1 } = calculateSeasonChampions(snapshots, r6);
    expect(championLevel1).toBeNull();
  });

  it("only uses round 6 snapshots, ignores earlier rounds", () => {
    const snapshots = [
      makeSnapshot("early-leader", 1, "round-3-id", 1, 999), // earlier round, high total
      makeSnapshot("p1", 1, r6, 1, 80),
      makeSnapshot("p2", 1, r6, 2, 60),
    ];
    const { championSeason } = calculateSeasonChampions(snapshots, r6);
    expect(championSeason).toBe("p1"); // not early-leader, which is from a different round
  });
});
