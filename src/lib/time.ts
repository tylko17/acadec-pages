/**
 * The team is in Los Angeles and the server runs on UTC, so every "day" and
 * "week" in the app is computed in Pacific time here -- never with
 * toISOString(), setHours() or SQLite's unixepoch, which all use the server's.
 */
export const TEAM_TZ = "America/Los_Angeles";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function wall(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Pacific calendar date at this instant, as YYYY-MM-DD. */
export function teamDay(ms = Date.now()): string {
  const { y, m, d } = wall(ms);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Pacific wall-clock minus UTC at this instant, in ms (-7h or -8h). */
function offset(ms: number): number {
  const { y, m, d, h, min, s } = wall(ms);
  return Date.UTC(y, m - 1, d, h, min, s) - Math.floor(ms / 1000) * 1000;
}

/** The instant it is `hour`:00 Pacific on `day` (YYYY-MM-DD). */
export function teamTime(day: string, hour = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  // Two passes, so a date on the far side of a DST change gets its own offset.
  return guess - offset(guess - offset(guess));
}

/** Calendar arithmetic on YYYY-MM-DD strings. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday 00:00 Pacific of the week containing `ms`. */
export function teamWeekStart(ms = Date.now()): number {
  const day = teamDay(ms);
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return teamTime(addDays(day, -((dow + 6) % 7)));
}

/** A real calendar date in YYYY-MM-DD form -- "2026-02-30" is not. */
export function isRealDate(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && addDays(day, 0) === day;
}
