import type { Backend } from "../data/backend";
import { grade as gradeCard, GRADES, type GradeName } from "./fsrs";
import { summary, type Summary } from "./scoring";
import { teamDay, teamTime } from "./time";
import { fromRow, toRow, type DeckCard, type Entry, type EntryRow, type Outline, type Progress, type Student } from "./types";

const FLUSH_EVERY = 5;
const FLUSH_MS = 15_000;

type Pending = Record<string, Record<string, EntryRow>>;

/**
 * One student's progress in memory. Grading is instant and local; writes are
 * batched (every few cards, every 15 s, and when the tab is hidden) because a
 * Firestore write per card would blow the free tier's 20k daily writes across a
 * 30-person team. Unsaved cards are mirrored to localStorage so closing the tab
 * mid-batch loses nothing.
 */
export class Store {
  progress: Progress;
  private pending: Pending = {};
  private unsaved = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private cached: { v: number; s: Summary } | null = null;
  /** Reviews graded since the last session event, and the score when that started. */
  private session = { graded: 0, startTotal: 0 };

  constructor(
    readonly backend: Backend,
    readonly student: Student,
    readonly outline: Outline,
    progress: Progress,
    readonly competition: Date,
  ) {
    this.progress = progress;
    this.recoverPending();
    this.session.startTotal = this.summary().total;
    const hide = () => { if (document.visibilityState === "hidden") void this.flush(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", () => void this.flush());
  }

  // ---- reading -----------------------------------------------------------

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.cached = null; this.listeners.forEach((l) => l()); }

  summary(): Summary {
    if (!this.cached || this.cached.v !== this.version) {
      this.cached = { v: this.version, s: summary(this.progress, this.outline, this.competition) };
    }
    return this.cached.s;
  }

  get sessionGain() { return this.summary().total - this.session.startTotal; }
  get sessionCards() { return this.session.graded; }

  // ---- writing -----------------------------------------------------------

  grade(subject: string, card: DeckCard, g: GradeName, mode: "scheduled" | "drill", now = new Date()): Entry {
    const prev = this.progress[subject]?.[card.id];
    const next = gradeCard(prev, GRADES[g], now, this.competition, card.sec, mode);
    (this.progress[subject] ??= {})[card.id] = next;
    ((this.pending[subject] ??= {}))[card.id] = toRow(next);
    this.session.graded++;
    this.unsaved++;
    this.stash();
    this.bump();
    if (this.unsaved >= FLUSH_EVERY) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), FLUSH_MS);
    return next;
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = this.pending;
    if (!Object.keys(batch).length) return;
    this.pending = {};
    this.unsaved = 0;
    try {
      await Promise.all(Object.entries(batch).map(([subject, rows]) => this.backend.saveProgress(this.student.id, subject, rows)));
      const s = this.summary();
      const reviews = Object.values(this.progress).reduce((t, sp) => t + Object.values(sp).reduce((n, e) => n + e.reps, 0), 0);
      await this.backend.publish(this.student.id, {
        total: s.total, improvement: s.improvement, reviews, lastReview: Date.now(),
        subjects: Object.fromEntries(s.subjects.map((x) => [x.subject, x.score])),
        addDay: teamDay(),
      });
      this.stash(); // nothing left (or only what was graded meanwhile)
    } catch {
      // Offline or rules said no: put the batch back so the next flush retries it.
      for (const [subject, rows] of Object.entries(batch)) this.pending[subject] = { ...rows, ...(this.pending[subject] ?? {}) };
      this.unsaved = 1;
      this.stash();
      if (!this.timer) this.timer = setTimeout(() => void this.flush(), 30_000);
    }
  }

  /** Announce a finished study session to the feed, once, if it was more than a glance. */
  async endSession(): Promise<void> {
    const { graded, startTotal } = this.session;
    if (graded < 5) return;
    await this.flush();
    const gain = this.summary().total - startTotal;
    this.session = { graded: 0, startTotal: this.summary().total };
    const sign = gain > 0 ? ` and gained ${gain.toLocaleString()} points` : "";
    try { await this.backend.postEvent("session", this.student.id, `reviewed ${graded} cards${sign}`); } catch { /* feed is best effort */ }
  }

  // ---- crash safety ------------------------------------------------------

  private key = () => `acadec.pending.${this.student.id}`;
  private stash() {
    try {
      if (Object.keys(this.pending).length) localStorage.setItem(this.key(), JSON.stringify(this.pending));
      else localStorage.removeItem(this.key());
    } catch { /* private window */ }
  }
  private recoverPending() {
    try {
      const raw = localStorage.getItem(this.key());
      if (!raw) return;
      const p = JSON.parse(raw) as Pending;
      for (const [subject, rows] of Object.entries(p)) {
        for (const [id, row] of Object.entries(rows)) {
          // Skip a stale row the server has already moved past.
          const have = this.progress[subject]?.[id];
          if (have && have.last >= row[6]) continue;
          (this.progress[subject] ??= {})[id] = fromRow(row);
          ((this.pending[subject] ??= {}))[id] = row;
          this.unsaved++;
        }
      }
      if (this.unsaved) void this.flush();
    } catch { /* corrupt stash: ignore */ }
  }
}

/** Competition day as an instant: 8am Pacific, whatever the browser's zone. */
export const competitionInstant = (day: string) => new Date(teamTime(day, 8));
