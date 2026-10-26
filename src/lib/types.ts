export type Division = "honors" | "scholastic" | "varsity";
export const DIVISIONS: Division[] = ["honors", "scholastic", "varsity"];
export const DIVISION_LABEL: Record<Division, string> = { honors: "Honors", scholastic: "Scholastic", varsity: "Varsity" };

/** GPA decides the division once, at roster entry; the GPA itself is discarded. */
export function divisionFor(gpa: number): Division {
  return gpa >= 3.75 ? "honors" : gpa >= 3.0 ? "scholastic" : "varsity";
}

export const SUBJECTS = ["Art", "Economics", "Literature", "Mathematics", "Music", "Science", "Social Science"] as const;

export type Student = {
  id: string;
  name: string;
  division: Division;
  /** Firebase uid this name is bound to; picking a name moves the binding. */
  uid?: string | null;
  captain?: boolean;
  /** Published by the student's own browser after each save. */
  total?: number;
  subjects?: Record<string, number>;
  improvement?: number;
  lastReview?: number;
  reviews?: number;
  /** Pacific YYYY-MM-DD days with at least one review, for the streak. */
  days?: string[];
};

export type Config = { competitionDate: string };

/** One section of a subject, as the outline knows it. Card text lives in deck chunks. */
export type Section = { name: string; cards: number; extracted: boolean; weight?: number };
export type SubjectOutline = { slug: string; version: string; chunks: number; sections: Section[] };
export type Outline = Record<string, SubjectOutline>;

export type DeckCard = {
  id: string;
  /** Index into the subject's outline sections. */
  sec: number;
  prompt: string;
  answer: string;
  page?: number;
  /** Pass-D priority; 0.6 and up is the "likely" tier. */
  pr?: number;
  src?: { where: string; before: string; text: string; after: string };
};

/** A student's memory of one card: FSRS state plus the three facts scoring needs from history. */
export type Entry = {
  due: number; stab: number; diff: number; reps: number; lapses: number; state: number;
  last: number; steps: number;
  /** The latest grade was a correct answer. */
  knows: boolean;
  /** First contact was a correct answer: the student already knew it. */
  knewFirst: boolean;
  /** First contact came from the queue, not a self-chosen drill. */
  sampled: boolean;
  /** Outline section index, so scoring never needs the card text. */
  sec: number;
};
export type SubjectProgress = Record<string, Entry>;
export type Progress = Record<string, SubjectProgress>;

/** Stored form: a flat number array per card keeps the progress docs small. */
export type EntryRow = number[];
export const toRow = (e: Entry): EntryRow =>
  [e.due, e.stab, e.diff, e.reps, e.lapses, e.state, e.last, e.steps,
    (e.knows ? 1 : 0) | (e.knewFirst ? 2 : 0) | (e.sampled ? 4 : 0), e.sec];
export const fromRow = (r: EntryRow): Entry => ({
  due: r[0], stab: r[1], diff: r[2], reps: r[3], lapses: r[4], state: r[5], last: r[6], steps: r[7],
  knows: !!(r[8] & 1), knewFirst: !!(r[8] & 2), sampled: !!(r[8] & 4), sec: r[9],
});

export type FeedItem = { id: string; ts: number; kind: string; text: string; name: string | null };
