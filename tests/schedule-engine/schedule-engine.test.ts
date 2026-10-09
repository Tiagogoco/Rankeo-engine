import { describe, it, expect } from "vitest";
import { generateSchedule, buildDateRange, getSchedulableScheduleConfig, getScheduleGridStep, getScheduleGridStepFromTotal, validateAssignments } from "../../src/schedule-engine/index.js";
import type { EngineMatch, EngineCourt, ScheduleConfig } from "../../src/schedule-engine/index.js";

function makeMatch(id: string, opts: Partial<EngineMatch> = {}): EngineMatch {
  return {
    id,
    round: 1,
    position: 1,
    team_a_id: `ta-${id}`,
    team_b_id: `tb-${id}`,
    format: "single_elimination",
    category_sort_order: 0,
    ...opts,
  };
}

function makeCourt(id: string, sort_order = 1): EngineCourt {
  return { id, sort_order };
}

function localMinutes(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

const ONE_DAY: ScheduleConfig = {
  match_duration: 60,
  break_between: 10,
  days: [{ date: "2026-06-01", start_time: "09:00", end_time: "18:00" }],
};

// ─── Empty inputs ─────────────────────────────────────────────────────────────

describe("generateSchedule — empty inputs", () => {
  it("returns empty for no matches", () => {
    expect(generateSchedule([], [makeCourt("c1")], ONE_DAY)).toHaveLength(0);
  });

  it("returns empty for no courts", () => {
    expect(generateSchedule([makeMatch("m1")], [], ONE_DAY)).toHaveLength(0);
  });

  it("returns empty for no days", () => {
    const cfg = { ...ONE_DAY, days: [] };
    expect(generateSchedule([makeMatch("m1")], [makeCourt("c1")], cfg)).toHaveLength(0);
  });
});

// ─── Basic assignment ─────────────────────────────────────────────────────────

describe("generateSchedule — basic assignment", () => {
  it("assigns a single match to the only court at start time", () => {
    const [r] = generateSchedule([makeMatch("m1")], [makeCourt("c1")], ONE_DAY);
    expect(r.match_id).toBe("m1");
    expect(r.court_id).toBe("c1");
    expect(r.scheduled_at.getUTCHours()).toBe(9);
    expect(r.scheduled_at.getUTCMinutes()).toBe(0);
  });

  it("returns one assignment per match (no duplicates)", () => {
    const matches = Array.from({ length: 4 }, (_, i) =>
      makeMatch(`m${i + 1}`, { team_a_id: `ta${i}`, team_b_id: `tb${i}` })
    );
    const results = generateSchedule(matches, [makeCourt("c1"), makeCourt("c2", 2)], ONE_DAY);
    const ids = results.map((r) => r.match_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(results).toHaveLength(4);
  });

  it("bye match (null team IDs) gets assigned without rest constraint", () => {
    const bye = makeMatch("bye1", { team_a_id: null, team_b_id: null });
    const results = generateSchedule([bye], [makeCourt("c1")], ONE_DAY);
    expect(results).toHaveLength(1);
    expect(results[0].match_id).toBe("bye1");
  });
});

// ─── Sequential scheduling ────────────────────────────────────────────────────

describe("generateSchedule — sequential court filling", () => {
  it("[demo] 2 matches on 1 court are separated by duration + break", () => {
    const m1 = makeMatch("m1", { team_a_id: "a1", team_b_id: "b1" });
    const m2 = makeMatch("m2", { team_a_id: "a2", team_b_id: "b2" });
    const [r1, r2] = generateSchedule([m1, m2], [makeCourt("c1")], ONE_DAY);

    // 09:00 + 60min match + 10min break = 10:10
    expect(r1.scheduled_at.getUTCHours()).toBe(9);
    expect(r1.scheduled_at.getUTCMinutes()).toBe(0);
    expect(r2.scheduled_at.getUTCHours()).toBe(10);
    expect(r2.scheduled_at.getUTCMinutes()).toBe(10);
  });

  it("2 matches on 2 courts start at the same time (parallel)", () => {
    const m1 = makeMatch("m1", { team_a_id: "a1", team_b_id: "b1" });
    const m2 = makeMatch("m2", { team_a_id: "a2", team_b_id: "b2" });
    const courts = [makeCourt("c1", 1), makeCourt("c2", 2)];
    const results = generateSchedule([m1, m2], courts, ONE_DAY);

    expect(results).toHaveLength(2);
    expect(results[0].scheduled_at.getUTCHours()).toBe(9);
    expect(results[1].scheduled_at.getUTCHours()).toBe(9);
    expect(results[0].court_id).not.toBe(results[1].court_id);
  });

  it("court sort_order determines assignment priority", () => {
    // c2 has lower sort_order, should be preferred first
    const courts = [makeCourt("c2", 2), makeCourt("c1", 1)];
    const [r] = generateSchedule([makeMatch("m1")], courts, ONE_DAY);
    expect(r.court_id).toBe("c1"); // sort_order 1 wins
  });
});

describe("schedule grid step", () => {
  it("keeps the existing 30-minute board for 90+0", () => {
    expect(getScheduleGridStep(90, 0)).toBe(30);
  });

  it("uses 15-minute marks for 90+15", () => {
    expect(getScheduleGridStep(90, 15)).toBe(15);
  });

  it("uses 10-minute marks for 90+10", () => {
    expect(getScheduleGridStep(90, 10)).toBe(10);
  });

  it("derives the same step from total slot duration", () => {
    expect(getScheduleGridStepFromTotal(105)).toBe(15);
    expect(getScheduleGridStepFromTotal(100)).toBe(10);
  });
});

// ─── Day boundary ─────────────────────────────────────────────────────────────

describe("generateSchedule — day end time", () => {
  it("match is not assigned when start_time > end_time (unusable day)", () => {
    const cfg: ScheduleConfig = {
      match_duration: 60,
      break_between: 10,
      // end_time before start_time → unusable day
      days: [{ date: "2026-06-01", start_time: "10:00", end_time: "09:00" }],
    };
    expect(generateSchedule([makeMatch("m1")], [makeCourt("c1")], cfg)).toHaveLength(0);
  });

  it("allows a match to start at end_time", () => {
    const cfg: ScheduleConfig = {
      match_duration: 90,
      break_between: 0,
      days: [{ date: "2026-06-01", start_time: "09:30", end_time: "09:30" }],
    };
    const results = generateSchedule([makeMatch("m1")], [makeCourt("c1")], cfg);
    expect(results).toHaveLength(1);
    expect(localMinutes(results[0].scheduled_at)).toBe(9 * 60 + 30);
  });

  it("uses late starts up to the configured end_time", () => {
    const cfg: ScheduleConfig = {
      match_duration: 90,
      break_between: 15,
      days: [{ date: "2026-06-01", start_time: "16:00", end_time: "22:00" }],
    };
    const matches = Array.from({ length: 4 }, (_, i) =>
      makeMatch(`m${i + 1}`, { team_a_id: `a${i}`, team_b_id: `b${i}` })
    );

    const results = generateSchedule(matches, [makeCourt("c1")], cfg);
    expect(results).toHaveLength(4);
    expect(results.map((r) => localMinutes(r.scheduled_at))).toEqual([
      16 * 60,
      17 * 60 + 45,
      19 * 60 + 30,
      21 * 60 + 15,
    ]);
  });

  it("overflow across days: match spills into day 2 when day 1 is unusable", () => {
    const cfg: ScheduleConfig = {
      match_duration: 60,
      break_between: 10,
      days: [
        { date: "2026-06-01", start_time: "18:00", end_time: "09:00" }, // unusable (start > end)
        { date: "2026-06-02", start_time: "09:00", end_time: "18:00" },
      ],
    };
    const results = generateSchedule([makeMatch("m1")], [makeCourt("c1")], cfg);
    expect(results).toHaveLength(1);
    expect(results[0].scheduled_at.getUTCDate()).toBe(2);
  });
});

// ─── 90-min REST constraint ───────────────────────────────────────────────────

describe("generateSchedule — 90-min REST between matches for same team", () => {
  it("shared team plays 2 matches at least 90 min apart", () => {
    const m1 = makeMatch("m1", { team_a_id: "shared", team_b_id: "opp1" });
    const m2 = makeMatch("m2", { team_a_id: "shared", team_b_id: "opp2" });
    const courts = [makeCourt("c1", 1), makeCourt("c2", 2)];
    const results = generateSchedule([m1, m2], courts, ONE_DAY);

    expect(results).toHaveLength(2);
    const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
    const diffMin = (times[1] - times[0]) / 60_000;
    expect(diffMin).toBeGreaterThanOrEqual(90);
  });

  it("two independent matches (no shared teams) can overlap in time", () => {
    // Different teams → can play at the same time on different courts
    const m1 = makeMatch("m1", { team_a_id: "a1", team_b_id: "b1" });
    const m2 = makeMatch("m2", { team_a_id: "a2", team_b_id: "b2" });
    const courts = [makeCourt("c1", 1), makeCourt("c2", 2)];
    const results = generateSchedule([m1, m2], courts, ONE_DAY);

    expect(results).toHaveLength(2);
    // Both should start at the same time
    expect(results[0].scheduled_at.getTime()).toBe(results[1].scheduled_at.getTime());
  });
});

// ─── Configurable player rest ───────────────────────────────────────────────

describe("generateSchedule — configurable player_rest_minutes", () => {
  // Two courts so the court is never the binding constraint: the only thing
  // separating two matches that share a player is the rest rule.
  const TWO_COURTS = [makeCourt("c1", 1), makeCourt("c2", 2)];

  function laterStartForRest(restMinutes: number | undefined): number {
    const cfg: ScheduleConfig = {
      match_duration: 60,
      break_between: 10,
      ...(restMinutes !== undefined ? { player_rest_minutes: restMinutes } : {}),
      days: [{ date: "2026-06-01", start_time: "09:00", end_time: "20:00" }],
    };
    const m1 = makeMatch("m1", { team_a_id: "shared", team_b_id: "opp1" });
    const m2 = makeMatch("m2", { team_a_id: "shared", team_b_id: "opp2" });
    const results = generateSchedule([m1, m2], TWO_COURTS, cfg);
    expect(results).toHaveLength(2);
    const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
    // gap (end-to-start) between the two matches for the shared player
    return (times[1] - times[0]) / 60_000 - 60; // subtract match_duration → rest gap
  }

  it("1. without player_rest_minutes the engine keeps 90 min", () => {
    expect(laterStartForRest(undefined)).toBeGreaterThanOrEqual(90);
    // and not absurdly larger — exactly the 90 floor
    expect(laterStartForRest(undefined)).toBe(90);
  });

  it("2. player_rest_minutes: 60 compacts more than 90", () => {
    expect(laterStartForRest(60)).toBe(60);
    expect(laterStartForRest(60)).toBeLessThan(laterStartForRest(undefined));
  });

  it("3. player_rest_minutes: 30 compacts even more", () => {
    expect(laterStartForRest(30)).toBe(30);
    expect(laterStartForRest(30)).toBeLessThan(laterStartForRest(60));
  });

  it("4. still flags a conflict when a shared player is below the configured rest", () => {
    const cfg: ScheduleConfig = {
      match_duration: 60,
      break_between: 10,
      player_rest_minutes: 60,
      days: [{ date: "2026-06-01", start_time: "09:00", end_time: "20:00" }],
    };
    const matches: EngineMatch[] = [
      makeMatch("m1", { team_a_id: "shared", team_b_id: "opp1" }),
      makeMatch("m2", { team_a_id: "shared", team_b_id: "opp2" }),
    ];
    const base = new Date(Date.UTC(2026, 5, 1, 9, 0, 0, 0));
    // Gap of 40 min (end 10:00 → start 10:40) is below the 60-min rest → invalid.
    const tooClose = [
      { match_id: "m1", court_id: "c1", scheduled_at: base },
      { match_id: "m2", court_id: "c2", scheduled_at: new Date(Date.UTC(2026, 5, 1, 10, 40, 0, 0)) },
    ];
    expect(validateAssignments(tooClose, matches, cfg).valid).toBe(false);
    // Gap of exactly 60 min (start 11:00) is allowed.
    const ok = [
      { match_id: "m1", court_id: "c1", scheduled_at: base },
      { match_id: "m2", court_id: "c2", scheduled_at: new Date(Date.UTC(2026, 5, 1, 11, 0, 0, 0)) },
    ];
    expect(validateAssignments(ok, matches, cfg).valid).toBe(true);
  });

  it("5. break_between drives court spacing, not player rest", () => {
    // Two matches with NO shared players on a single court: their spacing is the
    // court turnaround (duration + break), independent of player_rest_minutes.
    function courtGapFor(breakBetween: number, rest: number): number {
      const cfg: ScheduleConfig = {
        match_duration: 60,
        break_between: breakBetween,
        player_rest_minutes: rest,
        days: [{ date: "2026-06-01", start_time: "09:00", end_time: "20:00" }],
      };
      const m1 = makeMatch("m1", { team_a_id: "a1", team_b_id: "b1" });
      const m2 = makeMatch("m2", { team_a_id: "a2", team_b_id: "b2" });
      const results = generateSchedule([m1, m2], [makeCourt("c1", 1)], cfg);
      const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
      return (times[1] - times[0]) / 60_000;
    }
    // Bigger break → bigger court gap, regardless of (tiny) player rest.
    expect(courtGapFor(10, 15)).toBe(70);  // 60 + 10
    expect(courtGapFor(40, 15)).toBe(100); // 60 + 40
    // Changing player rest with a fixed break does NOT change the court gap.
    expect(courtGapFor(10, 90)).toBe(courtGapFor(10, 15));
  });
});

// ─── Format priority ──────────────────────────────────────────────────────────

describe("generateSchedule — FORMAT_PRIORITY", () => {
  it("round_robin match is scheduled before single_elimination", () => {
    const se = makeMatch("se1", {
      format: "single_elimination",
      category_sort_order: 0,
      team_a_id: "a1",
      team_b_id: "b1",
    });
    const rr = makeMatch("rr1", {
      format: "round_robin",
      category_sort_order: 1, // higher category order, lower FORMAT priority
      team_a_id: "a2",
      team_b_id: "b2",
    });
    const results = generateSchedule([se, rr], [makeCourt("c1")], ONE_DAY);

    const rrTime = results.find((r) => r.match_id === "rr1")!.scheduled_at.getTime();
    const seTime = results.find((r) => r.match_id === "se1")!.scheduled_at.getTime();
    expect(rrTime).toBeLessThan(seTime);
  });

  it("group_stage_playoffs has same priority as round_robin", () => {
    const gs = makeMatch("gs1", {
      format: "group_stage_playoffs",
      category_sort_order: 0,
      team_a_id: "a1",
      team_b_id: "b1",
    });
    const rr = makeMatch("rr1", {
      format: "round_robin",
      category_sort_order: 0,
      team_a_id: "a2",
      team_b_id: "b2",
    });
    const results = generateSchedule([gs, rr], [makeCourt("c1")], ONE_DAY);
    // Both have priority 0, so category_sort_order and round/position determine order
    // Since category_sort_order = 0 for both, it falls to round then position
    // gs1 and rr1 both have round=1, position=1 → first in input wins
    expect(results).toHaveLength(2);
  });
});

// ─── Existing assignments ─────────────────────────────────────────────────────

describe("generateSchedule — existing assignments pre-occupy slots", () => {
  it("new match on occupied court is pushed to next available slot", () => {
    const occupiedAt = new Date(Date.UTC(2026, 5, 1, 9, 0, 0, 0));
    const existing = [
      {
        court_id: "c1",
        scheduled_at: occupiedAt.toISOString(),
        team_a_id: "x1",
        team_b_id: "x2",
      },
    ];
    const results = generateSchedule([makeMatch("m1")], [makeCourt("c1")], ONE_DAY, existing);

    expect(results).toHaveLength(1);
    const assignedMin = localMinutes(results[0].scheduled_at);
    // Existing occupies 09:00–10:00, next free = 10:10 (60+10)
    expect(assignedMin).toBeGreaterThan(9 * 60); // after 09:00
  });

  it("existing team windows enforce REST for new matches", () => {
    const occupiedAt = new Date(Date.UTC(2026, 5, 1, 9, 0, 0, 0));
    const existing = [
      {
        court_id: "c1",
        scheduled_at: occupiedAt.toISOString(),
        team_a_id: "shared",
        team_b_id: "opp",
      },
    ];
    // "shared" team plays again — needs 90-min gap from 09:00
    const m2 = makeMatch("m2", { team_a_id: "shared", team_b_id: "other" });
    const courts = [makeCourt("c1", 1), makeCourt("c2", 2)];
    const results = generateSchedule([m2], courts, ONE_DAY, existing);

    expect(results).toHaveLength(1);
    const assignedMin = localMinutes(results[0].scheduled_at);
    // 09:00 + 90 = 10:30
    expect(assignedMin).toBeGreaterThanOrEqual(10 * 60 + 30);
  });

  it("fills open slots before later existing assignments on the same court", () => {
    const occupiedAt = new Date(Date.UTC(2026, 5, 1, 12, 0, 0, 0));
    const existing = [
      {
        court_id: "c1",
        scheduled_at: occupiedAt.toISOString(),
        team_a_id: "x1",
        team_b_id: "x2",
      },
    ];

    const results = generateSchedule([makeMatch("m1")], [makeCourt("c1")], ONE_DAY, existing);
    expect(results).toHaveLength(1);
    expect(localMinutes(results[0].scheduled_at)).toBe(9 * 60);
  });
});

// ─── Round precedence (next_match_id) ─────────────────────────────────────────

describe("generateSchedule — round precedence (hard rule)", () => {
  // Two-court day so spare capacity exists: without precedence the TBD final
  // could grab an early parallel slot.
  const TWO_COURTS = [makeCourt("c1", 1), makeCourt("c2", 2)];

  it("dependent (TBD teams) never starts before its feeders end, even with spare courts", () => {
    const semiA = makeMatch("sa", { round: 1, position: 1, next_match_id: "final" });
    const semiB = makeMatch("sb", { round: 1, position: 2, next_match_id: "final" });
    // Final has no teams yet (winners are TBD) → no rest/team conflict to stop it.
    const final = makeMatch("final", { round: 2, position: 1, team_a_id: null, team_b_id: null });

    const results = generateSchedule([final, semiA, semiB], TWO_COURTS, ONE_DAY);
    expect(results).toHaveLength(3);

    const byId = Object.fromEntries(results.map((r) => [r.match_id, r]));
    const semiEnd = Math.max(
      byId.sa.scheduled_at.getTime(),
      byId.sb.scheduled_at.getTime(),
    ) + ONE_DAY.match_duration * 60_000;

    // At least the feeder end + the break_between breather.
    expect(byId.final.scheduled_at.getTime()).toBeGreaterThanOrEqual(
      semiEnd + ONE_DAY.break_between * 60_000,
    );
  });

  it("a feeder already finished (existing) constrains the pending dependent", () => {
    // Semifinal completed at 09:00–10:00 on c1; only the final is pending.
    const feederStart = new Date(Date.UTC(2026, 5, 1, 9, 0, 0, 0));
    const existing = [
      {
        court_id: "c1",
        scheduled_at: feederStart.toISOString(),
        team_a_id: "w1",
        team_b_id: "l1",
        match_id: "sa",
        next_match_id: "final",
      },
    ];
    // Other feeder is still pending.
    const semiB = makeMatch("sb", { round: 1, position: 2, next_match_id: "final" });
    const final = makeMatch("final", { round: 2, position: 1, team_a_id: null, team_b_id: null });

    const results = generateSchedule([final, semiB], TWO_COURTS, ONE_DAY, existing);
    const byId = Object.fromEntries(results.map((r) => [r.match_id, r]));

    const semiEnd = Math.max(
      feederStart.getTime(),
      byId.sb.scheduled_at.getTime(),
    ) + ONE_DAY.match_duration * 60_000;
    expect(byId.final.scheduled_at.getTime()).toBeGreaterThanOrEqual(
      semiEnd + ONE_DAY.break_between * 60_000,
    );
  });

  it("matches without feeders (round_robin) are unaffected — fill earliest slots", () => {
    const m1 = makeMatch("m1", { format: "round_robin", team_a_id: "a", team_b_id: "b" });
    const m2 = makeMatch("m2", { format: "round_robin", team_a_id: "c", team_b_id: "d" });
    const results = generateSchedule([m1, m2], TWO_COURTS, ONE_DAY);
    expect(results).toHaveLength(2);
    // Both at 09:00 in parallel — no precedence delay.
    for (const r of results) expect(localMinutes(r.scheduled_at)).toBe(9 * 60);
  });
});

// ─── getSchedulableScheduleConfig ─────────────────────────────────────────────

describe("getSchedulableScheduleConfig", () => {
  it("drops past days and keeps future days", () => {
    const cfg: ScheduleConfig = {
      match_duration: 90,
      break_between: 15,
      days: [
        { date: "2026-06-23", start_time: "16:00", end_time: "22:00" },
        { date: "2026-06-25", start_time: "16:00", end_time: "22:00" },
      ],
    };

    const result = getSchedulableScheduleConfig(cfg, new Date(Date.UTC(2026, 5, 24, 12, 0)));
    expect(result.days).toEqual([{ date: "2026-06-25", start_time: "16:00", end_time: "22:00" }]);
  });

  it("moves today's start time forward to the next schedule grid mark", () => {
    const cfg: ScheduleConfig = {
      match_duration: 90,
      break_between: 15,
      days: [{ date: "2026-06-24", start_time: "16:00", end_time: "22:00" }],
    };

    const result = getSchedulableScheduleConfig(cfg, new Date(Date.UTC(2026, 5, 24, 18, 7)));
    expect(result.days).toEqual([{ date: "2026-06-24", start_time: "18:15", end_time: "22:00" }]);
  });

  it("removes today when the configured end time already passed", () => {
    const cfg: ScheduleConfig = {
      match_duration: 90,
      break_between: 15,
      days: [{ date: "2026-06-24", start_time: "16:00", end_time: "22:00" }],
    };

    const result = getSchedulableScheduleConfig(cfg, new Date(Date.UTC(2026, 5, 24, 22, 1)));
    expect(result.days).toHaveLength(0);
  });
});

// ─── buildDateRange ───────────────────────────────────────────────────────────

describe("buildDateRange", () => {
  it("single day returns array with that one date", () => {
    expect(buildDateRange("2026-06-01", "2026-06-01")).toEqual(["2026-06-01"]);
  });

  it("consecutive days", () => {
    expect(buildDateRange("2026-06-01", "2026-06-03")).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("crosses month boundary", () => {
    expect(buildDateRange("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("inverted range returns empty array", () => {
    expect(buildDateRange("2026-06-03", "2026-06-01")).toHaveLength(0);
  });

  it("crosses year boundary", () => {
    expect(buildDateRange("2025-12-30", "2026-01-02")).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });
});
