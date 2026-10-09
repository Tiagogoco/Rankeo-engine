// Checks completed schedules without using the scheduler's mutable constraint state.
import { teamOccupants } from "./occupants.js";
import { getPlayerRestMs } from "./constraints.js";
import { validateScheduleInput } from "./input.js";
import type { EngineMatch, ScheduleConfig, ScheduleAssignment, ExistingAssignment } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function occupantsOf(teamId: string | null, occupantMap: Record<string, string[]>): string[] {
  if (!teamId) return [];
  return occupantMap[teamId] ?? teamOccupants(teamId, null);
}

/**
 * Validates assignments against the five engine-enforced hard rules:
 * court overlap (+break), configured player rest, day window,
 * pre-existing occupancy, and round precedence. The past-time rule
 * (no scheduling in the past) is enforced upstream by getSchedulableScheduleConfig.
 */
export function validateAssignments(
  assignments: ScheduleAssignment[],
  matches: EngineMatch[],
  config: ScheduleConfig,
  existing: ExistingAssignment[] = [],
  occupantMap: Record<string, string[]> = {},
): ValidationResult {
  const violations: string[] = [];
  try {
    validateScheduleInput(matches, [], config, existing);
  } catch (error) {
    return { valid: false, violations: [error instanceof Error ? error.message : "Invalid schedule input"] };
  }
  const durationMs = config.match_duration * 60_000;
  const breakMs = config.break_between * 60_000;
  const restMs = getPlayerRestMs(config);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const assignedIds = new Set<string>();
  for (const assignment of assignments) {
    if (!matchById.has(assignment.match_id)) violations.push(`unknown match: ${assignment.match_id}`);
    if (assignedIds.has(assignment.match_id)) violations.push(`duplicate assignment: ${assignment.match_id}`);
    if (!assignment.court_id) violations.push(`missing court: ${assignment.match_id}`);
    if (!Number.isFinite(assignment.scheduled_at.getTime())) violations.push(`invalid date: ${assignment.match_id}`);
    assignedIds.add(assignment.match_id);
  }

  // Fixed-point propagation is deliberately separate from buildMatchOccupants.
  // A future match with unknown teams can contain anyone from its feeders.
  const sources = [
    ...matches,
    ...existing.filter((entry) => entry.match_id).map((entry) => ({ ...entry, id: entry.match_id! })),
  ];
  const possiblePlayers = new Map(sources.map((source) => [source.id, new Set([
    ...occupantsOf(source.team_a_id, occupantMap),
    ...occupantsOf(source.team_b_id, occupantMap),
  ])]));
  const unresolved = new Set(sources.filter((source) => !source.team_a_id || !source.team_b_id).map((source) => source.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const source of sources) {
      if (!source.next_match_id || !unresolved.has(source.next_match_id)) continue;
      const target = possiblePlayers.get(source.next_match_id)!;
      for (const player of possiblePlayers.get(source.id) ?? []) {
        if (!target.has(player)) {
          target.add(player);
          changed = true;
        }
      }
    }
  }

  // Resolve each assignment to start/end + the match it belongs to.
  type Placed = { id: string; courtId: string; start: number; end: number; teamA: string | null; teamB: string | null };
  const placed: Placed[] = assignments.map((a) => {
    const m = matchById.get(a.match_id);
    const start = a.scheduled_at.getTime();
    return { id: a.match_id, courtId: a.court_id, start, end: start + durationMs, teamA: m?.team_a_id ?? null, teamB: m?.team_b_id ?? null };
  });

  // Pre-existing occupancy as fixed windows.
  const existingPlaced: Placed[] = existing.map((e) => {
    const start = new Date(e.scheduled_at).getTime();
    return { id: e.match_id ?? "existing", courtId: e.court_id, start, end: start + durationMs, teamA: e.team_a_id, teamB: e.team_b_id };
  });
  const all = [...placed, ...existingPlaced];

  // 1. No two matches overlap on the same court (including break turnaround).
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.courtId !== b.courtId) continue;
      if (overlaps(a.start, a.end + breakMs, b.start, b.end + breakMs)) {
        violations.push(`court overlap on ${a.courtId}: ${a.id} vs ${b.id}`);
      }
    }
  }

  // 2. Same physical player rests at least MIN_REST between matches.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const aOcc = possiblePlayers.get(a.id) ?? new Set([...occupantsOf(a.teamA, occupantMap), ...occupantsOf(a.teamB, occupantMap)]);
      const bOcc = possiblePlayers.get(b.id) ?? new Set([...occupantsOf(b.teamA, occupantMap), ...occupantsOf(b.teamB, occupantMap)]);
      const shared = [...bOcc].some((o) => aOcc.has(o));
      if (!shared) continue;
      if (overlaps(a.start - restMs, a.end + restMs, b.start, b.end)) {
        violations.push(`player rest violation: ${a.id} vs ${b.id}`);
      }
    }
  }

  // 3. Every assignment starts within a configured day window.
  const dayByDate = new Map(config.days.map((d) => [d.date, d]));
  for (const a of placed) {
    const d = new Date(a.start);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const day = dayByDate.get(dateStr);
    if (!day) {
      violations.push(`assignment ${a.id} on unconfigured day ${dateStr}`);
      continue;
    }
    const startMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const [sh, sm] = day.start_time.split(":").map(Number);
    const [eh, em] = day.end_time.split(":").map(Number);
    if (startMin < sh * 60 + sm || startMin > eh * 60 + em) {
      violations.push(`assignment ${a.id} starts outside window ${day.start_time}-${day.end_time}`);
    }
  }

  // 4. Feeders must be scheduled, finish, and allow the qualifying players to rest.
  const endById = new Map<string, number>();
  for (const p of all) if (p.id !== "existing") endById.set(p.id, p.end);
  const feeders = new Map<string, string[]>();
  const addFeeder = (f: string, dep: string) => {
    const list = feeders.get(dep);
    if (list) list.push(f);
    else feeders.set(dep, [f]);
  };
  for (const m of matches) if (m.next_match_id) addFeeder(m.id, m.next_match_id);
  for (const e of existing) if (e.match_id && e.next_match_id) addFeeder(e.match_id, e.next_match_id);

  for (const a of placed) {
    for (const f of feeders.get(a.id) ?? []) {
      const feederEnd = endById.get(f);
      if (feederEnd === undefined) {
        violations.push(`missing feeder: ${f} required by ${a.id}`);
      } else if (a.start < feederEnd + Math.max(breakMs, restMs)) {
        violations.push(`precedence violation: ${a.id} starts before feeder ${f} finishes and rests`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}
