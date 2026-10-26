import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import type { Entry } from "./types";

// Nothing may be scheduled past the competition, less a few days' margin. A
// card that never comes back can never be corrected -- and "easy" routinely
// schedules 200 days out, well beyond the test it is being learned for.
const EXAM_MARGIN = 3 * 86_400_000;

function clampDue(due: Date, now: Date, comp: Date): Date {
  const latest = comp.getTime() - EXAM_MARGIN;
  if (latest <= now.getTime()) return due; // inside the final days there is nothing to pull back to
  return due.getTime() > latest ? new Date(latest) : due;
}

/** Target retention ramps from 0.85 early in the season to 0.95 near competition day. */
export function requestRetention(now: Date, comp: Date): number {
  const days = Math.max(0, (comp.getTime() - now.getTime()) / 86_400_000);
  if (days > 120) return 0.85;
  if (days < 14) return 0.95;
  return 0.85 + (0.95 - 0.85) * (1 - (days - 14) / (120 - 14));
}

const scheduler = (now: Date, comp: Date, fuzz: boolean) =>
  fsrs(generatorParameters({ request_retention: requestRetention(now, comp), enable_fuzz: fuzz }));

function toCard(e: Entry | undefined, now: Date): Card {
  if (!e) return createEmptyCard(now);
  return {
    due: new Date(e.due), stability: e.stab, difficulty: e.diff,
    elapsed_days: 0, scheduled_days: 0,
    // Must round-trip, or "good" on a learning card never graduates it.
    learning_steps: e.steps, reps: e.reps, lapses: e.lapses, state: e.state,
    last_review: new Date(e.last),
  } as Card;
}

export const GRADES = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;
export type GradeName = keyof typeof GRADES;

/** The card's new state after grading it. `mode` decides whether first contact counts as a fair sample. */
export function grade(
  prev: Entry | undefined, g: Grade, now: Date, comp: Date, sec: number, mode: "scheduled" | "drill",
): Entry {
  const next = scheduler(now, comp, true).next(toCard(prev, now), now, g).card;
  next.due = clampDue(next.due, now, comp);
  const ok = g >= Rating.Hard;
  return {
    due: next.due.getTime(), stab: next.stability, diff: next.difficulty,
    reps: next.reps, lapses: next.lapses, state: next.state,
    last: now.getTime(), steps: next.learning_steps ?? 0,
    knows: ok,
    knewFirst: prev ? prev.knewFirst : ok,
    sampled: prev ? prev.sampled : mode !== "drill",
    sec,
  };
}

function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

/** How long until the card returns for each grade, for the button labels. Fuzz off so labels hold still. */
export function previewIntervals(e: Entry | undefined, now: Date, comp: Date): Record<GradeName, string> {
  const out = scheduler(now, comp, false).repeat(toCard(e, now), now);
  const get = (g: Grade) => span(clampDue(out[g].card.due, now, comp).getTime() - now.getTime());
  return { again: get(Rating.Again), hard: get(Rating.Hard), good: get(Rating.Good), easy: get(Rating.Easy) };
}
