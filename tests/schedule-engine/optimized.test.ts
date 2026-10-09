import { mulberry32 } from "../helpers/random.js";
import { describe, it, expect } from "vitest";
import { generateSchedule, generateScheduleResult, validateAssignments } from "../../src/schedule-engine/index.js";
import type { EngineMatch, EngineCourt, ScheduleConfig } from "../../src/schedule-engine/index.js";

const CONFIG: ScheduleConfig = {
  match_duration: 60,
  break_between: 10,
  days: [{ date: "2026-06-01", start_time: "09:00", end_time: "20:00" }],
};

function court(id: string, sort: number): EngineCourt {
  return { id, sort_order: sort };
}

// ─── Oracle sanity ────────────────────────────────────────────────────────────

describe("validateAssignments — oracle sanity", () => {
  it("accepts a generated valid schedule", () => {
    const matches: EngineMatch[] = [
      { id: "m1", round: 1, position: 1, team_a_id: "a", team_b_id: "b", format: "single_elimination", category_sort_order: 0 },
    ];
    const res = generateScheduleResult(matches, [court("c1", 1)], CONFIG);
    const v = validateAssignments(res.assignments, matches, CONFIG);
    expect(v.valid).toBe(true);
  });

  it("flags a court overlap", () => {
    const matches: EngineMatch[] = [
      { id: "m1", round: 1, position: 1, team_a_id: "a", team_b_id: "b", format: "single_elimination", category_sort_order: 0 },
      { id: "m2", round: 1, position: 2, team_a_id: "c", team_b_id: "d", format: "single_elimination", category_sort_order: 0 },
    ];
    const at = new Date(Date.UTC(2026, 5, 1, 9, 0, 0, 0));
    const bad = [
      { match_id: "m1", court_id: "c1", scheduled_at: at },
      { match_id: "m2", court_id: "c1", scheduled_at: at }, // same court, same time
    ];
    const v = validateAssignments(bad, matches, CONFIG);
    expect(v.valid).toBe(false);
    expect(v.violations.some((s) => s.includes("court overlap"))).toBe(true);
  });

  it("flags a precedence violation", () => {
    const matches: EngineMatch[] = [
      { id: "sa", round: 1, position: 1, team_a_id: "a", team_b_id: "b", format: "single_elimination", category_sort_order: 0, next_match_id: "f" },
      { id: "f", round: 2, position: 1, team_a_id: null, team_b_id: null, format: "single_elimination", category_sort_order: 0 },
    ];
    const at = new Date(Date.UTC(2026, 5, 1, 9, 0, 0, 0));
    const bad = [
      { match_id: "sa", court_id: "c1", scheduled_at: at },
      { match_id: "f", court_id: "c2", scheduled_at: at }, // final at same time as feeder
    ];
    const v = validateAssignments(bad, matches, CONFIG);
    expect(v.valid).toBe(false);
    expect(v.violations.some((s) => s.includes("precedence"))).toBe(true);
  });
});

// ─── Seeded random scenarios ───────────────────────────────────────────────────


function randomScenario(rng: () => number): { matches: EngineMatch[]; courts: EngineCourt[] } {
  const courtCount = 1 + Math.floor(rng() * 3); // 1..3
  const courts = Array.from({ length: courtCount }, (_, i) => court(`c${i + 1}`, i + 1));

  // A small pool of physical players so cross-match rest conflicts actually arise.
  const players = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const matchCount = 3 + Math.floor(rng() * 8); // 3..10
  const formats = ["single_elimination", "round_robin"];

  const matches: EngineMatch[] = [];
  for (let i = 0; i < matchCount; i++) {
    const a = players[Math.floor(rng() * players.length)];
    let b = players[Math.floor(rng() * players.length)];
    if (b === a) b = players[(players.indexOf(a) + 1) % players.length];
    matches.push({
      id: `m${i}`,
      round: 1 + Math.floor(rng() * 3),
      position: i,
      team_a_id: rng() < 0.15 ? null : a, // some byes / TBD
      team_b_id: rng() < 0.15 ? null : b,
      format: formats[Math.floor(rng() * formats.length)],
      category_sort_order: Math.floor(rng() * 2),
    });
  }

  // Wire a few feeder links (dependent has TBD teams).
  for (let i = 0; i < matches.length; i++) {
    if (rng() < 0.3 && i + 2 < matches.length) {
      const dep = matches[i + 2];
      matches[i].next_match_id = dep.id;
      dep.team_a_id = null;
      dep.team_b_id = null;
    }
  }
  return { matches, courts };
}

describe("generateSchedule — greedy vs optimized differential (seeded)", () => {
  it("both strategies always produce valid schedules; optimized never places fewer", () => {
    let optimizedEngaged = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed);
      const { matches, courts } = randomScenario(rng);

      const greedy = generateScheduleResult(matches, courts, CONFIG, [], {}, "greedy");
      const optimized = generateScheduleResult(matches, courts, CONFIG, [], {}, "optimized");

      const gv = validateAssignments(greedy.assignments, matches, CONFIG);
      const ov = validateAssignments(optimized.assignments, matches, CONFIG);

      expect(gv.valid, `greedy seed ${seed}: ${gv.violations.join("; ")}`).toBe(true);
      expect(ov.valid, `optimized seed ${seed}: ${ov.violations.join("; ")}`).toBe(true);

      // Optimized is only adopted when strictly better, so it never regresses count.
      expect(optimized.assignments.length).toBeGreaterThanOrEqual(greedy.assignments.length);

      if (optimized.strategy === "optimized") optimizedEngaged++;
      // When it falls back, it must report so and return greedy's strategy.
      if (optimized.fellBackToGreedy) expect(optimized.strategy).toBe("greedy");
    }
    // Sanity: the optimized path must actually engage on some scenarios
    // (otherwise it would be dead code).
    expect(optimizedEngaged).toBeGreaterThan(0);
  });

  it("is deterministic — identical output across repeated runs", () => {
    const rng = mulberry32(42);
    const { matches, courts } = randomScenario(rng);
    const run1 = generateSchedule(matches, courts, CONFIG, [], {}, "optimized");
    const run2 = generateSchedule(matches, courts, CONFIG, [], {}, "optimized");
    expect(run1.map((a) => `${a.match_id}|${a.court_id}|${a.scheduled_at.toISOString()}`)).toEqual(
      run2.map((a) => `${a.match_id}|${a.court_id}|${a.scheduled_at.toISOString()}`),
    );
  });

  it("default strategy is greedy and unchanged by the new param", () => {
    const rng = mulberry32(7);
    const { matches, courts } = randomScenario(rng);
    const def = generateSchedule(matches, courts, CONFIG);
    const explicit = generateSchedule(matches, courts, CONFIG, [], {}, "greedy");
    expect(def).toEqual(explicit);
  });
});
