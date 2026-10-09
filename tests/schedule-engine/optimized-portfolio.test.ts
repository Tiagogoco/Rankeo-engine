import { mulberry32 } from "../helpers/random.js";
import { describe, it, expect } from "vitest";
import { generateScheduleResult, buildOccupantMap, validateAssignments } from "../../src/schedule-engine/index.js";
import type {
  EngineMatch,
  EngineCourt,
  ScheduleConfig,
  ScheduleAssignment,
  ExistingAssignment,
  RosterPlayer,
} from "../../src/schedule-engine/index.js";

// ─── Deterministic scenario generator ────────────────────────────────────────


// Contended scenario: 2-3 categories, each a 4-team single-elim (semis wired
// to the final via next_match_id) or a 4-team round robin. Teams draw pairs
// from one shared player pool, so the same player often lands in two
// categories with two DIFFERENT partners (two different team_ids) — the
// cross-category identity case the occupant model exists for.
function contendedScenario(rng: () => number) {
  const courtCount = 2 + Math.floor(rng() * 2); // 2..3
  const courts: EngineCourt[] = Array.from({ length: courtCount }, (_, i) => ({ id: `c${i + 1}`, sort_order: i + 1 }));

  const poolSize = 12 + Math.floor(rng() * 6); // 12..17 players
  const pool = Array.from({ length: poolSize }, (_, i) => `p${i}`);

  const catCount = 2 + Math.floor(rng() * 2); // 2..3
  const matches: EngineMatch[] = [];
  const teams: { id: string; players: RosterPlayer[] }[] = [];
  let teamSeq = 0;

  for (let cat = 0; cat < catCount; cat++) {
    const catTeams: string[] = [];
    for (let t = 0; t < 4; t++) {
      const a = pool[Math.floor(rng() * poolSize)];
      let b = pool[Math.floor(rng() * poolSize)];
      if (b === a) b = pool[(pool.indexOf(a) + 1) % poolSize];
      const id = `t${teamSeq++}`;
      teams.push({ id, players: [{ name: a, id: a }, { name: b, id: b }] });
      catTeams.push(id);
    }
    if (rng() < 0.4) {
      let pos = 0;
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++)
          matches.push({ id: `m-c${cat}-rr${pos}`, round: 1, position: pos++, team_a_id: catTeams[i], team_b_id: catTeams[j], format: "round_robin", category_sort_order: cat });
    } else {
      const finalId = `m-c${cat}-f`;
      matches.push({ id: `m-c${cat}-s1`, round: 1, position: 1, team_a_id: catTeams[0], team_b_id: catTeams[1], format: "single_elimination", category_sort_order: cat, next_match_id: finalId });
      matches.push({ id: `m-c${cat}-s2`, round: 1, position: 2, team_a_id: catTeams[2], team_b_id: catTeams[3], format: "single_elimination", category_sort_order: cat, next_match_id: finalId });
      matches.push({ id: finalId, round: 2, position: 1, team_a_id: null, team_b_id: null, format: "single_elimination", category_sort_order: cat });
    }
  }

  const occupantMap = buildOccupantMap(teams);
  const config: ScheduleConfig = {
    match_duration: 60 + 30 * Math.floor(rng() * 2), // 60 or 90
    break_between: 10 + 5 * Math.floor(rng() * 2),   // 10 or 15
    days: [
      { date: "2026-06-01", start_time: "09:00", end_time: "21:00" },
      { date: "2026-06-02", start_time: "09:00", end_time: "21:00" },
    ],
  };
  return { matches, courts, config, occupantMap };
}

// Fixed occupancy from other categories: two locked matches on court c1 with
// players disjoint from the generated pool (x-teams fall back to team_id).
function fixedExisting(): ExistingAssignment[] {
  return [
    { court_id: "c1", scheduled_at: "2026-06-01T09:00:00.000Z", team_a_id: "xt1", team_b_id: "xt2" },
    { court_id: "c1", scheduled_at: "2026-06-01T12:00:00.000Z", team_a_id: "xt3", team_b_id: "xt4" },
  ];
}

function makespanOf(assignments: ScheduleAssignment[], config: ScheduleConfig): number {
  let makespan = 0;
  for (const a of assignments) {
    const end = a.scheduled_at.getTime() + config.match_duration * 60_000;
    if (end > makespan) makespan = end;
  }
  return makespan;
}

// Explicit pairwise check (independent of validateAssignments): any two
// assignments sharing a physical occupant start at least duration + rest
// apart, so they can neither overlap nor shortchange the rest gap.
function expectPlayerRestHolds(
  assignments: ScheduleAssignment[],
  matches: EngineMatch[],
  occupantMap: Record<string, string[]>,
  config: ScheduleConfig,
  label: string,
) {
  const minGapMs = (config.match_duration + (config.player_rest_minutes ?? 90)) * 60_000;
  const byId = new Map(matches.map((m) => [m.id, m]));
  const occsOf = (a: ScheduleAssignment): Set<string> => {
    const m = byId.get(a.match_id)!;
    const ids = new Set<string>();
    for (const teamId of [m.team_a_id, m.team_b_id]) {
      if (!teamId) continue;
      for (const o of occupantMap[teamId] ?? [teamId]) ids.add(o);
    }
    return ids;
  };
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const occA = occsOf(assignments[i]);
      const shared = [...occsOf(assignments[j])].some((o) => occA.has(o));
      if (!shared) continue;
      const gap = Math.abs(assignments[i].scheduled_at.getTime() - assignments[j].scheduled_at.getTime());
      expect(
        gap,
        `${label}: ${assignments[i].match_id} vs ${assignments[j].match_id} share a player — gap ${gap / 60_000} min`,
      ).toBeGreaterThanOrEqual(minGapMs);
    }
  }
}

// ─── (a) Player in two categories with different partners ───────────────────

describe("optimized portfolio — cross-category player identity", () => {
  it("same player with two different partners (two team_ids) keeps full rest under both strategies", () => {
    // p1 plays catA with p2 (team ta) and catB with p9 (team tb) — different team ids.
    const matches: EngineMatch[] = [
      { id: "mA", round: 1, position: 1, team_a_id: "ta", team_b_id: "ta-opp", format: "single_elimination", category_sort_order: 0 },
      { id: "mB", round: 1, position: 1, team_a_id: "tb", team_b_id: "tb-opp", format: "single_elimination", category_sort_order: 1 },
      // Filler matches so the optimizer has real choices to reorder.
      { id: "mC", round: 1, position: 2, team_a_id: "tc", team_b_id: "tc-opp", format: "single_elimination", category_sort_order: 0 },
      { id: "mD", round: 1, position: 2, team_a_id: "td", team_b_id: "td-opp", format: "single_elimination", category_sort_order: 1 },
    ];
    const occupantMap = buildOccupantMap([
      { id: "ta", players: [{ name: "P1", id: "p1" }, { name: "P2", id: "p2" }] },
      { id: "ta-opp", players: [{ name: "P3", id: "p3" }, { name: "P4", id: "p4" }] },
      { id: "tb", players: [{ name: "P1", id: "p1" }, { name: "P9", id: "p9" }] }, // p1 again, new partner
      { id: "tb-opp", players: [{ name: "P5", id: "p5" }, { name: "P6", id: "p6" }] },
      { id: "tc", players: [{ name: "P7", id: "p7" }, { name: "P8", id: "p8" }] },
      { id: "tc-opp", players: [{ name: "P10", id: "p10" }, { name: "P11", id: "p11" }] },
      { id: "td", players: [{ name: "P12", id: "p12" }, { name: "P13", id: "p13" }] },
      { id: "td-opp", players: [{ name: "P14", id: "p14" }, { name: "P15", id: "p15" }] },
    ]);
    // 4 courts: the court is never the binding constraint — only the rest rule
    // can separate mA and mB.
    const courts: EngineCourt[] = Array.from({ length: 4 }, (_, i) => ({ id: `c${i + 1}`, sort_order: i + 1 }));
    const config: ScheduleConfig = {
      match_duration: 60,
      break_between: 10,
      days: [{ date: "2026-06-01", start_time: "09:00", end_time: "21:00" }],
    };

    for (const strategy of ["greedy", "optimized"] as const) {
      const res = generateScheduleResult(matches, courts, config, [], occupantMap, strategy);
      expect(res.assignments).toHaveLength(4);
      expectPlayerRestHolds(res.assignments, matches, occupantMap, config, strategy);
      // mA and mB share p1 → start-to-start ≥ 60 + 90 = 150 min.
      const byId = Object.fromEntries(res.assignments.map((a) => [a.match_id, a]));
      const gapMin = Math.abs(byId.mA.scheduled_at.getTime() - byId.mB.scheduled_at.getTime()) / 60_000;
      expect(gapMin, strategy).toBeGreaterThanOrEqual(150);
      // The unrelated fillers do run in parallel (rest rule is per-player, not global).
      expect(byId.mC.scheduled_at.getTime(), strategy).toBe(byId.mA.scheduled_at.getTime());
    }
  });

  it("holds pairwise across 300 seeded scenarios for both strategies", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { matches, courts, config, occupantMap } = contendedScenario(mulberry32(seed));
      for (const strategy of ["greedy", "optimized"] as const) {
        const res = generateScheduleResult(matches, courts, config, [], occupantMap, strategy);
        expectPlayerRestHolds(res.assignments, matches, occupantMap, config, `seed ${seed} ${strategy}`);
      }
    }
  }, 30_000);
});

// ─── (b) Portfolio strictly beats greedy on contended scenarios ──────────────

describe("optimized portfolio — compaction vs greedy", () => {
  it("[demo] finishes earlier by scheduling the shared-player bottleneck first", () => {
    const matches: EngineMatch[] = [
      { id: "m1", round: 1, position: 1, team_a_id: "a", team_b_id: "b", format: "round_robin", category_sort_order: 0 },
      { id: "m2", round: 1, position: 2, team_a_id: "d", team_b_id: "e", format: "round_robin", category_sort_order: 0 },
      { id: "m3", round: 1, position: 3, team_a_id: "b", team_b_id: "c", format: "round_robin", category_sort_order: 0 },
      { id: "m4", round: 1, position: 4, team_a_id: "c", team_b_id: "d", format: "round_robin", category_sort_order: 0 },
    ];
    const courts = [{ id: "c1", sort_order: 1 }, { id: "c2", sort_order: 2 }];
    const config: ScheduleConfig = {
      match_duration: 60, break_between: 10, player_rest_minutes: 90,
      days: [{ date: "2026-06-01", start_time: "09:00", end_time: "20:00" }],
    };
    const greedy = generateScheduleResult(matches, courts, config, [], {}, "greedy");
    const optimized = generateScheduleResult(matches, courts, config, [], {}, "optimized");
    expect(optimized.assignments).toHaveLength(4);
    expect(optimized.strategy).toBe("optimized");
    expect(makespanOf(greedy.assignments, config)).toBe(Date.parse("2026-06-01T15:00:00Z"));
    expect(makespanOf(optimized.assignments, config)).toBe(Date.parse("2026-06-01T12:30:00Z"));
    expect(validateAssignments(optimized.assignments, matches, config).valid).toBe(true);
    expect(generateScheduleResult(matches, courts, config, [], {}, "optimized")).toEqual(optimized);
  });

  it("places MORE matches than greedy on a capacity-starved seed", () => {
    const { matches, courts, config, occupantMap } = contendedScenario(mulberry32(79));
    const greedy = generateScheduleResult(matches, courts, config, [], occupantMap, "greedy");
    const opt = generateScheduleResult(matches, courts, config, [], occupantMap, "optimized");
    expect(opt.strategy).toBe("optimized");
    expect(opt.assignments.length).toBeGreaterThan(greedy.assignments.length);
  });

  it("never regresses vs greedy and wins a meaningful share over 300 seeds", () => {
    let wins = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { matches, courts, config, occupantMap } = contendedScenario(mulberry32(seed));
      const greedy = generateScheduleResult(matches, courts, config, [], occupantMap, "greedy");
      const opt = generateScheduleResult(matches, courts, config, [], occupantMap, "optimized");

      // Lexicographic non-regression, guaranteed by the strict-better gate.
      expect(opt.assignments.length, `seed ${seed}`).toBeGreaterThanOrEqual(greedy.assignments.length);
      if (opt.assignments.length === greedy.assignments.length) {
        expect(makespanOf(opt.assignments, config), `seed ${seed}`).toBeLessThanOrEqual(makespanOf(greedy.assignments, config));
      }
      if (opt.strategy === "optimized") wins++;
    }
    expect(wins).toBeGreaterThan(0);
  }, 30_000);

  it("is deterministic — identical portfolio output across repeated runs", () => {
    const { matches, courts, config, occupantMap } = contendedScenario(mulberry32(8));
    const key = (r: { assignments: ScheduleAssignment[] }) =>
      r.assignments.map((a) => `${a.match_id}|${a.court_id}|${a.scheduled_at.toISOString()}`);
    const run1 = generateScheduleResult(matches, courts, config, [], occupantMap, "optimized");
    const run2 = generateScheduleResult(matches, courts, config, [], occupantMap, "optimized");
    expect(key(run1)).toEqual(key(run2));
  });
});

// ─── (c) Oracle: zero violations on 300 seeded cases with existing occupancy ─

describe("optimized portfolio — oracle differential with existing occupancy", () => {
  it("both strategies pass validateAssignments on 300 seeded scenarios", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { matches, courts, config, occupantMap } = contendedScenario(mulberry32(seed));
      const existing = seed % 2 === 0 ? fixedExisting() : [];
      for (const strategy of ["greedy", "optimized"] as const) {
        const res = generateScheduleResult(matches, courts, config, existing, occupantMap, strategy);
        const v = validateAssignments(res.assignments, matches, config, existing, occupantMap);
        expect(v.valid, `seed ${seed} ${strategy}: ${v.violations.join("; ")}`).toBe(true);
      }
    }
  }, 30_000);

  it("an existing finished feeder still gates the pending final under the portfolio", () => {
    const existing: ExistingAssignment[] = [
      {
        court_id: "c1",
        scheduled_at: "2026-06-01T09:00:00.000Z",
        team_a_id: "w1",
        team_b_id: "l1",
        match_id: "sa",
        next_match_id: "final",
      },
    ];
    const semiB: EngineMatch = { id: "sb", round: 1, position: 2, team_a_id: "w2", team_b_id: "l2", format: "single_elimination", category_sort_order: 0, next_match_id: "final" };
    const final: EngineMatch = { id: "final", round: 2, position: 1, team_a_id: null, team_b_id: null, format: "single_elimination", category_sort_order: 0 };
    const courts: EngineCourt[] = [{ id: "c1", sort_order: 1 }, { id: "c2", sort_order: 2 }];
    const config: ScheduleConfig = {
      match_duration: 60,
      break_between: 10,
      days: [{ date: "2026-06-01", start_time: "09:00", end_time: "21:00" }],
    };

    const res = generateScheduleResult([final, semiB], courts, config, existing, {}, "optimized");
    const byId = Object.fromEntries(res.assignments.map((a) => [a.match_id, a]));
    const feederEnd = Math.max(
      new Date("2026-06-01T09:00:00.000Z").getTime(),
      byId.sb.scheduled_at.getTime(),
    ) + config.match_duration * 60_000;
    expect(byId.final.scheduled_at.getTime()).toBeGreaterThanOrEqual(feederEnd + config.break_between * 60_000);

    const v = validateAssignments(res.assignments, [final, semiB], config, existing, {});
    expect(v.valid, v.violations.join("; ")).toBe(true);
  });
});
