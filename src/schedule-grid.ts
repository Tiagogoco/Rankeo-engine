function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

export function getScheduleGridStepFromTotal(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 30;
  return Math.max(5, Math.min(30, gcd(Math.trunc(totalMinutes), 30)));
}

export function getScheduleGridStep(matchDuration: number, breakBetween: number): number {
  return getScheduleGridStepFromTotal(matchDuration + breakBetween);
}
