import { addDays, teamDay } from "./time";

/**
 * Streak counts DAYS REVIEWED, never minutes. Freezes absorb missed days so one
 * bad week doesn't end the season; every student starts with three.
 */
export const FREEZES = 3;

export function streak(days: string[] | undefined, now = Date.now()) {
  const have = new Set(days ?? []);
  const todayKey = teamDay(now);
  const studiedToday = have.has(todayKey);
  const oldest = [...have].sort()[0];
  let length = 0, used = 0;
  // A day still in progress should not break anything, so start at yesterday if today is empty.
  for (let i = studiedToday ? 0 : 1; oldest !== undefined; i++) {
    const d = addDays(todayKey, -i);
    if (d < oldest) break;
    if (have.has(d)) { length++; continue; }
    if (used < FREEZES) { used++; continue; }
    break;
  }
  return { length, studiedToday, freezesUsed: used };
}
