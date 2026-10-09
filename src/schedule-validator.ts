import { DEFAULT_PLAYER_REST_MINUTES } from "./schedule-engine/constraints.js";

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

// ─── Tournament ───────────────────────────────────────────────────────────────

export interface TournamentMatchSlot {
  id: string;
  scheduledAt: string | null; // ISO timestamp
  courtId: string | null;
  teamAId: string | null;
  teamBId: string | null;
}

export interface TournamentMoveTarget {
  scheduledAt: string;
  courtId: string;
}

function toMinutes(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 60000);
}

// Scheduled instants are stored as "naive UTC" (wall clock in UTC fields).
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function resolveOccupants(teamId: string | null, occupantMap: Record<string, string[]>): string[] {
  if (!teamId) return [];
  return occupantMap[teamId] ?? [teamId];
}

/**
 * Validates whether swapping the slots of matchA and matchB is safe.
 *
 * Checks:
 * 1. Court conflict: no other match occupies the target slot.
 * 2. Occupant gap: each occupant (player_id when available, team_id as fallback)
 *    keeps at least (matchDuration + playerRestMinutes) minutes between consecutive
 *    matches. When occupantMap is provided, cross-category conflicts (same
 *    player, different team) are also detected.
 */
export function validateTournamentSwap(
  matchA: TournamentMatchSlot,
  matchB: TournamentMatchSlot,
  allMatches: TournamentMatchSlot[],
  matchDuration: number,
  breakBetween: number,
  teamNames: Record<string, string> = {},
  courtNames: Record<string, string> = {},
  occupantMap: Record<string, string[]> = {},
  occupantNames: Record<string, string> = {},
  playerRestMinutes: number = DEFAULT_PLAYER_REST_MINUTES,
): ValidationResult {
  if (!matchA.scheduledAt || !matchA.courtId || !matchB.scheduledAt || !matchB.courtId) {
    return { valid: false, reason: "Ambos partidos deben tener hora y cancha asignadas." };
  }

  // Player gap is start-to-start: a match plays for matchDuration, then the
  // player rests playerRestMinutes before the next can start. Distinct from the
  // court turnaround (break_between).
  const minGap = matchDuration + playerRestMinutes;
  const swapIds = new Set([matchA.id, matchB.id]);

  // After swap: A takes B's slot, B takes A's slot
  const newSlotA = { scheduledAt: matchB.scheduledAt, courtId: matchB.courtId };
  const newSlotB = { scheduledAt: matchA.scheduledAt, courtId: matchA.courtId };

  // Build simulated match list
  const simulated = allMatches.map((m) => {
    if (m.id === matchA.id) return { ...m, ...newSlotA };
    if (m.id === matchB.id) return { ...m, ...newSlotB };
    return m;
  });

  // 1. Court conflict: two matches on same court at same time
  for (const slot of [
    { id: matchA.id, ...newSlotA },
    { id: matchB.id, ...newSlotB },
  ]) {
    if (!slot.scheduledAt || !slot.courtId) continue;
    const tSlot = toMinutes(slot.scheduledAt);
    const conflict = simulated.find(
      (m) =>
        m.id !== slot.id &&
        m.scheduledAt &&
        m.courtId === slot.courtId &&
        toMinutes(m.scheduledAt) === tSlot,
    );
    if (conflict) {
      const courtLabel = courtNames[slot.courtId] ?? "la misma cancha";
      const time = formatLocalTime(slot.scheduledAt);
      return {
        valid: false,
        reason: `Conflicto de cancha: ${courtLabel} ya tiene un partido a las ${time}.`,
      };
    }
  }

  // 2. Occupant gap: for each occupant (player_id or team_id fallback) involved,
  //    check the gap with all other matches that share the same occupant.
  //    This catches cross-category conflicts when the same player appears in two
  //    different teams.
  // Build a map: occupant_id -> matches they play in (after simulated swap)
  const occupantToMatches = new Map<string, typeof simulated>();
  for (const m of simulated) {
    for (const oid of [...resolveOccupants(m.teamAId, occupantMap), ...resolveOccupants(m.teamBId, occupantMap)]) {
      if (!occupantToMatches.has(oid)) occupantToMatches.set(oid, []);
      occupantToMatches.get(oid)!.push(m);
    }
  }

  const occupantsToCheck: Array<{ occupantId: string; newTime: string; sourceTeamId: string | null }> = [];

  for (const teamId of [matchA.teamAId, matchA.teamBId]) {
    for (const oid of resolveOccupants(teamId, occupantMap)) {
      occupantsToCheck.push({ occupantId: oid, newTime: newSlotA.scheduledAt, sourceTeamId: teamId });
    }
  }
  for (const teamId of [matchB.teamAId, matchB.teamBId]) {
    for (const oid of resolveOccupants(teamId, occupantMap)) {
      occupantsToCheck.push({ occupantId: oid, newTime: newSlotB.scheduledAt, sourceTeamId: teamId });
    }
  }

  for (const { occupantId, newTime, sourceTeamId } of occupantsToCheck) {
    const newMin = toMinutes(newTime);

    const otherMatches = (occupantToMatches.get(occupantId) ?? []).filter(
      (m) => !swapIds.has(m.id) && m.scheduledAt,
    );

    for (const other of otherMatches) {
      const gap = Math.abs(newMin - toMinutes(other.scheduledAt!));
      if (gap < minGap) {
        const t1 = formatLocalTime(newTime);

        // Determine if this is a cross-category conflict (different teams, same player)
        const isCrossCategory =
          sourceTeamId !== null &&
          other.teamAId !== sourceTeamId &&
          other.teamBId !== sourceTeamId;

        if (isCrossCategory) {
          const playerLabel = occupantNames[occupantId] ?? "Un jugador";
          if (gap === 0) {
            return {
              valid: false,
              reason: `Conflicto de jugador: "${playerLabel}" juega en dos categorías al mismo tiempo (${t1}).`,
            };
          }
          const t2 = formatLocalTime(other.scheduledAt!);
          return {
            valid: false,
            reason: `Conflicto de jugador: "${playerLabel}" quedaría con solo ${gap} min entre partidos de distintas categorías (${t1} y ${t2}). Mínimo requerido: ${minGap} min.`,
          };
        }

        const teamLabel = teamNames[sourceTeamId ?? ""] ?? "un equipo";
        if (gap === 0) {
          return {
            valid: false,
            reason: `Conflicto de pareja: "${teamLabel}" tiene dos partidos al mismo tiempo (${t1}).`,
          };
        }
        const t2 = formatLocalTime(other.scheduledAt!);
        return {
          valid: false,
          reason: `Conflicto de pareja: "${teamLabel}" quedaría con solo ${gap} min entre partidos (${t1} y ${t2}). Mínimo requerido: ${minGap} min.`,
        };
      }
    }
  }

  return { valid: true };
}

export function validateTournamentMove(
  match: TournamentMatchSlot,
  target: TournamentMoveTarget,
  allMatches: TournamentMatchSlot[],
  matchDuration: number,
  breakBetween: number,
  teamNames: Record<string, string> = {},
  courtNames: Record<string, string> = {},
  occupantMap: Record<string, string[]> = {},
  occupantNames: Record<string, string> = {},
  playerRestMinutes: number = DEFAULT_PLAYER_REST_MINUTES,
): ValidationResult {
  if (!target.scheduledAt || !target.courtId) {
    return { valid: false, reason: "El partido debe tener hora y cancha asignadas." };
  }

  // Court turnaround (break_between) vs player rest are separate rules.
  const courtGap = matchDuration + breakBetween;
  const playerGap = matchDuration + playerRestMinutes;
  const targetStart = toMinutes(target.scheduledAt);
  const targetEnd = targetStart + courtGap;

  for (const other of allMatches) {
    if (other.id === match.id || !other.scheduledAt || !other.courtId) continue;
    if (other.courtId !== target.courtId) continue;

    const otherStart = toMinutes(other.scheduledAt);
    const otherEnd = otherStart + courtGap;
    if (targetStart < otherEnd && targetEnd > otherStart) {
      const courtLabel = courtNames[target.courtId] ?? "la misma cancha";
      const otherTime = formatLocalTime(other.scheduledAt);
      return {
        valid: false,
        reason: `Conflicto de cancha: ${courtLabel} ya tiene un partido a las ${otherTime}. Mínimo entre inicios con pausa: ${courtGap} min.`,
      };
    }
  }

  const movingOccupants: Array<{ occupantId: string; sourceTeamId: string | null }> = [];
  for (const teamId of [match.teamAId, match.teamBId]) {
    for (const oid of resolveOccupants(teamId, occupantMap)) {
      movingOccupants.push({ occupantId: oid, sourceTeamId: teamId });
    }
  }

  if (movingOccupants.length === 0) return { valid: true };

  for (const other of allMatches) {
    if (other.id === match.id || !other.scheduledAt) continue;

    const otherOccupants = [
      ...resolveOccupants(other.teamAId, occupantMap),
      ...resolveOccupants(other.teamBId, occupantMap),
    ];

    const shared = movingOccupants.find(({ occupantId }) => otherOccupants.includes(occupantId));
    if (!shared) continue;

    const gap = Math.abs(targetStart - toMinutes(other.scheduledAt));
    if (gap >= playerGap) continue;

    const targetTime = formatLocalTime(target.scheduledAt);
    const otherTime = formatLocalTime(other.scheduledAt);
    const isCrossCategory =
      shared.sourceTeamId !== null &&
      other.teamAId !== shared.sourceTeamId &&
      other.teamBId !== shared.sourceTeamId;

    if (isCrossCategory) {
      const playerLabel = occupantNames[shared.occupantId] ?? "Un jugador";
      if (gap === 0) {
        return {
          valid: false,
          reason: `Conflicto de jugador: "${playerLabel}" juega en dos categorías al mismo tiempo (${targetTime}).`,
        };
      }
      return {
        valid: false,
        reason: `Conflicto de jugador: "${playerLabel}" quedaría con solo ${gap} min entre partidos de distintas categorías (${targetTime} y ${otherTime}). Mínimo requerido: ${playerGap} min.`,
      };
    }

    const teamLabel = teamNames[shared.sourceTeamId ?? ""] ?? "un equipo";
    if (gap === 0) {
      return {
        valid: false,
        reason: `Conflicto de pareja: "${teamLabel}" tiene dos partidos al mismo tiempo (${targetTime}).`,
      };
    }
    return {
      valid: false,
      reason: `Conflicto de pareja: "${teamLabel}" quedaría con solo ${gap} min entre partidos (${targetTime} y ${otherTime}). Mínimo requerido: ${playerGap} min.`,
    };
  }

  return { valid: true };
}

// ─── League ───────────────────────────────────────────────────────────────────

export interface LeagueMatchSlot {
  id: string;
  scheduledTime: string; // "HH:MM"
  physicalCourt: number;
}

/**
 * Validates swapping two level_matches within the same round.
 * Only checks court conflict (each level has unique players within a round).
 */
export function validateLeagueSwap(
  matchA: LeagueMatchSlot,
  matchB: LeagueMatchSlot,
  allRoundMatches: LeagueMatchSlot[],
): ValidationResult {
  if (!matchA.scheduledTime || !matchB.scheduledTime) {
    return { valid: false, reason: "Ambos partidos deben tener hora asignada." };
  }

  // After swap
  const newSlots: LeagueMatchSlot[] = allRoundMatches.map((m) => {
    if (m.id === matchA.id) return { ...m, scheduledTime: matchB.scheduledTime, physicalCourt: matchB.physicalCourt };
    if (m.id === matchB.id) return { ...m, scheduledTime: matchA.scheduledTime, physicalCourt: matchA.physicalCourt };
    return m;
  });

  for (const check of [
    { id: matchA.id, scheduledTime: matchB.scheduledTime, physicalCourt: matchB.physicalCourt },
    { id: matchB.id, scheduledTime: matchA.scheduledTime, physicalCourt: matchA.physicalCourt },
  ]) {
    const conflict = newSlots.find(
      (m) =>
        m.id !== check.id &&
        m.scheduledTime === check.scheduledTime &&
        m.physicalCourt === check.physicalCourt,
    );
    if (conflict) {
      return {
        valid: false,
        reason: `Conflicto: la cancha ${check.physicalCourt} ya tiene un partido a las ${check.scheduledTime}.`,
      };
    }
  }

  return { valid: true };
}
