import type { Match, Standing, Team } from "./types.js";

interface Statistics {
  standing: Standing;
  gamesFor: number;
  gamesAgainst: number;
}

function collectStatistics(matches: Match[], teams: Team[]): Map<string, Statistics> {
  const statistics = new Map(teams.map((team) => [team.id, {
    standing: { team, wins: 0, losses: 0, draws: 0, points: 0, scored: 0, conceded: 0, played: 0 },
    gamesFor: 0,
    gamesAgainst: 0,
  }]));
  for (const match of matches) {
    if (!match.winnerId || !match.teamA || !match.teamB) continue;
    const a = statistics.get(match.teamA.id);
    const b = statistics.get(match.teamB.id);
    if (!a || !b) continue;
    if (![match.teamA.id, match.teamB.id, "draw"].includes(match.winnerId)) {
      throw new Error("Winner must be a participant in the match or draw");
    }
    a.standing.played++;
    b.standing.played++;
    for (const set of match.score?.sets ?? []) {
      a.gamesFor += set.a;
      a.gamesAgainst += set.b;
      b.gamesFor += set.b;
      b.gamesAgainst += set.a;
      if (set.a > set.b) {
        a.standing.scored++;
        b.standing.conceded++;
      } else if (set.b > set.a) {
        b.standing.scored++;
        a.standing.conceded++;
      }
    }
    if (match.winnerId === "draw") {
      a.standing.draws++;
      b.standing.draws++;
      a.standing.points++;
      b.standing.points++;
    } else {
      const [winner, loser] = match.winnerId === match.teamA.id ? [a, b] : [b, a];
      winner.standing.wins++;
      loser.standing.losses++;
      winner.standing.points += 3;
    }
  }
  return statistics;
}

const setDifference = ({ standing }: Statistics) => standing.scored - standing.conceded;
const gameDifference = (stats: Statistics) => stats.gamesFor - stats.gamesAgainst;

/**
 * Ties use a mini-table containing every team tied on points. Comparing direct
 * opponents inside Array.sort would be cyclic when A beats B, B beats C, C beats A.
 * Criteria: mini-table points, sets, games; overall sets, games; seed, then ID.
 */
export function getStandings(matches: Match[], teams: Team[]): Standing[] {
  const overall = collectStatistics(matches, teams);
  const tiedGroups = new Map<number, Team[]>();
  for (const { standing } of overall.values()) {
    const group = tiedGroups.get(standing.points) ?? [];
    group.push(standing.team);
    tiedGroups.set(standing.points, group);
  }
  const headToHead = new Map<string, Statistics>();
  for (const group of tiedGroups.values()) {
    for (const [id, stats] of collectStatistics(matches, group)) headToHead.set(id, stats);
  }
  return [...overall.values()].sort((a, b) => {
    const aHead = headToHead.get(a.standing.team.id)!;
    const bHead = headToHead.get(b.standing.team.id)!;
    return b.standing.points - a.standing.points
      || bHead.standing.points - aHead.standing.points
      || setDifference(bHead) - setDifference(aHead)
      || gameDifference(bHead) - gameDifference(aHead)
      || setDifference(b) - setDifference(a)
      || gameDifference(b) - gameDifference(a)
      || (a.standing.team.seed ?? Number.MAX_SAFE_INTEGER) - (b.standing.team.seed ?? Number.MAX_SAFE_INTEGER)
      || a.standing.team.id.localeCompare(b.standing.team.id);
  }).map(({ standing }) => standing);
}
