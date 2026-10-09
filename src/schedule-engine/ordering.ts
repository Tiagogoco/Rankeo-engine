import type { EngineMatch, ExistingAssignment } from "./types.js";
import { teamOccupants } from "./occupants.js";

const FORMAT_PRIORITY: Record<string, number> = {
  round_robin: 0,
  group_stage_playoffs: 0,
  single_elimination: 1,
};

// Resolve dependencies from IDs; round numbers need not be comparable across formats.
export function buildFeederGraph(matches: EngineMatch[], existing: ExistingAssignment[]) {
  const feeders = new Map<string, string[]>();
  const addFeeder = (feederId: string, dependentId: string) => {
    const list = feeders.get(dependentId);
    if (list) list.push(feederId);
    else feeders.set(dependentId, [feederId]);
  };
  for (const m of matches) if (m.next_match_id) addFeeder(m.id, m.next_match_id);
  for (const ea of existing) if (ea.match_id && ea.next_match_id) addFeeder(ea.match_id, ea.next_match_id);

  const pendingIds = new Set(matches.map((m) => m.id));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string> = new Set()): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) throw new Error("Schedule dependencies must not contain cycles");
    seen.add(id);
    const pendingFeeders = (feeders.get(id) ?? []).filter((f) => pendingIds.has(f));
    const d = pendingFeeders.length === 0 ? 0 : 1 + Math.max(...pendingFeeders.map((f) => depthOf(f, seen)));
    seen.delete(id);
    depthCache.set(id, d);
    return d;
  };

  for (const id of pendingIds) depthOf(id);
  return { feeders, depthOf };
}

// Dependencies first, then sporting priority. ID breaks remaining ties.
export function sortBySportingOrder(matches: EngineMatch[], depthOf: (id: string) => number): EngineMatch[] {
  return [...matches].sort((a, b) => {
    const depthDifference = depthOf(a.id) - depthOf(b.id);
    if (depthDifference !== 0) return depthDifference;
    const pa = FORMAT_PRIORITY[a.format] ?? 1;
    const pb = FORMAT_PRIORITY[b.format] ?? 1;
    if (pa !== pb) return pa - pb;
    if (a.category_sort_order !== b.category_sort_order) return a.category_sort_order - b.category_sort_order;
    if (a.round !== b.round) return a.round - b.round;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Downstream chain length: how many bracket generations this match feeds via
// next_match_id. Delaying the root of a long chain delays the whole chain, so
// higher = more critical.
export function buildHeightOf(matches: EngineMatch[]) {
  const nextById = new Map(matches.map((m) => [m.id, m.next_match_id ?? null]));
  const cache = new Map<string, number>();
  const heightOf = (id: string, seen: Set<string> = new Set()): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) throw new Error("Schedule dependencies must not contain cycles");
    seen.add(id);
    const next = nextById.get(id);
    const h = next && nextById.has(next) ? 1 + heightOf(next, seen) : 0;
    seen.delete(id);
    cache.set(id, h);
    return h;
  };
  return heightOf;
}

// Player contention: for each match, how many OTHER pending matches its
// occupants also play in. Busy players form rest-gap chains (duration + rest
// between each of their matches) that dominate the makespan, so their matches
// should be committed first while early slots are still open.
export function buildConflictDegreeOf(matches: EngineMatch[], occupantMap: Record<string, string[]>) {
  const occsByMatch = new Map<string, string[]>();
  const matchesPerOccupant = new Map<string, number>();
  for (const m of matches) {
    const ids = new Set<string>();
    for (const teamId of [m.team_a_id, m.team_b_id]) {
      if (!teamId) continue;
      for (const o of occupantMap[teamId] ?? teamOccupants(teamId, null)) ids.add(o);
    }
    const occs = [...ids];
    occsByMatch.set(m.id, occs);
    for (const o of occs) matchesPerOccupant.set(o, (matchesPerOccupant.get(o) ?? 0) + 1);
  }
  return (id: string): number =>
    (occsByMatch.get(id) ?? []).reduce((sum, o) => sum + (matchesPerOccupant.get(o)! - 1), 0);
}

// Within each depth, prioritize long dependency chains and busy players.
export function sortByConstrainedness(
  matches: EngineMatch[],
  depthOf: (id: string) => number,
  heightOf: (id: string) => number,
  conflictDegreeOf: (id: string) => number,
): EngineMatch[] {
  return [...matches].sort((a, b) => {
    const depthDifference = depthOf(a.id) - depthOf(b.id);
    if (depthDifference !== 0) return depthDifference;
    const pa = FORMAT_PRIORITY[a.format] ?? 1;
    const pb = FORMAT_PRIORITY[b.format] ?? 1;
    if (pa !== pb) return pa - pb;
    const ha = heightOf(a.id);
    const hb = heightOf(b.id);
    if (ha !== hb) return hb - ha;
    const ca = conflictDegreeOf(a.id);
    const cb = conflictDegreeOf(b.id);
    if (ca !== cb) return cb - ca;
    if (a.category_sort_order !== b.category_sort_order) return a.category_sort_order - b.category_sort_order;
    if (a.round !== b.round) return a.round - b.round;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Deterministic PRNG (mulberry32). Only ever used with fixed literal seeds so
// the whole engine stays reproducible — never seeded from time/ambient state.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded topological order: keeps the (format priority, feeder depth) skeleton
// — so feeders always precede their dependents — but randomizes the relative
// order inside each group with a fixed seed. Shuffle keys are assigned over
// matches sorted by id, so the result is independent of input array order.
export function shuffledTopologicalOrder(matches: EngineMatch[], depthOf: (id: string) => number, seed: number): EngineMatch[] {
  const rng = mulberry32(seed);
  const shuffleKey = new Map<string, number>();
  for (const m of [...matches].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    shuffleKey.set(m.id, rng());
  }
  return [...matches].sort((a, b) => {
    const depthDifference = depthOf(a.id) - depthOf(b.id);
    if (depthDifference !== 0) return depthDifference;
    const pa = FORMAT_PRIORITY[a.format] ?? 1;
    const pb = FORMAT_PRIORITY[b.format] ?? 1;
    if (pa !== pb) return pa - pb;
    const ka = shuffleKey.get(a.id)!;
    const kb = shuffleKey.get(b.id)!;
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
