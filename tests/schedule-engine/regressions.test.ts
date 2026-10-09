import { describe, expect, it } from "vitest";
import { generateSchedule, validateAssignments } from "../../src/schedule-engine/index.js";
import type { EngineMatch, ScheduleConfig, ScheduleStrategy } from "../../src/schedule-engine/index.js";

const config: ScheduleConfig = {
  match_duration: 60, break_between: 10, player_rest_minutes: 90,
  days: [{ date: "2026-06-01", start_time: "09:00", end_time: "20:00" }],
};
const courts = [{ id: "c1", sort_order: 1 }, { id: "c2", sort_order: 2 }];
function match(id: string, extra: Partial<EngineMatch> = {}): EngineMatch {
  return { id, round: 1, position: 1, format: "single_elimination", category_sort_order: 0, team_a_id: `${id}-a`, team_b_id: `${id}-b`, ...extra };
}
const bracket = [
  match("semi-a", { next_match_id: "final" }),
  match("semi-b", { next_match_id: "final" }),
  match("final", { round: 2, team_a_id: null, team_b_id: null }),
];
const date = (time: string) => new Date(`2026-06-01T${time}:00Z`);

describe.each<ScheduleStrategy>(["greedy", "optimized"])("schedule regressions: %s", (strategy) => {
  it("[demo] reserves full player rest before a final with unknown teams", () => {
    const assignments = generateSchedule(bracket, courts, config, [], {}, strategy);
    expect(assignments).toHaveLength(3);
    const byId = new Map(assignments.map((assignment) => [assignment.match_id, assignment.scheduled_at.getTime()]));
    const latestSemi = Math.max(byId.get("semi-a")!, byId.get("semi-b")!);
    expect(byId.get("final")! - latestSemi).toBeGreaterThanOrEqual(150 * 60_000);
    expect(validateAssignments(assignments, bracket, config).valid).toBe(true);
  });

  it("reserves potential finalists against matches in other categories", () => {
    const matches = [...bracket, match("other", { format: "round_robin", team_a_id: "other-team" })];
    const occupants = { "semi-a-a": ["shared-player"], "other-team": ["shared-player"] };
    const assignments = generateSchedule(matches, courts, config, [], occupants, strategy);
    expect(assignments).toHaveLength(4);
    const byId = new Map(assignments.map((assignment) => [assignment.match_id, assignment.scheduled_at.getTime()]));
    expect(Math.abs(byId.get("final")! - byId.get("other")!)).toBeGreaterThanOrEqual(150 * 60_000);
    expect(validateAssignments(assignments, matches, config, [], occupants).valid).toBe(true);
  });

  it("schedules feeders before dependents even when their category priority differs", () => {
    const matches = [match("feeder", { category_sort_order: 5, next_match_id: "dependent" }), match("dependent", { format: "round_robin", team_a_id: null, team_b_id: null })];
    expect(generateSchedule(matches, courts, config, [], {}, strategy)).toHaveLength(2);
  });

  it("does not schedule a dependent whose feeder cannot fit", () => {
    const shortDay = { ...config, days: [{ ...config.days[0], end_time: "09:00" }] };
    const assignments = generateSchedule(bracket, courts.slice(0, 1), shortDay, [], {}, strategy);
    expect(assignments).toHaveLength(1);
    expect(assignments.some((assignment) => assignment.match_id === "final")).toBe(false);
  });

  it("orders days chronologically without mutating configuration", () => {
    const reversed = { ...config, days: [{ ...config.days[0], date: "2026-06-02" }, config.days[0]] };
    const before = structuredClone(reversed);
    const assignments = generateSchedule([match("one")], courts, reversed, [], {}, strategy);
    expect(assignments[0].scheduled_at).toEqual(date("09:00"));
    expect(reversed).toEqual(before);
  });
});

describe("schedule validation regressions", () => {
  it("rejects finals without their feeders", () => {
    const result = validateAssignments([{ match_id: "final", court_id: "c1", scheduled_at: date("12:00") }], bracket, config);
    expect(result.valid).toBe(false);
    expect(result.violations.some((violation) => violation.includes("missing feeder"))).toBe(true);
  });

  it("rejects the former 10-minute rest before a final", () => {
    const assignments = bracket.map((entry, index) => ({ match_id: entry.id, court_id: index === 1 ? "c2" : "c1", scheduled_at: date(index === 2 ? "10:10" : "09:00") }));
    expect(validateAssignments(assignments, bracket, config).valid).toBe(false);
  });

  it("rejects duplicate assignments, unknown matches and invalid timestamps", () => {
    const assignment = { match_id: "semi-a", court_id: "c1", scheduled_at: date("09:00") };
    expect(validateAssignments([assignment, { ...assignment, court_id: "c2" }], bracket, config).valid).toBe(false);
    expect(validateAssignments([{ ...assignment, match_id: "unknown" }], bracket, config).valid).toBe(false);
    expect(validateAssignments([{ ...assignment, scheduled_at: new Date(NaN) }], bracket, config).valid).toBe(false);
  });

  it.each([-1, NaN, Infinity, 0])("rejects invalid duration %s", (duration) => {
    expect(() => generateSchedule(bracket, courts, { ...config, match_duration: duration })).toThrow("match_duration");
  });

  it("rejects dependency cycles", () => {
    const matches = [match("a", { next_match_id: "b" }), match("b", { next_match_id: "a" })];
    expect(() => generateSchedule(matches, courts, config)).toThrow("cycles");
  });
});
