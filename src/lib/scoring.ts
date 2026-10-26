import { forgetting_curve, generatorParameters } from "ts-fsrs";
import { SUBJECTS, type Division, type Outline, type Progress, type Student } from "./types";

// A port of src/lib/scoring.ts (the Next app) that works on in-memory progress
// instead of SQLite. Same model; the scrimmage anchor is not ported.

const PARAMS = generatorParameters().w;
/** Four options, so knowing nothing still scores a quarter of the test. */
const GUESS = 0.25;
/** Share of what a student already knows still known on test day with no review. */
const KNOWN_SURVIVAL = 0.8;
/** Unseen cards are estimated from the student's own hit rate once this many fair first contacts exist. */
export const MIN_SAMPLE = 10;
const SECTION_PRIOR = 5;
const WEIGHT_TRUST_CARDS = 15;

/** A captain-entered outline weight is only trusted once the section has cards to spread it over. */
export const ASSUMED_SUBJECTIVE = { Speech: 800, Interview: 800, Essay: 500 } as const;
export const ASSUMED_SUBJECTIVE_TOTAL = 2100;
export const TOTAL_MAX = 10_000;
export const TEAM_MAX = TOTAL_MAX * 6;

const held = (knowsNow: boolean, knewBefore: boolean, retention: number) =>
  !knowsNow ? 0 : knewBefore ? Math.max(retention, KNOWN_SURVIVAL) : retention;
const heldBefore = (knewBefore: boolean) => (knewBefore ? KNOWN_SURVIVAL : 0);

function retrievabilityOn(stability: number, last: number, target: Date): number {
  const elapsed = Math.max(0, (target.getTime() - last) / 86_400_000);
  return forgetting_curve(PARAMS, elapsed, stability);
}

/** Scoring never looks backwards: past competition day, score the present. */
const scoringTarget = (target: Date, now: number) => (target.getTime() >= now ? target : new Date(now));

export type SectionStat = {
  subject: string; section: string; cards: number; seen: number;
  mastery: number; expected: number; baseline: number;
  sampled: number; untouched: number; weight: number;
};

export function sectionStats(progress: Progress, outline: Outline, target: Date, nowMs = Date.now()): SectionStat[] {
  const at = scoringTarget(target, nowMs);
  const out: SectionStat[] = [];
  for (const subject of SUBJECTS) {
    const o = outline[subject];
    if (!o) continue;
    const stats: SectionStat[] = o.sections.map((s) => ({
      subject, section: s.name, cards: s.cards, seen: 0, mastery: 0, expected: 0, baseline: 0,
      sampled: 0, untouched: 0, weight: 0,
    }));
    const knewSum = stats.map(() => 0);
    for (const e of Object.values(progress[subject] ?? {})) {
      const a = stats[e.sec];
      if (!a) continue; // a card the deck no longer has
      a.seen += 1;
      const retention = retrievabilityOn(e.stab, e.last, at);
      a.mastery += e.knows ? retention : 0;
      a.expected += GUESS + (1 - GUESS) * held(e.knows, e.knewFirst, retention);
      a.baseline += GUESS + (1 - GUESS) * heldBefore(e.knewFirst);
      if (e.sampled) { a.sampled += 1; knewSum[e.sec] += e.knewFirst ? 1 : 0; }
    }
    // Unseen cards sit at the guess floor until the subject has a fair sample.
    stats.forEach((a) => {
      a.untouched = Math.max(0, a.cards - a.seen);
      a.expected += GUESS * a.untouched;
      a.baseline += GUESS * a.untouched;
    });
    const n = stats.reduce((t, s) => t + s.sampled, 0);
    if (n >= MIN_SAMPLE) {
      const subjectRate = knewSum.reduce((t, k) => t + k, 0) / n;
      stats.forEach((s, i) => {
        const rate = (knewSum[i] + SECTION_PRIOR * subjectRate) / (s.sampled + SECTION_PRIOR);
        const lift = s.untouched * (1 - GUESS) * rate * KNOWN_SURVIVAL;
        s.expected += lift;
        s.baseline += lift;
      });
    }
    for (const a of stats) {
      a.mastery = a.cards === 0 ? 0 : a.mastery / a.cards;
      a.expected = a.cards === 0 ? 0 : a.expected / a.cards;
      a.baseline = a.cards === 0 ? 0 : a.baseline / a.cards;
    }

    // Outline weights are all-or-nothing per subject, blended toward card share for tiny sections.
    const totalCards = stats.reduce((t, s) => t + s.cards, 0);
    const explicit = o.sections.map((s) => s.weight);
    const haveOutline = stats.length > 0 && explicit.every((w) => w !== undefined);
    const outlineTotal = haveOutline ? explicit.reduce((t, w) => t + (w as number), 0) : 0;
    stats.forEach((s, i) => {
      const cardShare = totalCards === 0 ? 0 : s.cards / totalCards;
      if (!haveOutline || outlineTotal === 0) { s.weight = cardShare; return; }
      const trust = Math.min(1, s.cards / WEIGHT_TRUST_CARDS);
      s.weight = trust * ((explicit[i] as number) / outlineTotal) + (1 - trust) * cardShare;
    });
    const wsum = stats.reduce((t, s) => t + s.weight, 0);
    for (const s of stats) s.weight = wsum === 0 ? 0 : s.weight / wsum;
    out.push(...stats);
  }
  return out;
}

export type SubjectScore = {
  subject: string; score: number; baseline: number; improvement: number; exact: number;
  seen: number; total: number; sampled: number; goal: number; unlocked: boolean;
  sections: SectionStat[];
};

export type Summary = {
  /** Projected ten-event total, out of 10,000. */
  total: number;
  improvement: number;
  improvementExact: number;
  unlocked: boolean;
  needed: number;
  subjects: SubjectScore[];
};

export function summary(progress: Progress, outline: Outline, target: Date, nowMs = Date.now()): Summary {
  const stats = sectionStats(progress, outline, target, nowMs);
  const subjects: SubjectScore[] = SUBJECTS.map((subject) => {
    const sections = stats.filter((s) => s.subject === subject);
    const empty = sections.length === 0; // a subject with no cards is still on the test: everyone guesses it
    const score = empty ? GUESS * 1000 : Math.round(sections.reduce((t, s) => t + s.expected * s.weight, 0) * 1000);
    const baseline = empty ? score : Math.round(sections.reduce((t, s) => t + s.baseline * s.weight, 0) * 1000);
    const exact = empty ? 0 : sections.reduce((t, s) => t + (s.expected - s.baseline) * s.weight, 0) * 1000;
    const sampled = sections.reduce((t, s) => t + s.sampled, 0);
    const goal = Math.min(MIN_SAMPLE, sampled + sections.reduce((t, s) => t + s.untouched, 0));
    return {
      subject, score, baseline, improvement: score - baseline, exact,
      seen: sections.reduce((t, s) => t + s.seen, 0),
      total: sections.reduce((t, s) => t + s.cards, 0),
      sampled, goal, unlocked: sampled >= goal, sections,
    };
  });
  const needed = subjects.reduce((t, s) => t + Math.max(0, s.goal - s.sampled), 0);
  return {
    total: subjects.reduce((t, s) => t + s.score, 0) + ASSUMED_SUBJECTIVE_TOTAL,
    improvement: subjects.reduce((t, s) => t + s.improvement, 0),
    improvementExact: subjects.reduce((t, s) => t + s.exact, 0),
    unlocked: needed === 0, needed, subjects,
  };
}

export const signed = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString()}`;

export type Standing = { id: string; name: string; division: Division; total: number | null; rank: number; counts: boolean };

/**
 * The Scoring Six: only the top two per division count toward the team total,
 * which is how USAD scores a team. Students who haven't reviewed yet rank last.
 */
export function standings(students: Student[]) {
  const byDivision = new Map<Division, Standing[]>();
  for (const s of students) {
    const list = byDivision.get(s.division) ?? [];
    list.push({ id: s.id, name: s.name, division: s.division, total: s.total ?? null, rank: 0, counts: false });
    byDivision.set(s.division, list);
  }
  for (const list of byDivision.values()) {
    list.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.name.localeCompare(b.name));
    list.forEach((s, i) => { s.rank = i + 1; s.counts = i < 2 && s.total !== null; });
  }
  const teamTotal = [...byDivision.values()].flatMap((l) => l.filter((s) => s.counts)).reduce((t, s) => t + (s.total ?? 0), 0);
  return { byDivision, teamTotal };
}
