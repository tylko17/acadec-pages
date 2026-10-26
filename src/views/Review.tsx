import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ctx } from "../App";
import { previewIntervals, type GradeName } from "../lib/fsrs";
import { newCardSeed, nextCard, type Pick, type Run } from "../lib/queue";
import { signed } from "../lib/scoring";
import { teamDay } from "../lib/time";
import { SUBJECTS, type DeckCard } from "../lib/types";
import { href, type Route } from "../route";

const BUTTONS: { g: GradeName; label: string; cls: string }[] = [
  { g: "again", label: "Again", cls: "again" },
  { g: "hard", label: "Hard", cls: "hard" },
  { g: "good", label: "Good", cls: "good" },
  { g: "easy", label: "Easy", cls: "easy" },
];

export function Review({ ctx, route }: { ctx: Ctx; route: Route }) {
  const { store, student } = ctx;
  const subject = route.params.get("subject") || undefined;
  const secParam = route.params.get("section");
  const section = subject && secParam !== null && secParam !== "" ? Number(secParam) : undefined;
  const mode = route.params.get("mode") === "drill" ? "drill" : "scheduled";

  const run = useMemo<Run>(() => ({
    mode, scope: { subject, section }, seed: newCardSeed(student.id, teamDay()), startedAt: Date.now(),
  }), [mode, subject, section, student.id]);

  const [decks, setDecks] = useState<Record<string, DeckCard[]> | null>(null);
  const [loadNote, setLoadNote] = useState("");
  const [err, setErr] = useState("");
  const done = useRef(new Set<string>());
  const [pick, setPick] = useState<Pick | null | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  // Load the card text for this scope. Cached on the device after the first time.
  useEffect(() => {
    let dead = false;
    (async () => {
      const wanted = subject ? [subject] : SUBJECTS.filter((s) => store.outline[s]);
      const out: Record<string, DeckCard[]> = {};
      let n = 0;
      for (const s of wanted) {
        const o = store.outline[s];
        if (!o) continue;
        setLoadNote(`Loading ${s}… (${++n}/${wanted.length})`);
        out[s] = await ctx.backend.getDeck(s, o);
        if (dead) return;
      }
      setDecks(out);
    })().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    return () => { dead = true; };
  }, [ctx.backend, store, subject]);

  useEffect(() => {
    if (decks && pick === undefined) setPick(nextCard(decks, store.progress, run, done.current));
  }, [decks, pick, run, store]);

  const answer = useCallback((g: GradeName) => {
    if (!pick || !decks) return;
    store.grade(pick.subject, pick.card, g, run.mode);
    done.current.add(pick.card.id);
    setReviewed((n) => n + 1);
    setRevealed(false);
    setPick(nextCard(decks, store.progress, run, done.current));
  }, [pick, decks, store, run]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); if (pick) setRevealed(true); }
      else if (revealed && "1234".includes(e.key) && e.key) answer(BUTTONS[Number(e.key) - 1].g);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [revealed, pick, answer]);

  const label = subject ? (section !== undefined ? `${subject} · ${store.outline[subject]?.sections[section]?.name ?? ""}` : subject) : "Everything due";
  const head = (
    <div className="row">
      <a href={href("/")} className="btn">← Home</a>
      <strong>{label}{mode === "drill" ? " (drill)" : ""}</strong>
      <span className="grow" />
      {reviewed > 0 && <span className={store.sessionGain >= 0 ? "good" : "bad"}>{signed(store.sessionGain)} pts</span>}
      {pick && <span className="muted">{pick.left} left</span>}
    </div>
  );

  if (err) return <div className="stack">{head}<p className="bad">{err}</p></div>;
  if (!decks || pick === undefined) return <div className="stack">{head}<p className="muted">{loadNote || "Loading…"}</p></div>;

  if (pick === null) {
    const next = nextDue(store.progress, subject, section);
    return (
      <div className="stack center">
        {head}
        <h1>{mode === "drill" ? "Drill complete" : "Queue clear"}</h1>
        <p className="muted">
          {reviewed > 0 ? `${reviewed} cards this run. ` : ""}
          {mode === "scheduled" && next ? `Next card is due ${when(next)}.` : ""}
        </p>
        <a className="cta" href={href("/")}>Back home</a>
      </div>
    );
  }

  const { card } = pick;
  const intervals = previewIntervals(pick.entry, new Date(), store.competition);
  const sectionName = store.outline[pick.subject]?.sections[card.sec]?.name;
  return (
    <div className="stack">
      {head}
      <article className="card">
        <div className="muted small">{pick.subject} · {sectionName}{pick.entry ? "" : " · new"}</div>
        <p className="prompt">{card.prompt}</p>
        {revealed ? (
          <>
            <p className="answer">{card.answer}</p>
            {card.src && (
              <blockquote className="source">
                <div className="small muted">{card.src.where}{card.page ? ` · p. ${card.page}` : ""}</div>
                {card.src.before && <span className="muted">{card.src.before} </span>}
                <mark>{card.src.text}</mark>
                {card.src.after && <span className="muted"> {card.src.after}</span>}
              </blockquote>
            )}
          </>
        ) : null}
      </article>
      {revealed ? (
        <div className="grades">
          {BUTTONS.map((b, i) => (
            <button key={b.g} className={`grade ${b.cls}`} onClick={() => answer(b.g)}>
              <span>{b.label}</span><small>{intervals[b.g]} · {i + 1}</small>
            </button>
          ))}
        </div>
      ) : (
        <button className="primary big-btn" onClick={() => setRevealed(true)}>Show answer <small>space</small></button>
      )}
    </div>
  );
}

function nextDue(progress: Ctx["store"]["progress"], subject?: string, section?: number): number | null {
  let best: number | null = null;
  for (const s of subject ? [subject] : SUBJECTS) {
    for (const e of Object.values(progress[s] ?? {})) {
      if (section !== undefined && e.sec !== section) continue;
      if (best === null || e.due < best) best = e.due;
    }
  }
  return best;
}

function when(ts: number): string {
  const m = Math.round((ts - Date.now()) / 60_000);
  if (m <= 1) return "now";
  if (m < 60) return `in ${m} minutes`;
  const h = Math.round(m / 60);
  return h < 24 ? `in ${h} hours` : `in ${Math.round(h / 24)} days`;
}
