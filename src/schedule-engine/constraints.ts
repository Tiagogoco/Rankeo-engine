import { teamOccupants } from "./occupants.js";
import type { ScheduleConfig, ExistingAssignment } from "./types.js";

/** Default player rest (minutes) when a tournament has no `player_rest_minutes`. */
export const DEFAULT_PLAYER_REST_MINUTES = 90;

/**
 * Minimum rest in ms between two matches for the same physical player
 * (cross-category). Configurable per tournament via `player_rest_minutes`;
 * falls back to 90 min for legacy configs. Distinct from `break_between`,
 * which is the court turnaround / precedence gap.
 */
export function getPlayerRestMs(config: ScheduleConfig): number {
  return (config.player_rest_minutes ?? DEFAULT_PLAYER_REST_MINUTES) * 60_000;
}

type Window = { start: Date; end: Date };

function datesOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

export interface ConstraintState {
  /** True when the court is free for [start, end] (+ break turnaround). */
  canPlaceCourt(courtId: string, start: Date, end: Date): boolean;
  /** True when neither team's physical players violate the rest gap. */
  canPlaceTeams(teamA: string | null, teamB: string | null, start: Date, end: Date, matchId?: string): boolean;
  /**
   * True when every match that feeds matchId's participants has already
   * finished by `start`. A match with no feeders is always allowed. A match
   * whose feeder has not been placed yet (and is not a pre-existing/finished
   * match) is rejected — the dependent must wait until its feeders are placed.
   */
  canStartAfterFeeders(matchId: string, start: Date): boolean;
  /** Marks the court and both teams busy for [start, end]; records the match end. */
  place(matchId: string, courtId: string, teamA: string | null, teamB: string | null, start: Date, end: Date): void;
}

export function createConstraintState(
  config: ScheduleConfig,
  existing: ExistingAssignment[] = [],
  occupantMap: Record<string, string[]> = {},
  // dependentId → ids of the matches that feed its participants (next_match_id graph).
  feeders: Map<string, string[]> = new Map(),
  matchOccupants: Map<string, string[]> = new Map(),
): ConstraintState {
  // Keyed by occupant id (player_id when available, team_id as fallback).
  const occupantWindows = new Map<string, Window[]>();
  const courtWindows = new Map<string, Window[]>();
  // matchId → end time, for matches placed this run or pre-existing/finished.
  const matchEndById = new Map<string, Date>();
  const restMs = getPlayerRestMs(config);

  function isOccupantBusy(occupantId: string, start: Date, end: Date): boolean {
    const restStart = new Date(start.getTime() - restMs);
    const restEnd = new Date(end.getTime() + restMs);
    return (occupantWindows.get(occupantId) ?? []).some((w) => datesOverlap(restStart, restEnd, w.start, w.end));
  }

  function markOccupantBusy(occupantId: string, start: Date, end: Date) {
    if (!occupantWindows.has(occupantId)) occupantWindows.set(occupantId, []);
    occupantWindows.get(occupantId)!.push({ start, end });
  }

  function getOccupants(teamId: string | null): string[] {
    if (!teamId) return [];
    return occupantMap[teamId] ?? teamOccupants(teamId, null);
  }

  function occupantsForMatch(matchId: string | undefined, teamA: string | null, teamB: string | null): string[] {
    return (matchId ? matchOccupants.get(matchId) : undefined)
      ?? [...getOccupants(teamA), ...getOccupants(teamB)];
  }

  function isCourtBusy(courtId: string, start: Date, end: Date): boolean {
    const endWithBreak = new Date(end.getTime() + config.break_between * 60_000);
    return (courtWindows.get(courtId) ?? []).some((w) => datesOverlap(start, endWithBreak, w.start, w.end));
  }

  function markCourtBusy(courtId: string, start: Date, end: Date) {
    if (!courtWindows.has(courtId)) courtWindows.set(courtId, []);
    courtWindows.get(courtId)!.push({
      start,
      end: new Date(end.getTime() + config.break_between * 60_000),
    });
  }

  // Pre-occupy from existing assignments (other categories already scheduled,
  // completed/locked matches, etc.).
  for (const ea of existing) {
    const eaStart = new Date(ea.scheduled_at);
    const eaEnd = new Date(eaStart.getTime() + config.match_duration * 60_000);
    markCourtBusy(ea.court_id, eaStart, eaEnd);
    occupantsForMatch(ea.match_id, ea.team_a_id, ea.team_b_id)
      .forEach((id) => markOccupantBusy(id, eaStart, eaEnd));
    // Pre-existing matches can be feeders of pending matches — record their end
    // so the precedence rule sees them as already finished.
    if (ea.match_id) matchEndById.set(ea.match_id, eaEnd);
  }

  const feederGapMs = Math.max(config.break_between * 60_000, restMs);

  function canStartAfterFeeders(matchId: string, start: Date): boolean {
    const fds = feeders.get(matchId);
    if (!fds || fds.length === 0) return true;
    return fds.every((feederId) => {
      const feederEnd = matchEndById.get(feederId);
      // Feeder not placed yet → dependent must wait.
      if (!feederEnd) return false;
      return start.getTime() >= feederEnd.getTime() + feederGapMs;
    });
  }

  return {
    canPlaceCourt: (courtId, start, end) => !isCourtBusy(courtId, start, end),
    canPlaceTeams: (teamA, teamB, start, end, matchId) =>
      occupantsForMatch(matchId, teamA, teamB).every((id) => !isOccupantBusy(id, start, end)),
    canStartAfterFeeders,
    place: (matchId, courtId, teamA, teamB, start, end) => {
      markCourtBusy(courtId, start, end);
      occupantsForMatch(matchId, teamA, teamB).forEach((id) => markOccupantBusy(id, start, end));
      matchEndById.set(matchId, end);
    },
  };
}
