import { describe, it, expect } from "vitest";
import { generateSchedule, buildOccupantMap } from "../../src/schedule-engine/index.js";
import { teamOccupants } from "../../src/schedule-engine/occupants.js";
import { validateTournamentMove, validateTournamentSwap } from "../../src/schedule-validator.js";
import type { EngineMatch, EngineCourt, ScheduleConfig } from "../../src/schedule-engine/index.js";
import type { TournamentMatchSlot } from "../../src/schedule-validator.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMatch(id: string, teamA: string | null, teamB: string | null, opts: Partial<EngineMatch> = {}): EngineMatch {
  return {
    id,
    round: 1,
    position: 1,
    team_a_id: teamA,
    team_b_id: teamB,
    format: "single_elimination",
    category_sort_order: 0,
    ...opts,
  };
}

function makeCourt(id: string, sort_order = 1): EngineCourt {
  return { id, sort_order };
}



const TWO_COURTS: EngineCourt[] = [makeCourt("c1", 1), makeCourt("c2", 2)];

const ONE_DAY: ScheduleConfig = {
  match_duration: 60,
  break_between: 10,
  days: [{ date: "2026-06-01", start_time: "09:00", end_time: "18:00" }],
};

// ─── teamOccupants ────────────────────────────────────────────────────────────

describe("teamOccupants", () => {
  it("returns player ids when all players have ids", () => {
    const result = teamOccupants("team-1", [
      { name: "Ana", id: "p1" },
      { name: "Luis", id: "p2" },
    ]);
    expect(result).toEqual(["p1", "p2"]);
    expect(result).not.toContain("team-1");
  });

  it("returns team_id as fallback when no players have ids", () => {
    const result = teamOccupants("team-1", [
      { name: "Ana" },
      { name: "Luis" },
    ]);
    expect(result).toContain("team-1");
  });

  it("includes team_id when some players are unresolved", () => {
    const result = teamOccupants("team-1", [
      { name: "Ana", id: "p1" },
      { name: "Luis" },          // no id
    ]);
    expect(result).toContain("p1");
    expect(result).toContain("team-1"); // fallback for the unresolved player
  });

  it("returns [teamId] for null players", () => {
    expect(teamOccupants("team-1", null)).toEqual(["team-1"]);
  });

  it("returns [teamId] for empty players array", () => {
    expect(teamOccupants("team-1", [])).toEqual(["team-1"]);
  });
});

// ─── buildOccupantMap ─────────────────────────────────────────────────────────

describe("buildOccupantMap", () => {
  it("maps team ids to their occupant id lists", () => {
    const map = buildOccupantMap([
      { id: "t1", players: [{ name: "Ana", id: "p1" }, { name: "Luis", id: "p2" }] },
      { id: "t2", players: [{ name: "Carlos", id: "p3" }] },
    ]);
    expect(map["t1"]).toEqual(["p1", "p2"]);
    expect(map["t2"]).toEqual(["p3"]);
  });

  it("falls back to team_id when players have no ids", () => {
    const map = buildOccupantMap([
      { id: "t1", players: [{ name: "Ana" }, { name: "Luis" }] },
    ]);
    expect(map["t1"]).toContain("t1");
  });
});

// ─── generateSchedule with occupantMap ────────────────────────────────────────

describe("generateSchedule — cross-category player conflict (occupantMap)", () => {
  it("[demo] same player_id in two different categories is kept 90+ min apart", () => {
    // Player "p1" plays in catA (team-a1/team-b1) AND in catB (team-a2/team-b2).
    // The two teams have different ids but share the same player.
    const matchA = makeMatch("m-catA", "team-a1", "team-b1", { category_sort_order: 0 });
    const matchB = makeMatch("m-catB", "team-a2", "team-b2", { category_sort_order: 1 });

    const occupantMap = buildOccupantMap([
      { id: "team-a1", players: [{ name: "Ana", id: "p1" }, { name: "Luis", id: "p2" }] },
      { id: "team-b1", players: [{ name: "Pau", id: "p3" }, { name: "Fer", id: "p4" }] },
      { id: "team-a2", players: [{ name: "Ana", id: "p1" }, { name: "Nico", id: "p5" }] }, // p1 again
      { id: "team-b2", players: [{ name: "Jose", id: "p6" }, { name: "Gaby", id: "p7" }] },
    ]);

    const results = generateSchedule([matchA, matchB], TWO_COURTS, ONE_DAY, [], occupantMap);
    expect(results).toHaveLength(2);

    const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
    const diffMin = (times[1] - times[0]) / 60_000;
    expect(diffMin).toBeGreaterThanOrEqual(90);
  });

  it("two matches with completely distinct players can run in parallel", () => {
    const matchA = makeMatch("m-catA", "team-a1", "team-b1");
    const matchB = makeMatch("m-catB", "team-a2", "team-b2");

    const occupantMap = buildOccupantMap([
      { id: "team-a1", players: [{ name: "P1", id: "p1" }, { name: "P2", id: "p2" }] },
      { id: "team-b1", players: [{ name: "P3", id: "p3" }, { name: "P4", id: "p4" }] },
      { id: "team-a2", players: [{ name: "P5", id: "p5" }, { name: "P6", id: "p6" }] },
      { id: "team-b2", players: [{ name: "P7", id: "p7" }, { name: "P8", id: "p8" }] },
    ]);

    const results = generateSchedule([matchA, matchB], TWO_COURTS, ONE_DAY, [], occupantMap);
    expect(results).toHaveLength(2);
    // No shared players → both start at the same time on separate courts
    expect(results[0].scheduled_at.getTime()).toBe(results[1].scheduled_at.getTime());
  });

  it("falls back to team_id when players have no ids — same team_id still conflicts", () => {
    // Both matches use the same team_id "team-a1" (no player ids resolved).
    const matchA = makeMatch("m1", "team-a1", "team-b1");
    const matchB = makeMatch("m2", "team-a1", "team-c1"); // same team-a1

    const occupantMap = buildOccupantMap([
      { id: "team-a1", players: [{ name: "Ana" }] },  // no id → falls back to team-a1
      { id: "team-b1", players: [{ name: "Luis" }] },
      { id: "team-c1", players: [{ name: "Fer" }] },
    ]);

    const results = generateSchedule([matchA, matchB], TWO_COURTS, ONE_DAY, [], occupantMap);
    expect(results).toHaveLength(2);
    const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
    const diffMin = (times[1] - times[0]) / 60_000;
    expect(diffMin).toBeGreaterThanOrEqual(90);
  });

  it("team with mixed resolved/unresolved players includes both player_id and team_id in occupants", () => {
    // team-a1 has p1 (resolved) and one unresolved player.
    // team-a2 shares p1 in a different category.
    const matchA = makeMatch("m-catA", "team-a1", "team-b1", { category_sort_order: 0 });
    const matchB = makeMatch("m-catB", "team-a2", "team-b2", { category_sort_order: 1 });

    const occupantMap = buildOccupantMap([
      { id: "team-a1", players: [{ name: "Ana", id: "p1" }, { name: "Luis" }] }, // mixed
      { id: "team-b1", players: [{ name: "Pau", id: "p3" }] },
      { id: "team-a2", players: [{ name: "Ana", id: "p1" }, { name: "Nico", id: "p5" }] },
      { id: "team-b2", players: [{ name: "Jose", id: "p6" }] },
    ]);

    const results = generateSchedule([matchA, matchB], TWO_COURTS, ONE_DAY, [], occupantMap);
    expect(results).toHaveLength(2);
    const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
    const diffMin = (times[1] - times[0]) / 60_000;
    // p1 is shared → must be 90+ min apart
    expect(diffMin).toBeGreaterThanOrEqual(90);
  });

  it("without occupantMap behaves identically to original (no regression)", () => {
    // Two matches, shared team_a_id "shared" — same behavior as before
    const m1 = makeMatch("m1", "shared", "opp1");
    const m2 = makeMatch("m2", "shared", "opp2");
    const results = generateSchedule([m1, m2], TWO_COURTS, ONE_DAY);
    expect(results).toHaveLength(2);
    const times = results.map((r) => r.scheduled_at.getTime()).sort((a, b) => a - b);
    expect((times[1] - times[0]) / 60_000).toBeGreaterThanOrEqual(90);
  });
});

// ─── validateTournamentSwap — cross-category conflict ────────────────────────

describe("validateTournamentSwap — cross-category player conflict", () => {
  const at = (hhmm: string) => `2026-06-01T${hhmm}:00.000Z`;

  function makeSlot(id: string, time: string, court: string, teamA: string | null, teamB: string | null): TournamentMatchSlot {
    return { id, scheduledAt: at(time), courtId: court, teamAId: teamA, teamBId: teamB };
  }

  it("detects same player in two different teams across categories", () => {
    // After swap: matchA ends up at 10:00, matchB (currently at 10:00) ends up at 09:00.
    // Player p1 is in team-a1 (matchA) AND team-a2 (some other match at 09:10).
    // The swap puts matchA at 10:00 and there's already a match at 09:10 for team-a2/p1.
    const matchA = makeSlot("mA", "09:00", "c1", "team-a1", "team-b1");
    const matchB = makeSlot("mB", "10:00", "c1", "team-a3", "team-b3");
    const other  = makeSlot("mC", "10:10", "c2", "team-a2", "team-b2"); // p1 plays here too

    const occupantMap = {
      "team-a1": ["p1", "p2"],
      "team-b1": ["p3", "p4"],
      "team-a2": ["p1", "p5"],  // p1 appears in both team-a1 and team-a2
      "team-b2": ["p6", "p7"],
      "team-a3": ["p8", "p9"],
      "team-b3": ["p10", "p11"],
    };
    const occupantNames = { p1: "Ana García" };

    const result = validateTournamentSwap(
      matchA, matchB,
      [matchA, matchB, other],
      60, 10,
      {}, {},
      occupantMap, occupantNames,
    );

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toContain("Ana García");
    expect(result.valid === false && result.reason).toContain("categorías");
  });

  it("allows swap when players in both matches are completely distinct", () => {
    const matchA = makeSlot("mA", "09:00", "c1", "team-a1", "team-b1");
    const matchB = makeSlot("mB", "11:00", "c2", "team-a2", "team-b2");

    const occupantMap = {
      "team-a1": ["p1", "p2"],
      "team-b1": ["p3", "p4"],
      "team-a2": ["p5", "p6"],
      "team-b2": ["p7", "p8"],
    };

    const result = validateTournamentSwap(
      matchA, matchB,
      [matchA, matchB],
      60, 10,
      {}, {},
      occupantMap, {},
    );

    expect(result.valid).toBe(true);
  });

  it("preserves original error message for same-team conflict (third match not in swap)", () => {
    // matchA (team-x at 09:00) swaps with matchB (team-a2 at 11:00).
    // There's a third match with team-x at 11:20 (not in the swap).
    // After swap, matchA would be at 11:00 → team-x plays 11:00 and 11:20 = 20 min gap < 70.
    const matchA = makeSlot("mA", "09:00", "c1", "team-x", "team-b1");
    const matchB = makeSlot("mB", "11:00", "c2", "team-a2", "team-b2");
    const third  = makeSlot("mC", "11:20", "c2", "team-x",  "team-c1"); // team-x, not in swap

    const occupantMap = {
      "team-x":  ["team-x"],  // unresolved → fallback to team_id (intra-category)
      "team-b1": ["p2"],
      "team-a2": ["p3"],
      "team-b2": ["p4"],
      "team-c1": ["p5"],
    };

    const result = validateTournamentSwap(
      matchA, matchB,
      [matchA, matchB, third],
      60, 10,
      { "team-x": "Pareja X" }, {},
      occupantMap, {},
    );

    expect(result.valid).toBe(false);
    // team-x is the same team (same team_id, intra-category) → team-level message
    expect(result.valid === false && result.reason).toContain("Pareja X");
    // Should NOT use the cross-category player message
    expect(result.valid === false && result.reason).not.toContain("categorías");
  });
});

// ─── validateTournamentMove — configured break ────────────────────────────────

describe("validateTournamentMove — configured break", () => {
  const at = (hhmm: string) => `2026-06-01T${hhmm}:00.000Z`;

  function makeSlot(id: string, time: string, court: string, teamA: string | null, teamB: string | null): TournamentMatchSlot {
    return { id, scheduledAt: at(time), courtId: court, teamAId: teamA, teamBId: teamB };
  }

  it("rejects a court move that overlaps the configured break", () => {
    const moving = makeSlot("moving", "08:00", "c1", "team-a1", "team-b1");
    const existing = makeSlot("existing", "11:30", "c1", "team-a2", "team-b2");

    const result = validateTournamentMove(
      moving,
      { scheduledAt: at("10:00"), courtId: "c1" },
      [existing],
      90,
      15,
      {},
      { c1: "Cancha 1" },
    );

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toContain("Cancha 1");
    expect(result.valid === false && result.reason).toContain("105 min");
  });

  it("allows a court move exactly after duration plus break", () => {
    const moving = makeSlot("moving", "08:00", "c1", "team-a1", "team-b1");
    const existing = makeSlot("existing", "11:45", "c1", "team-a2", "team-b2");

    const result = validateTournamentMove(
      moving,
      { scheduledAt: at("10:00"), courtId: "c1" },
      [existing],
      90,
      15,
      {},
      { c1: "Cancha 1" },
    );

    expect(result.valid).toBe(true);
  });

  it("rejects a player move that is below the configured player rest", () => {
    const moving = makeSlot("moving", "08:00", "c1", "team-a1", "team-b1");
    const existing = makeSlot("existing", "11:30", "c2", "team-a2", "team-b2");
    const occupantMap = {
      "team-a1": ["p1", "p2"],
      "team-b1": ["p3", "p4"],
      "team-a2": ["p1", "p5"],
      "team-b2": ["p6", "p7"],
    };

    // Player rest 60 → required start-to-start gap = duration(90) + 60 = 150 min.
    // Moving to 10:00 vs existing at 11:30 leaves only 90 min → rejected.
    const result = validateTournamentMove(
      moving,
      { scheduledAt: at("10:00"), courtId: "c1" },
      [existing],
      90,
      15,
      {},
      {},
      occupantMap,
      { p1: "Ana García" },
      60, // playerRestMinutes
    );

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toContain("Ana García");
    expect(result.valid === false && result.reason).toContain("150 min");
  });

  it("uses the 90-min default player rest when not provided", () => {
    const moving = makeSlot("moving", "08:00", "c1", "team-a1", "team-b1");
    const existing = makeSlot("existing", "11:30", "c2", "team-a2", "team-b2");
    const occupantMap = {
      "team-a1": ["p1", "p2"],
      "team-b1": ["p3", "p4"],
      "team-a2": ["p1", "p5"],
      "team-b2": ["p6", "p7"],
    };

    // No playerRestMinutes → default 90 → required gap = 90 + 90 = 180 min.
    const result = validateTournamentMove(
      moving,
      { scheduledAt: at("10:00"), courtId: "c1" },
      [existing],
      90,
      15,
      {},
      {},
      occupantMap,
      { p1: "Ana García" },
    );

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toContain("180 min");
  });
});
