import { describe, it, expect } from "vitest";
import { generateSchedule, getStandings } from "../../src/bracket-engine/round-robin.js";
import type { Team } from "../../src/bracket-engine/types.js";

function makeTeams(n: number): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
  }));
}

describe("Round Robin — generateSchedule", () => {
  it("4 teams: 6 matches (4*3/2)", () => {
    expect(generateSchedule(makeTeams(4))).toHaveLength(6);
  });

  it("5 teams: 10 matches (5*4/2)", () => {
    expect(generateSchedule(makeTeams(5))).toHaveLength(10);
  });

  it("3 teams: 3 matches", () => {
    expect(generateSchedule(makeTeams(3))).toHaveLength(3);
  });

  it("every pair plays exactly once (4 teams)", () => {
    const teams = makeTeams(4);
    const matches = generateSchedule(teams);
    const pairs = new Set<string>();
    for (const m of matches) {
      const key = [m.teamA!.id, m.teamB!.id].sort().join("-");
      pairs.add(key);
    }
    expect(pairs.size).toBe(6);
  });

  it("[demo] every pair plays exactly once (5 teams)", () => {
    const teams = makeTeams(5);
    const matches = generateSchedule(teams);
    const pairs = new Set<string>();
    for (const m of matches) {
      const key = [m.teamA!.id, m.teamB!.id].sort().join("-");
      pairs.add(key);
    }
    expect(pairs.size).toBe(10);
  });

  it("[demo] no team plays twice in the same round", () => {
    const matches = generateSchedule(makeTeams(6));
    const maxRound = Math.max(...matches.map((m) => m.round));
    for (let r = 1; r <= maxRound; r++) {
      const roundMatches = matches.filter((m) => m.round === r);
      const teamIds = roundMatches.flatMap((m) => [m.teamA!.id, m.teamB!.id]);
      const unique = new Set(teamIds);
      expect(unique.size).toBe(teamIds.length);
    }
  });
});

function score(a: number, b: number): { sets: { a: number; b: number }[] } {
  return { sets: [{ a, b }] };
}

describe("Round Robin — getStandings", () => {
  it("correct points: 3 for win, 0 for loss", () => {
    const teams = makeTeams(3);
    let matches = generateSchedule(teams);
    matches = matches.map((m) => ({ ...m, winnerId: [m.teamA?.id, m.teamB?.id].includes("t1") ? "t1" : m.teamA!.id }));
    const standings = getStandings(matches, teams);
    const t1 = standings.find((s) => s.team.id === "t1")!;
    expect(t1.wins).toBe(2);
    expect(t1.points).toBe(6);
  });

  it("leader appears first", () => {
    const teams = makeTeams(4);
    let matches = generateSchedule(teams);
    matches = matches.map((m) => ({
      ...m,
      winnerId: m.teamA?.id === "t1" || m.teamB?.id === "t1" ? "t1" : m.teamA!.id,
    }));
    const standings = getStandings(matches, teams);
    expect(standings[0].team.id).toBe("t1");
  });

  it("draw gives 1 point each", () => {
    const teams = makeTeams(2);
    const matches = generateSchedule(teams).map((m) => ({ ...m, winnerId: "draw" }));
    const standings = getStandings(matches, teams);
    expect(standings[0].points).toBe(1);
    expect(standings[1].points).toBe(1);
    expect(standings[0].draws).toBe(1);
  });

  it("orders teams by points", () => {
    const teams = makeTeams(3);
    const matches = [
      { id: "1", round: 1, position: 1, teamA: teams[0], teamB: teams[1], winnerId: "t2", score: score(4, 6) },
      { id: "2", round: 2, position: 1, teamA: teams[0], teamB: teams[2], winnerId: "t1", score: score(6, 0) },
      { id: "3", round: 3, position: 1, teamA: teams[1], teamB: teams[2], winnerId: "t2", score: score(6, 1) },
    ];
    const standings = getStandings(matches, teams);
    expect(standings[0].team.id).toBe("t2");
    expect(standings[1].team.id).toBe("t1");
    expect(standings[2].team.id).toBe("t3");
  });

  it("uses game difference to resolve a three-way tie", () => {
    const teams = makeTeams(3);
    const matches = [
      { id: "1", round: 1, position: 1, teamA: teams[0], teamB: teams[1], winnerId: "t1", score: score(6, 0) },
      { id: "2", round: 2, position: 1, teamA: teams[1], teamB: teams[2], winnerId: "t2", score: score(6, 0) },
      { id: "3", round: 3, position: 1, teamA: teams[2], teamB: teams[0], winnerId: "t3", score: score(6, 2) },
    ];
    const standings = getStandings(matches, teams);
    expect(standings[0].team.id).toBe("t1");
    expect(standings[1].team.id).toBe("t2");
    expect(standings[2].team.id).toBe("t3");
  });

  it("counts won and lost sets", () => {
    const teams = makeTeams(2);
    const matches = [
      {
        id: "1", round: 1, position: 1,
        teamA: teams[0], teamB: teams[1],
        winnerId: "t1",
        score: { sets: [{ a: 6, b: 3 }, { a: 4, b: 6 }, { a: 7, b: 5 }] },
      },
    ];
    const standings = getStandings(matches, teams);
    expect(standings[0]).toMatchObject({ team: { id: "t1" }, scored: 2, conceded: 1 });
    expect(standings[1]).toMatchObject({ team: { id: "t2" }, scored: 1, conceded: 2 });
  });
});
