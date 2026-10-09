import { getScheduleGridStep } from "../schedule-grid.js";
import type { DayConfig, ScheduleConfig, EngineCourt, Slot } from "./types.js";

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Reads the wall-clock date of a "naive UTC" instant (wall-clock time encoded in UTC fields).
export function formatLocalDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Builds a "naive UTC" instant: the wall-clock time is encoded into UTC fields
// so storage is identical regardless of the process timezone (wall-clock time encoded in UTC fields).
export function makeScheduleDate(date: string, minutesFromMidnight: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, Math.floor(minutesFromMidnight / 60), minutesFromMidnight % 60, 0, 0));
}

function roundUpToStep(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step;
}

// `now` is expected as a "naive UTC" instant in the tournament timezone
// Read via UTC fields accordingly; timezone conversion belongs to the caller.
export function getSchedulableScheduleConfig(
  config: ScheduleConfig,
  now: Date = new Date(),
): ScheduleConfig {
  const today = formatLocalDate(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const gridStep = getScheduleGridStep(config.match_duration, config.break_between);

  const days = config.days.flatMap((day): DayConfig[] => {
    if (day.date < today) return [];
    if (day.date > today) return [day];

    const endMin = timeToMinutes(day.end_time);
    const startMin = Math.max(
      timeToMinutes(day.start_time),
      roundUpToStep(nowMinutes, gridStep),
    );

    if (startMin > endMin) return [];

    return [{ ...day, start_time: minutesToTime(startMin) }];
  });

  return { ...config, days };
}

export function buildSlots(config: ScheduleConfig, sortedCourts: EngineCourt[], gridStep: number): Slot[] {
  const slots: Slot[] = [];
  for (const day of config.days) {
    const startMin = timeToMinutes(day.start_time);
    const endMin = timeToMinutes(day.end_time);
    if (startMin > endMin) continue;

    const starts = new Set<number>();
    for (let t = startMin; t <= endMin; t += gridStep) {
      starts.add(t);
    }
    starts.add(endMin);

    for (const start of [...starts].sort((a, b) => a - b)) {
      for (const court of sortedCourts) {
        slots.push({ date: day.date, startMin: start, courtId: court.id });
      }
    }
  }
  return slots;
}

// Build array of "YYYY-MM-DD" strings for each day in [start, end] inclusive
export function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd, 12));
  const end = new Date(Date.UTC(ey, em - 1, ed, 12));
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
