import type { Team, Match, Group } from "./types.js";
import { generateSchedule, getStandings } from "./round-robin.js";
import { buildSeedOrder, generateBracketFromSlots } from "./single-elimination.js";

/**
 * Distribute teams into groups with seed separation.
 * Seeds are spread across groups: seed 1 → group 0, seed 2 → group 1, etc.
 * (snake draft pattern)
 */
export function generateGroups(teams: Team[], groupCount: number): Group[] {
  if (!Number.isInteger(groupCount) || groupCount < 1) {
    throw new Error("groupCount must be a positive integer");
  }

  const sorted = [...teams].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
  const groups: Group[] = Array.from({ length: groupCount }, (_, i) => ({
    id: `group-${i}`,
    name: String.fromCharCode(65 + i), // A, B, C...
    teams: [],
  }));

  // Snake draft: round 1 → 0,1,2,...; round 2 → reversed; etc.
  let forward = true;
  let groupIdx = 0;

  for (const team of sorted) {
    groups[groupIdx].teams.push(team);
    if (forward) {
      groupIdx++;
      if (groupIdx >= groupCount) {
        groupIdx = groupCount - 1;
        forward = false;
      }
    } else {
      groupIdx--;
      if (groupIdx < 0) {
        groupIdx = 0;
        forward = true;
      }
    }
  }

  return groups;
}

/** Generate round-robin matches for each group */
export function generateGroupMatches(groups: Group[]): Match[] {
  return groups.flatMap((group) =>
    generateSchedule(group.teams, group.id).map((match) => ({
      ...match,
      id: `${group.id}:${match.id}`,
    })),
  );
}

/**
 * Place qualifiers by finishing rank, keeping higher ranks in the seeded slots.
 * Within each rank, delay same-group rematches as far as the bracket allows.
 */
export function generatePlayoffBracket(
  groups: Group[],
  groupMatches: Match[],
  advancingPerGroup = 2,
): Match[] {
  if (!Number.isInteger(advancingPerGroup) || advancingPerGroup < 1) {
    throw new Error("advancingPerGroup must be a positive integer");
  }
  const qualifiers = groups.flatMap((group) =>
    getStandings(groupMatches.filter((match) => match.groupId === group.id), group.teams)
      .slice(0, advancingPerGroup)
      .map((standing, rank) => ({ team: standing.team, groupId: group.id, rank })),
  );
  if (qualifiers.length < 2) return [];

  const size = 2 ** Math.ceil(Math.log2(qualifiers.length));
  const seedOrder = buildSeedOrder(size);
  const slots: (Team | null)[] = Array(size).fill(null);
  const positionsByGroup = new Map<string, number[]>();
  let seed = 1;

  const ranks = [...new Set(qualifiers.map((qualifier) => qualifier.rank))].sort((a, b) => a - b);
  for (const rank of ranks) {
    const remaining = qualifiers.filter((qualifier) => qualifier.rank === rank);
    while (remaining.length > 0) {
      const slot = seedOrder.indexOf(seed++);
      // XOR identifies the first common bracket round: larger means later.
      const separation = (groupId: string) => Math.min(
        ...((positionsByGroup.get(groupId) ?? []).map((position) =>
          Math.floor(Math.log2(slot ^ position)),
        )),
      );
      let bestIndex = 0;
      for (let index = 1; index < remaining.length; index++) {
        if (separation(remaining[index].groupId) > separation(remaining[bestIndex].groupId)) {
          bestIndex = index;
        }
      }
      const [qualifier] = remaining.splice(bestIndex, 1);
      slots[slot] = qualifier.team;
      const positions = positionsByGroup.get(qualifier.groupId) ?? [];
      positions.push(slot);
      positionsByGroup.set(qualifier.groupId, positions);
    }
  }
  return generateBracketFromSlots(slots);
}

export { getStandings };
