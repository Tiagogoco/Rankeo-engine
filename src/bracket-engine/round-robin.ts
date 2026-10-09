import { getStandings } from "./standings.js";
export { getStandings } from "./standings.js";
import type { Team, Match, BracketEngine } from "./types.js";

/**
 * Circle method round robin.
 * Fixes team[0], rotates the rest each round.
 * Produces n-1 rounds for even n, n rounds for odd n (with a bye each round).
 */
export function generateSchedule(teams: Team[], groupId?: string): Match[] {
  if (teams.length < 2) return [];

  const list: (Team | null)[] = [...teams];
  const hasBye = list.length % 2 !== 0;
  if (hasBye) list.push(null);

  const n = list.length;
  const rounds = n - 1;
  const matches: Match[] = [];
  let matchCounter = 1;

  const rotation = list.slice(1); // all except first (fixed)

  for (let r = 0; r < rounds; r++) {
    const roundTeams = [list[0], ...rotation];

    for (let i = 0; i < n / 2; i++) {
      const teamA = roundTeams[i];
      const teamB = roundTeams[n - 1 - i];

      if (!teamA || !teamB) {
        // Skip bye matches — don't create a match
        continue;
      }

      matches.push({
        id: `rr-${matchCounter++}`,
        round: r + 1,
        position: i + 1,
        teamA,
        teamB,
        groupId,
      });
    }

    // Rotate: move last element to front of rotation
    rotation.unshift(rotation.pop()!);
  }

  return matches;
}

export function advanceWinner(matches: Match[], matchId: string, winnerId: string): Match[] {
  const match = matches.find((entry) => entry.id === matchId);
  if (match && ![match.teamA?.id, match.teamB?.id, "draw"].includes(winnerId)) {
    throw new Error("Winner must be a participant in the match or draw");
  }
  return matches.map((m) =>
    m.id === matchId ? { ...m, winnerId } : m
  );
}

export const roundRobinEngine: BracketEngine = {
  generateMatches: (teams) => generateSchedule(teams),
  advanceWinner,
  getStandings,
};
