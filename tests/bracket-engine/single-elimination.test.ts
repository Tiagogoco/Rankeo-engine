import { describe, it, expect } from "vitest";
import { generateBracket, advanceWinner } from "../../src/bracket-engine/single-elimination.js";
import type { Team } from "../../src/bracket-engine/types.js";

function makeTeams(n: number): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    seed: i + 1,
  }));
}

describe("Single Elimination — generateBracket", () => {
  it("4 teams: 3 matches (2 QF + 1 final)", () => {
    const matches = generateBracket(makeTeams(4));
    expect(matches).toHaveLength(3);
    expect(matches.filter((m) => m.round === 1)).toHaveLength(2);
    expect(matches.filter((m) => m.round === 2)).toHaveLength(1);
  });

  it("8 teams: 7 matches (4 QF + 2 SF + 1 F)", () => {
    const matches = generateBracket(makeTeams(8));
    expect(matches).toHaveLength(7);
  });

  it("16 teams: 15 matches", () => {
    const matches = generateBracket(makeTeams(16));
    expect(matches).toHaveLength(15);
  });

  it("5 teams: 3 byes in round 1, still 7 matches total", () => {
    const matches = generateBracket(makeTeams(5));
    // Rounds: 8 slots → 4 R1 + 2 R2 + 1 R3 = 7
    expect(matches).toHaveLength(7);
    const byes = matches.filter((m) => m.isBye);
    expect(byes).toHaveLength(3);
  });

  it("3 teams: 1 real match in R1 + 1 bye + 1 final", () => {
    const matches = generateBracket(makeTeams(3));
    expect(matches).toHaveLength(3);
    const byes = matches.filter((m) => m.isBye);
    expect(byes).toHaveLength(1);
  });

  it("all round-1 matches have nextMatchId", () => {
    const matches = generateBracket(makeTeams(8));
    const r1 = matches.filter((m) => m.round === 1 && !m.isBye);
    expect(r1.every((m) => !!m.nextMatchId)).toBe(true);
  });

  it("final has no nextMatchId", () => {
    const matches = generateBracket(makeTeams(8));
    const final = matches.find((m) => m.round === 3);
    expect(final?.nextMatchId).toBeUndefined();
  });

  it("[demo] bye winners propagate into round 2", () => {
    const matches = generateBracket(makeTeams(5));
    // The bye match winner should appear in a round-2 match
    const byeMatch = matches.find((m) => m.isBye);
    expect(byeMatch?.winnerId).toBeDefined();
    const nextMatch = matches.find((m) => m.id === byeMatch?.nextMatchId);
    const byeWinner = byeMatch?.teamA ?? byeMatch?.teamB;
    const appearsInNext = nextMatch?.teamA?.id === byeWinner?.id || nextMatch?.teamB?.id === byeWinner?.id;
    expect(appearsInNext).toBe(true);
  });

  it("seed 1 and seed 2 are on opposite sides of bracket", () => {
    const matches = generateBracket(makeTeams(8));
    const r1 = matches.filter((m) => m.round === 1);
    const matchWithSeed1 = r1.find((m) => m.teamA?.seed === 1 || m.teamB?.seed === 1);
    const matchWithSeed2 = r1.find((m) => m.teamA?.seed === 2 || m.teamB?.seed === 2);
    // They should not be in the same match
    expect(matchWithSeed1?.id).not.toBe(matchWithSeed2?.id);
  });
});

describe("Single Elimination — advanceWinner", () => {
  it("places winner in next match correct slot", () => {
    const matches = generateBracket(makeTeams(4));
    const r1 = matches.filter((m) => m.round === 1 && !m.isBye);
    const first = r1[0];
    const winnerId = first.teamA!.id;

    const updated = advanceWinner(matches, first.id, winnerId);
    const nextMatch = updated.find((m) => m.id === first.nextMatchId);

    expect(nextMatch).toBeDefined();
    const slot = first.nextMatchSlot === "a" ? nextMatch?.teamA : nextMatch?.teamB;
    expect(slot?.id).toBe(winnerId);
  });

  it("sets winnerId on the match", () => {
    const matches = generateBracket(makeTeams(4));
    const r1 = matches.filter((m) => m.round === 1 && !m.isBye);
    const first = r1[0];
    const updated = advanceWinner(matches, first.id, first.teamA!.id);
    const match = updated.find((m) => m.id === first.id);
    expect(match?.winnerId).toBe(first.teamA!.id);
  });

  it("[demo] full 4-team bracket: advancing all produces a champion", () => {
    let matches = generateBracket(makeTeams(4));
    const r1 = matches.filter((m) => m.round === 1 && !m.isBye);

    // Advance R1
    for (const m of r1) {
      matches = advanceWinner(matches, m.id, m.teamA!.id);
    }

    // Advance Final
    const final = matches.find((m) => m.round === 2)!;
    matches = advanceWinner(matches, final.id, final.teamA!.id);

    const champion = matches.find((m) => m.round === 2);
    expect(champion?.winnerId).toBeDefined();
  });
});
