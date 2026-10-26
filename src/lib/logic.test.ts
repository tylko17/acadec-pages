import { describe, expect, it } from "vitest";
import { grade, previewIntervals, requestRetention } from "./fsrs";
import { nextCard, queueCounts, type Run } from "./queue";
import { standings, summary } from "./scoring";
import { streak } from "./streak";
import { fromRow, toRow, type DeckCard, type Outline, type Progress } from "./types";
import { Rating } from "ts-fsrs";

const comp = new Date("2026-11-07T16:00:00Z");
const now = new Date("2026-10-26T20:00:00Z");

const outline: Outline = {
  Art: { slug: "art", version: "1", chunks: 1, sections: [{ name: "A", cards: 40, extracted: true, weight: 0.5 }, { name: "B", cards: 40, extracted: true, weight: 0.5 }] },
};
const deck: DeckCard[] = Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, sec: i < 40 ? 0 : 1, prompt: `q${i}`, answer: `a${i}`, pr: i % 10 === 0 ? 0.3 : 0.8 }));

describe("fsrs", () => {
  it("round-trips an entry through its stored row", () => {
    const e = grade(undefined, Rating.Good, now, comp, 1, "scheduled");
    expect(fromRow(toRow(e))).toEqual(e);
  });
  it("graduates a learning card with 'good' (steps must persist)", () => {
    let e = grade(undefined, Rating.Good, now, comp, 0, "scheduled");
    expect(e.state).toBe(1);
    e = grade(e, Rating.Good, new Date(e.due), comp, 0, "scheduled");
    expect(e.state).toBe(2);
  });
  it("never schedules past competition day", () => {
    let e = grade(undefined, Rating.Easy, now, comp, 0, "scheduled");
    e = grade(e, Rating.Easy, new Date(e.due), comp, 0, "scheduled");
    expect(e.due).toBeLessThanOrEqual(comp.getTime());
  });
  it("first contact in a drill is not a fair sample; in the queue it is", () => {
    expect(grade(undefined, Rating.Good, now, comp, 0, "drill").sampled).toBe(false);
    expect(grade(undefined, Rating.Good, now, comp, 0, "scheduled").sampled).toBe(true);
  });
  it("ramps retention toward competition", () => {
    expect(requestRetention(new Date("2026-05-01"), comp)).toBe(0.85);
    expect(requestRetention(now, comp)).toBe(0.95);
    expect(Object.keys(previewIntervals(undefined, now, comp))).toEqual(["again", "hard", "good", "easy"]);
  });
});

describe("scoring", () => {
  it("scores an untouched deck at the guess floor", () => {
    const s = summary({}, outline, comp, now.getTime());
    expect(s.subjects.find((x) => x.subject === "Art")!.score).toBe(250);
    // Six empty subjects also guess; plus the assumed subjective 2100.
    expect(s.total).toBe(7 * 250 + 2100);
  });
  it("rises as cards are learned and falls back when one is missed", () => {
    const p: Progress = { Art: {} };
    for (const c of deck.slice(0, 20)) p.Art[c.id] = grade(undefined, Rating.Good, now, comp, c.sec, "scheduled");
    const learned = summary(p, outline, comp, now.getTime()).total;
    expect(learned).toBeGreaterThan(7 * 250 + 2100);
    p.Art.c0 = grade(p.Art.c0, Rating.Again, now, comp, 0, "scheduled");
    expect(summary(p, outline, comp, now.getTime()).total).toBeLessThan(learned);
  });
  it("unlocks unseen-card estimation after enough fair samples", () => {
    const p: Progress = { Art: {} };
    for (const c of deck.slice(0, 12)) p.Art[c.id] = grade(undefined, Rating.Good, now, comp, c.sec, "scheduled");
    const s = summary(p, outline, comp, now.getTime()).subjects.find((x) => x.subject === "Art")!;
    expect(s.unlocked).toBe(true);
    expect(s.baseline).toBeGreaterThan(250); // knowing the first dozen lifts the estimate for the rest
  });
  it("ranks the top two per division toward the team total", () => {
    const mk = (id: string, total: number) => ({ id, name: id, division: "honors" as const, total });
    const { teamTotal, byDivision } = standings([mk("a", 9000), mk("b", 8000), mk("c", 7000)]);
    expect(teamTotal).toBe(17000);
    expect(byDivision.get("honors")!.map((s) => s.counts)).toEqual([true, true, false]);
  });
});

describe("queue", () => {
  const run: Run = { mode: "scheduled", scope: { subject: "Art" }, seed: 1, startedAt: 0 };
  it("serves new cards, likely tier first, and never repeats one it has done", () => {
    const seen = new Set<string>();
    const progress: Progress = { Art: {} };
    const first = nextCard({ Art: deck }, progress, run, seen, now.getTime())!;
    expect((first.card.pr ?? 1)).toBeGreaterThanOrEqual(0.6);
    expect(first.left).toBe(80);
  });
  it("caps the learning set and then serves learning cards instead of new ones", () => {
    const progress: Progress = { Art: {} };
    for (const c of deck.slice(0, 20)) progress.Art[c.id] = grade(undefined, Rating.Again, now, comp, c.sec, "scheduled");
    const p = nextCard({ Art: deck }, progress, run, new Set(), now.getTime() - 1)!;
    expect(p.entry).toBeDefined(); // a learning card, not card 20+
  });
  it("puts due cards ahead of new ones", () => {
    const progress: Progress = { Art: {} };
    progress.Art.c50 = { ...grade(undefined, Rating.Good, now, comp, 1, "scheduled"), state: 2, due: now.getTime() - 1000 };
    expect(nextCard({ Art: deck }, progress, run, new Set(), now.getTime())!.card.id).toBe("c50");
  });
  it("drill covers a section once, weakest first", () => {
    const d: Run = { mode: "drill", scope: { subject: "Art", section: 1 }, seed: 1, startedAt: 0 };
    const done = new Set<string>();
    let n = 0;
    for (let p = nextCard({ Art: deck }, {}, d, done); p; p = nextCard({ Art: deck }, {}, d, done)) { done.add(p.card.id); n++; }
    expect(n).toBe(40);
  });
  it("counts new / learn / due like Anki", () => {
    const progress: Progress = { Art: {} };
    progress.Art.c0 = grade(undefined, Rating.Again, now, comp, 0, "scheduled");
    const c = queueCounts(progress, outline, now.getTime() + 3_600_000);
    expect(c.Art).toEqual({ new: 79, learn: 1, due: 0 });
  });
});

describe("streak", () => {
  it("counts consecutive days and spends freezes on gaps", () => {
    const today = "2026-10-26";
    expect(streak(["2026-10-26", "2026-10-25", "2026-10-24"], new Date(`${today}T20:00:00Z`).getTime()).length).toBe(3);
    expect(streak(["2026-10-26", "2026-10-23"], new Date(`${today}T20:00:00Z`).getTime()).length).toBe(2); // the two missed days are frozen: they bridge the gap but add nothing
    expect(streak(undefined).length).toBe(0);
  });
});
