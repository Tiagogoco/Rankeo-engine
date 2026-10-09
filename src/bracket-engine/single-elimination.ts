import type { Team, Match, BracketOptions, BracketEngine } from "./types.js";

/** Next power of 2 >= n */
function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Map sorted seeds to bracket positions; missing seeds become byes. */
function seedSlots(count: number, totalSlots: number): (number | null)[] {
  const slots: (number | null)[] = new Array(totalSlots).fill(null);

  const order = buildSeedOrder(totalSlots);
  for (let i = 0; i < order.length; i++) {
    const seedPos = order[i] - 1;
    slots[i] = seedPos < count ? seedPos : null;
  }
  return slots;
}

/** Standard bracket seed order for N slots (N must be power of 2) */
export function buildSeedOrder(n: number): number[] {
  if (n === 1) return [1];
  const half = buildSeedOrder(n / 2);
  const result: number[] = [];
  for (const s of half) {
    result.push(s);
    result.push(n + 1 - s);
  }
  return result;
}

export function generateBracket(teams: Team[], options: BracketOptions = {}): Match[] {
  if (teams.length < 2) return [];

  const sorted = options.seeds !== false
    ? [...teams].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
    : [...teams];

  const totalSlots = nextPowerOf2(sorted.length);
  const slots = seedSlots(sorted.length, totalSlots).map((index) =>
    index === null ? null : sorted[index],
  );
  return generateBracketFromSlots(slots);
}

/** Slots are bracket positions, not seeds. Null entries are first-round byes. */
export function generateBracketFromSlots(slots: (Team | null)[]): Match[] {
  const totalSlots = slots.length;
  if (totalSlots < 2) return [];
  if (!Number.isInteger(Math.log2(totalSlots))) {
    throw new Error("Bracket slot count must be a power of two");
  }
  const rounds = Math.log2(totalSlots);
  let matchCounter = 1;
  const roundMatches: Match[][] = [];

  for (let round = 1; round <= rounds; round++) {
    const matchesInRound = totalSlots / 2 ** round;
    roundMatches.push(Array.from({ length: matchesInRound }, (_, index) => ({
      id: `m${matchCounter++}`,
      round,
      position: index + 1,
    })));
  }

  for (let round = 0; round < roundMatches.length - 1; round++) {
    for (const [index, match] of roundMatches[round].entries()) {
      match.nextMatchId = roundMatches[round + 1][Math.floor(index / 2)].id;
      match.nextMatchSlot = index % 2 === 0 ? "a" : "b";
    }
  }

  const r1 = roundMatches[0];

  for (let i = 0; i < r1.length; i++) {
    r1[i].teamA = slots[i * 2] ?? undefined;
    r1[i].teamB = slots[i * 2 + 1] ?? undefined;

    // Auto-advance bye: one team, no opponent
    if (r1[i].teamA && !r1[i].teamB) {
      r1[i].isBye = true;
      r1[i].winnerId = r1[i].teamA!.id;
    } else if (!r1[i].teamA && r1[i].teamB) {
      r1[i].isBye = true;
      r1[i].winnerId = r1[i].teamB!.id;
    }
  }

  return propagateByes(roundMatches.flat());
}

/** After setting isBye + winnerId on round 1, propagate winners to their next match */
function propagateByes(matches: Match[]): Match[] {
  const byId = new Map(matches.map((m) => [m.id, m]));

  for (const match of matches) {
    if (match.isBye && match.winnerId && match.nextMatchId) {
      const next = byId.get(match.nextMatchId);
      if (next) {
        if (match.nextMatchSlot === "a") next.teamA = match.teamA ?? match.teamB;
        else next.teamB = match.teamA ?? match.teamB;
      }
    }
  }

  return matches;
}

export function advanceWinner(matches: Match[], matchId: string, winnerId: string): Match[] {
  const byId = new Map(matches.map((m) => [m.id, { ...m }]));
  const match = byId.get(matchId);
  if (!match) return matches;

  const winnerTeam = [match.teamA, match.teamB].find((team) => team?.id === winnerId);
  if (!winnerTeam) throw new Error("Winner must be a participant in the match");
  match.winnerId = winnerId;

  if (match.nextMatchId) {
    const next = byId.get(match.nextMatchId);
    if (next) {
      if (match.nextMatchSlot === "a") next.teamA = winnerTeam;
      else next.teamB = winnerTeam;
    }
  }

  return [...byId.values()];
}

export const singleEliminationEngine: BracketEngine = {
  generateMatches: generateBracket,
  advanceWinner,
};
