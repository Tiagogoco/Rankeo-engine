import { describe, expect, it } from "vitest";
import { generateBracket, advanceWinner } from "../../src/bracket-engine/single-elimination.js";
import { generateGroups, generateGroupMatches, generatePlayoffBracket } from "../../src/bracket-engine/group-stage.js";
import { generateSchedule, getStandings, advanceWinner as advanceRoundRobinWinner } from "../../src/bracket-engine/round-robin.js";
import type { Match, Team } from "../../src/bracket-engine/types.js";

const teams = (count: number): Team[] => Array.from({ length: count }, (_, index) => ({
  id: `t${index + 1}`, name: `Team ${index + 1}`, seed: index + 1,
}));
const complete = (matches: Match[]) => matches.map((match) => ({
  ...match,
  winnerId: (match.teamA!.seed! < match.teamB!.seed! ? match.teamA : match.teamB)!.id,
}));

describe("group and playoff regressions", () => {
  it("uses unique IDs across groups", () => {
    const matches = generateGroupMatches(generateGroups(teams(8), 2));
    expect(matches).toHaveLength(12);
    expect(new Set(matches.map((match) => match.id)).size).toBe(12);
  });

  it.each([2, 4, 8])("separates winners and runners-up from %i groups until the final", (count) => {
    const groups = generateGroups(teams(count * 4), count);
    const playoff = generatePlayoffBracket(groups, complete(generateGroupMatches(groups)));
    const firstRound = playoff.filter((match) => match.round === 1);
    const groupFor = (id: string) => groups.find((group) => group.teams.some((team) => team.id === id))!.id;
    for (const match of firstRound) {
      expect(groupFor(match.teamA!.id)).not.toBe(groupFor(match.teamB!.id));
    }
    const half = firstRound.length / 2;
    const topIds = firstRound.slice(0, half).flatMap((match) => [match.teamA!.id, match.teamB!.id]);
    for (const group of groups) {
      expect(topIds.filter((id) => groupFor(id) === group.id)).toHaveLength(1);
    }
  });

  it.each([[10, 3, 2], [12, 2, 3], [5, 3, 3], [8, 4, 1]])(
    "keeps every qualifier with %i teams, %i groups and %i advancing", (count, groupCount, advancing) => {
      const groups = generateGroups(teams(count), groupCount);
      const playoff = generatePlayoffBracket(groups, complete(generateGroupMatches(groups)), advancing);
      const entrants = playoff.filter((match) => match.round === 1).flatMap((match) => [match.teamA, match.teamB]).filter(Boolean);
      const expected = groups.reduce((sum, group) => sum + Math.min(group.teams.length, advancing), 0);
      expect(entrants).toHaveLength(expected);
      expect(new Set(entrants.map((team) => team!.id)).size).toBe(expected);
    },
  );

  it("does not mutate input teams or results", () => {
    const groups = generateGroups(teams(8), 2);
    const matches = complete(generateGroupMatches(groups));
    const before = structuredClone({ groups, matches });
    generatePlayoffBracket(groups, matches);
    expect({ groups, matches }).toEqual(before);
  });
});

describe("winner and standings regressions", () => {
  it("rejects a non-participating winner without changing the bracket", () => {
    const matches = generateBracket(teams(4));
    const before = structuredClone(matches);
    expect(() => advanceWinner(matches, matches[0].id, "unknown")).toThrow("participant");
    expect(matches).toEqual(before);
    expect(() => advanceRoundRobinWinner(matches, matches[0].id, "unknown")).toThrow("participant");
  });

  it("allows a real team whose ID is BYE in round robin", () => {
    const entrants = [...teams(2), { id: "BYE", name: "Real team" }];
    expect(generateSchedule(entrants)).toHaveLength(3);
  });

  it("ranks a cyclic three-way tie independently of input order", () => {
    const entrants = teams(3);
    const results: Match[] = [
      { id: "ab", round: 1, position: 1, teamA: entrants[0], teamB: entrants[1], winnerId: "t1", score: { sets: [{ a: 6, b: 0 }] } },
      { id: "bc", round: 2, position: 1, teamA: entrants[1], teamB: entrants[2], winnerId: "t2", score: { sets: [{ a: 6, b: 0 }] } },
      { id: "ca", round: 3, position: 1, teamA: entrants[2], teamB: entrants[0], winnerId: "t3", score: { sets: [{ a: 6, b: 2 }] } },
    ];
    for (const order of [entrants, [...entrants].reverse(), [entrants[1], entrants[2], entrants[0]]]) {
      expect(getStandings([...results].reverse(), order).map((standing) => standing.team.id)).toEqual(["t1", "t2", "t3"]);
    }
  });
});
