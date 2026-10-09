import { getScheduleGridStep } from "../schedule-grid.js";
import { createConstraintState } from "./constraints.js";
import { buildMatchOccupants } from "./occupants.js";
import { buildSlots } from "./time.js";
import { validateScheduleInput } from "./input.js";
import { runGreedy, runOptimized, isStrictlyBetter } from "./strategies.js";
import {
  buildFeederGraph, sortBySportingOrder, buildHeightOf,
  buildConflictDegreeOf, sortByConstrainedness, shuffledTopologicalOrder,
} from "./ordering.js";
import type {
  EngineMatch, EngineCourt, ScheduleConfig, ExistingAssignment,
  ScheduleStrategy, ScheduleAssignment, ScheduleResult,
} from "./types.js";

export type * from "./types.js";
export type { RosterPlayer } from "./occupants.js";
export { buildOccupantMap } from "./occupants.js";
export { getScheduleGridStep, getScheduleGridStepFromTotal } from "../schedule-grid.js";
export { getSchedulableScheduleConfig, buildDateRange } from "./time.js";
export { validateAssignments } from "./validate.js";
export type { ValidationResult } from "./validate.js";

export function generateSchedule(
  matches: EngineMatch[],
  courts: EngineCourt[],
  config: ScheduleConfig,
  existing: ExistingAssignment[] = [],
  occupantMap: Record<string, string[]> = {},
  strategy: ScheduleStrategy = "greedy",
): ScheduleAssignment[] {
  return generateScheduleResult(matches, courts, config, existing, occupantMap, strategy).assignments;
}

export function generateScheduleResult(
  matches: EngineMatch[],
  courts: EngineCourt[],
  config: ScheduleConfig,
  existing: ExistingAssignment[] = [],
  occupantMap: Record<string, string[]> = {},
  strategy: ScheduleStrategy = "greedy",
): ScheduleResult {
  const empty: ScheduleResult = { assignments: [], strategy: "greedy", fellBackToGreedy: false };
  if (courts.length === 0 || config.days.length === 0 || matches.length === 0) return empty;

  validateScheduleInput(matches, courts, config, existing);
  const matchOccupants = buildMatchOccupants(matches, existing, occupantMap);
  const sortedCourts = [...courts].sort((a, b) => a.sort_order - b.sort_order);
  const gridStep = getScheduleGridStep(config.match_duration, config.break_between);
  const slots = buildSlots({ ...config, days: [...config.days].sort((a, b) => a.date.localeCompare(b.date)) }, sortedCourts, gridStep);
  if (slots.length === 0) return empty;

  const { feeders, depthOf } = buildFeederGraph(matches, existing);
  const sortedMatches = sortBySportingOrder(matches, depthOf);

  const newState = () => createConstraintState(config, existing, occupantMap, feeders, matchOccupants);

  const greedy = runGreedy(sortedMatches, slots, newState(), config);
  if (strategy === "greedy") {
    return { assignments: greedy, strategy: "greedy", fellBackToGreedy: false };
  }

  const heightOf = buildHeightOf(matches);
  const conflictDegreeOf = buildConflictDegreeOf(matches, occupantMap);
  const constrainedFirst = sortByConstrainedness(matches, depthOf, heightOf, conflictDegreeOf);

  // Each candidate gets a fresh state; ties preserve the incumbent schedule.
  const candidates = [
    runOptimized(sortedMatches, slots, newState(), config),
    runGreedy(constrainedFirst, slots, newState(), config),
    runOptimized(constrainedFirst, slots, newState(), config),
  ];
  // Seeded restarts: fixed seeds → deterministic. Each explores a different
  // topological-safe order; the gate below discards anything not strictly better.
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const order = shuffledTopologicalOrder(matches, depthOf, seed);
    candidates.push(runGreedy(order, slots, newState(), config));
  }

  let best = greedy;
  let adopted = false;
  for (const candidate of candidates) {
    if (isStrictlyBetter(candidate, best, slots, config)) {
      best = candidate;
      adopted = true;
    }
  }

  if (adopted) {
    return { assignments: best, strategy: "optimized", fellBackToGreedy: false };
  }
  return { assignments: greedy, strategy: "greedy", fellBackToGreedy: true };
}
