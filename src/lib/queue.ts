import type { DeckCard, Entry, Outline, Progress, SubjectProgress } from "./types";
import { SUBJECTS } from "./types";

/** Priority at or above this is the "likely" tier; new cards in it come first. */
export const LIKELY = 0.6;
/** At most this many cards are being learned at once, as in Anki. */
export const LEARNING_SET = 20;

const isLearning = (e: Entry) => e.state === 1 || e.state === 3;

/** Stable per-student scramble, so new cards spread across sections like a random sample. */
function scramble(id: string, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export const newCardSeed = (studentId: string, day: string) => {
  let h = 7;
  for (const ch of studentId + day) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h >>> 0;
};

export type Scope = { subject?: string; section?: number };
export type Run = { mode: "scheduled" | "drill"; scope: Scope; seed: number; startedAt: number };

export type Pick = { card: DeckCard; subject: string; entry: Entry | undefined; left: number };

/**
 * The next card. Scheduled is the ordinary finite FSRS queue: due cards first,
 * then new cards while the learning set has room (likely tier before unlikely),
 * then learning cards ahead of their step. Drill covers every card in the
 * scope, weakest first, once each per run (`done` holds the ones already seen).
 */
export function nextCard(
  decks: Record<string, DeckCard[]>, progress: Progress, run: Run, done: Set<string>, now = Date.now(),
): Pick | null {
  const subjects = run.scope.subject ? [run.scope.subject] : [...SUBJECTS];
  const inScope = (c: DeckCard) => run.scope.section === undefined || c.sec === run.scope.section;
  let best: { key: [number, number, number]; card: DeckCard; subject: string; entry?: Entry } | null = null;
  let left = 0;

  if (run.mode === "drill") {
    for (const subject of subjects) {
      const prog = progress[subject] ?? {};
      for (const card of decks[subject] ?? []) {
        if (!inScope(card) || done.has(card.id)) continue;
        left++;
        const e = prog[card.id];
        // Never seen first (likely before unlikely), then lowest stability.
        const key: [number, number, number] = e ? [2, e.stab, 0] : [0, (card.pr ?? 1) < LIKELY ? 1 : 0, scramble(card.id, run.seed)];
        if (!best || less(key, best.key)) best = { key, card, subject, entry: e };
      }
    }
    return best ? { card: best.card, subject: best.subject, entry: best.entry, left } : null;
  }

  let learning = 0;
  for (const subject of subjects) {
    for (const card of decks[subject] ?? []) {
      if (inScope(card) && progress[subject]?.[card.id] && isLearning(progress[subject][card.id])) learning++;
    }
  }
  const room = learning < LEARNING_SET;
  for (const subject of subjects) {
    const prog: SubjectProgress = progress[subject] ?? {};
    for (const card of decks[subject] ?? []) {
      if (!inScope(card)) continue;
      const e = prog[card.id];
      let key: [number, number, number];
      if (e && e.due <= now) key = [0, e.due, 0];
      else if (!e && room) key = [1, (card.pr ?? 1) < LIKELY ? 1 : 0, scramble(card.id, run.seed)];
      else if (e && isLearning(e)) key = [2, e.due, 0];
      else continue;
      left++;
      if (!best || less(key, best.key)) best = { key, card, subject, entry: e };
    }
  }
  return best ? { card: best.card, subject: best.subject, entry: best.entry, left } : null;
}

function less(a: [number, number, number], b: [number, number, number]) {
  return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0;
}

export type QueueCounts = { new: number; learn: number; due: number };

/** Anki-style split of the queue: never seen, in (re)learning, due for review. Keyed "subject" and "subject|section". */
export function queueCounts(progress: Progress, outline: Outline, now = Date.now()): Record<string, QueueCounts> {
  const out: Record<string, QueueCounts> = {};
  for (const subject of SUBJECTS) {
    const o = outline[subject];
    if (!o) continue;
    const secs = o.sections.map(() => ({ new: 0, learn: 0, due: 0, seen: 0 }));
    for (const e of Object.values(progress[subject] ?? {})) {
      const s = secs[e.sec];
      if (!s) continue;
      s.seen++;
      if (isLearning(e) && e.due <= now) s.learn++;
      else if (e.state === 2 && e.due <= now) s.due++;
    }
    const total = { new: 0, learn: 0, due: 0 };
    o.sections.forEach((sec, i) => {
      const s = secs[i];
      const c = { new: Math.max(0, sec.cards - s.seen), learn: s.learn, due: s.due };
      out[`${subject}|${sec.name}`] = c;
      total.new += c.new; total.learn += c.learn; total.due += c.due;
    });
    out[subject] = total;
  }
  return out;
}
