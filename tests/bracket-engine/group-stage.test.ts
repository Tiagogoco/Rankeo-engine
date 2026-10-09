import { describe, it, expect } from "vitest";
import {
  generateGroups,
  generateGroupMatches,
  generatePlayoffBracket,
} from "../../src/bracket-engine/group-stage.js";
import type { Team } from "../../src/bracket-engine/types.js";

function makeTeams(n: number): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    seed: i + 1,
  }));
}

describe("Group Stage — generateGroups", () => {
  it("8 teams into 2 groups of 4", () => {
    const groups = generateGroups(makeTeams(8), 2);
    expect(groups).toHaveLength(2);
    expect(groups[0].teams).toHaveLength(4);
    expect(groups[1].teams).toHaveLength(4);
  });

  it("seeds are spread across groups (snake draft)", () => {
    const groups = generateGroups(makeTeams(8), 2);
    // seed 1 → group A, seed 2 → group B, seed 3 → group B, seed 4 → group A...
    const groupASeeds = groups[0].teams.map((t) => t.seed).sort((a, b) => a! - b!);
    const groupBSeeds = groups[1].teams.map((t) => t.seed).sort((a, b) => a! - b!);
    // Both groups should have one top seed
    expect(groupASeeds[0]).toBe(1);
    expect(groupBSeeds[0]).toBe(2);
  });

  it("groups have names A, B, C...", () => {
    const groups = generateGroups(makeTeams(12), 3);
    expect(groups.map((g) => g.name)).toEqual(["A", "B", "C"]);
  });

  it("handles uneven distribution (10 teams, 3 groups)", () => {
    const groups = generateGroups(makeTeams(10), 3);
    const total = groups.reduce((s, g) => s + g.teams.length, 0);
    expect(total).toBe(10);
  });
});

describe("Group Stage — generateGroupMatches", () => {
  it("each match has a groupId", () => {
    const groups = generateGroups(makeTeams(8), 2);
    const matches = generateGroupMatches(groups);
    expect(matches.every((m) => !!m.groupId)).toBe(true);
  });

  it("correct total match count: 2 groups × 4 teams = 12 matches", () => {
    const groups = generateGroups(makeTeams(8), 2);
    const matches = generateGroupMatches(groups);
    // Each group of 4 has 6 matches → 12 total
    expect(matches).toHaveLength(12);
  });
});

describe("Group Stage — generatePlayoffBracket", () => {
  it("top 2 per group produce a playoff bracket", () => {
    const teams = makeTeams(8);
    const groups = generateGroups(teams, 2);
    const groupMatches = generateGroupMatches(groups);

    const completedMatches = groupMatches.map((match) => ({
      ...match,
      winnerId: (match.teamA!.seed! < match.teamB!.seed! ? match.teamA : match.teamB)!.id,
    }));

    const playoff = generatePlayoffBracket(groups, completedMatches, 2);
    // 4 teams → 3 playoff matches
    expect(playoff).toHaveLength(3);
  });
});
