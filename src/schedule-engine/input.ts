import { DEFAULT_PLAYER_REST_MINUTES } from "./constraints.js";
import type { EngineMatch, EngineCourt, ExistingAssignment, ScheduleConfig } from "./types.js";

function requireUniqueIds(ids: string[], label: string): void {
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`${label} must have non-empty, unique IDs`);
  }
}

export function validateScheduleInput(
  matches: EngineMatch[],
  courts: EngineCourt[],
  config: ScheduleConfig,
  existing: ExistingAssignment[],
): void {
  requireUniqueIds(matches.map((match) => match.id), "Matches");
  requireUniqueIds(courts.map((court) => court.id), "Courts");
  requireUniqueIds(config.days.map((day) => day.date), "Days");
  if (!Number.isFinite(config.match_duration) || config.match_duration <= 0) {
    throw new Error("match_duration must be positive and finite");
  }
  for (const value of [config.break_between, config.player_rest_minutes ?? DEFAULT_PLAYER_REST_MINUTES]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Break and player rest must be non-negative and finite");
    }
  }
  for (const day of config.days) {
    const date = new Date(`${day.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day.date) {
      throw new Error("Schedule dates must be valid YYYY-MM-DD dates");
    }
    if (![day.start_time, day.end_time].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      throw new Error("Schedule times must use HH:MM (00:00–23:59)");
    }
  }
  if (existing.some((assignment) => !Number.isFinite(new Date(assignment.scheduled_at).getTime()))) {
    throw new Error("Existing assignments must have valid timestamps");
  }
}
