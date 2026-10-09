import type { ScheduleSlot } from "./types.js";

/**
 * Generates the proposed schedule for a round.
 * Levels are scheduled in the supplied order.
 * Levels are grouped into turns by available courts.
 * Each turn starts slotMinutes after the previous one.
 */
export function generateRoundSchedule(
  levels: number[],
  availableCourts: number,
  startTime: string,
  durationMinutes = 90,
  breakMinutes = 15,
): ScheduleSlot[] {
  const slotMinutes = durationMinutes + breakMinutes;
  const [startH, startM] = startTime.split(":").map(Number);
  const startTotal = startH * 60 + startM;

  return levels.map((level, idx) => {
    const turn = Math.floor(idx / availableCourts);
    const court = (idx % availableCourts) + 1;
    const totalMinutes = startTotal + turn * slotMinutes;
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return { level, physicalCourt: court, scheduledTime: `${h}:${m}` };
  });
}
