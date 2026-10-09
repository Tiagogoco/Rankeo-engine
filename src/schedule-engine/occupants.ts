import type { EngineMatch, ExistingAssignment } from "./types.js";

export type RosterPlayer = { name: string; id?: string };

/**
 * Returns the occupant ids for a single team.
 *
 * The occupant set is used by the scheduler instead of team_id so that a
 * player inscribed in two different categories (two different team_ids) still
 * causes a rest-gap conflict.
 *
 * Fallback rules (applied per-player, not per-team):
 * - Player has an id  → include that id.
 * - Player has no id  → include the team_id as fallback so we never lose the
 *   existing same-team guarantee.
 *
 * Result: never empty when teamId is provided.
 */
export function teamOccupants(
  teamId: string,
  players: RosterPlayer[] | null | undefined,
): string[] {
  if (!players || players.length === 0) return [teamId];

  const ids: string[] = [];
  let hasUnresolved = false;

  for (const p of players) {
    if (p.id) {
      ids.push(p.id);
    } else {
      hasUnresolved = true;
    }
  }

  if (hasUnresolved || ids.length === 0) ids.push(teamId);

  return ids;
}

/**
 * Builds an occupantMap for all teams in a tournament.
 * Keys are team_ids; values are arrays of occupant ids (player_ids + fallbacks).
 */
export function buildOccupantMap(
  teams: { id: string; players: RosterPlayer[] | null | undefined }[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const t of teams) {
    map[t.id] = teamOccupants(t.id, t.players);
  }
  return map;
}

/** Unknown participants reserve time for every player who could qualify. */
export function buildMatchOccupants(
  matches: EngineMatch[],
  existing: ExistingAssignment[],
  occupantMap: Record<string, string[]>,
): Map<string, string[]> {
  type ParticipantSource = Pick<EngineMatch, "team_a_id" | "team_b_id" | "next_match_id">;
  const sources = new Map<string, ParticipantSource>(matches.map((match) => [match.id, match]));
  for (const assignment of existing) {
    if (assignment.match_id) {
      sources.set(assignment.match_id, assignment);
    }
  }
  const feeders = new Map<string, string[]>();
  for (const [id, source] of sources) {
    if (!source.next_match_id) continue;
    const ids = feeders.get(source.next_match_id) ?? [];
    ids.push(id);
    feeders.set(source.next_match_id, ids);
  }
  const result = new Map<string, string[]>();
  function resolve(id: string, visiting = new Set<string>()): string[] {
    const cached = result.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error("Schedule dependencies must not contain cycles");
    visiting.add(id);
    const source = sources.get(id)!;
    const occupants = new Set<string>();
    for (const teamId of [source.team_a_id, source.team_b_id]) {
      if (teamId) for (const player of occupantMap[teamId] ?? [teamId]) occupants.add(player);
    }
    if (!source.team_a_id || !source.team_b_id) {
      for (const feeder of feeders.get(id) ?? []) {
        for (const player of resolve(feeder, visiting)) occupants.add(player);
      }
    }
    visiting.delete(id);
    const players = [...occupants];
    result.set(id, players);
    return players;
  }
  for (const id of sources.keys()) resolve(id);
  return result;
}
