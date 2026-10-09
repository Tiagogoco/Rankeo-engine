import type { EngineMatch, ScheduleConfig, ScheduleAssignment, Slot } from "./types.js";
import type { ConstraintState } from "./constraints.js";
import { makeScheduleDate, formatLocalDate } from "./time.js";

// Greedy: process matches in sporting order; each takes the first valid slot.
export function runGreedy(sortedMatches: EngineMatch[], slots: Slot[], state: ConstraintState, config: ScheduleConfig): ScheduleAssignment[] {
  const assignments: ScheduleAssignment[] = [];
  for (const match of sortedMatches) {
    for (const slot of slots) {
      const scheduledAt = makeScheduleDate(slot.date, slot.startMin);
      const endAt = new Date(scheduledAt.getTime() + config.match_duration * 60_000);
      if (
        state.canStartAfterFeeders(match.id, scheduledAt) &&
        state.canPlaceCourt(slot.courtId, scheduledAt, endAt) &&
        state.canPlaceTeams(match.team_a_id, match.team_b_id, scheduledAt, endAt, match.id)
      ) {
        state.place(match.id, slot.courtId, match.team_a_id, match.team_b_id, scheduledAt, endAt);
        assignments.push({ match_id: match.id, court_id: slot.courtId, scheduled_at: scheduledAt });
        break;
      }
    }
  }
  return assignments;
}

// Walk slots chronologically, choosing the first feasible match in the supplied order.
export function runOptimized(sortedMatches: EngineMatch[], slots: Slot[], state: ConstraintState, config: ScheduleConfig): ScheduleAssignment[] {
  const assignments: ScheduleAssignment[] = [];
  const remaining = new Set(sortedMatches.map((m) => m.id));

  for (const slot of slots) {
    if (remaining.size === 0) break;
    const scheduledAt = makeScheduleDate(slot.date, slot.startMin);
    const endAt = new Date(scheduledAt.getTime() + config.match_duration * 60_000);
    if (!state.canPlaceCourt(slot.courtId, scheduledAt, endAt)) continue;

    for (const match of sortedMatches) {
      if (!remaining.has(match.id)) continue;
      if (
        state.canStartAfterFeeders(match.id, scheduledAt) &&
        state.canPlaceTeams(match.team_a_id, match.team_b_id, scheduledAt, endAt, match.id)
      ) {
        state.place(match.id, slot.courtId, match.team_a_id, match.team_b_id, scheduledAt, endAt);
        assignments.push({ match_id: match.id, court_id: slot.courtId, scheduled_at: scheduledAt });
        remaining.delete(match.id);
        break;
      }
    }
  }
  return assignments;
}

// Compare placed count, finish time, then unused grid starts before that finish.
function scheduleMetrics(assignments: ScheduleAssignment[], slots: Slot[], config: ScheduleConfig) {
  let makespan = 0;
  const used = new Set<string>();
  for (const a of assignments) {
    const end = a.scheduled_at.getTime() + config.match_duration * 60_000;
    if (end > makespan) makespan = end;
    const min = a.scheduled_at.getUTCHours() * 60 + a.scheduled_at.getUTCMinutes();
    used.add(`${formatLocalDate(a.scheduled_at)}|${min}|${a.court_id}`);
  }
  let gaps = 0;
  for (const s of slots) {
    if (makeScheduleDate(s.date, s.startMin).getTime() >= makespan) continue;
    if (!used.has(`${s.date}|${s.startMin}|${s.courtId}`)) gaps++;
  }
  return { count: assignments.length, makespan, gaps };
}

// True only when `a` is STRICTLY better than `b` by (count desc, makespan asc,
// gaps asc). Ties → false, so greedy is kept unless optimized actually improves.
export function isStrictlyBetter(a: ScheduleAssignment[], b: ScheduleAssignment[], slots: Slot[], config: ScheduleConfig): boolean {
  const ma = scheduleMetrics(a, slots, config);
  const mb = scheduleMetrics(b, slots, config);
  if (ma.count !== mb.count) return ma.count > mb.count;
  if (ma.makespan !== mb.makespan) return ma.makespan < mb.makespan;
  if (ma.gaps !== mb.gaps) return ma.gaps < mb.gaps;
  return false;
}
