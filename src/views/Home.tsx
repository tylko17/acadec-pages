import type { Ctx } from "../App";
import { href } from "../route";
import { queueCounts } from "../lib/queue";
import { streak } from "../lib/streak";
import { signed, TOTAL_MAX } from "../lib/scoring";
import { SUBJECTS } from "../lib/types";

const FLOOR = 250;

export function Home({ ctx }: { ctx: Ctx }) {
  const { store, student } = ctx;
  const sum = store.summary();
  const counts = queueCounts(store.progress, store.outline);
  const all = SUBJECTS.reduce((t, s) => ({
    new: t.new + (counts[s]?.new ?? 0), learn: t.learn + (counts[s]?.learn ?? 0), due: t.due + (counts[s]?.due ?? 0),
  }), { new: 0, learn: 0, due: 0 });
  const st = streak(student.days);
  const daysLeft = Math.max(0, Math.ceil((store.competition.getTime() - Date.now()) / 86_400_000));

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <div className="big">{sum.total.toLocaleString()}<small> / {TOTAL_MAX.toLocaleString()}</small></div>
          <div className="muted">projected for competition day · {daysLeft} days away</div>
        </div>
        <div className="right">
          <div className={sum.improvement >= 0 ? "good" : "bad"}>{signed(sum.improvement)} from studying</div>
          <div className="muted">{st.length}-day streak{st.studiedToday ? " ✓" : ""}</div>
        </div>
      </section>

      {!sum.unlocked && (
        <p className="note">
          Cards you haven't met count as guesses for now. Meet {sum.needed} more cards in the queue and the
          score starts estimating the rest from how you do.
        </p>
      )}

      <a className="cta" href={href("/review")}>
        Review{all.due + all.learn > 0 ? ` · ${all.due + all.learn} due` : ""}{all.new > 0 ? ` · ${all.new.toLocaleString()} new` : ""}
      </a>

      <section>
        <h2>Subjects</h2>
        {sum.subjects.map((s) => {
          const c = counts[s.subject] ?? { new: 0, learn: 0, due: 0 };
          const o = store.outline[s.subject];
          return (
            <details key={s.subject} className="subject">
              <summary>
                <span className="sname">{s.subject}</span>
                <span className="bar" title={`${s.score} of 1000`}>
                  <i className="base" style={{ width: pct(s.baseline) }} />
                  <i className="gain" style={{ left: pct(s.baseline), width: pct(Math.max(0, s.score - s.baseline)) }} />
                </span>
                <span className="num">{s.score}</span>
              </summary>
              <div className="row">
                <span className="muted">{s.seen.toLocaleString()} of {s.total.toLocaleString()} cards seen · {c.due + c.learn} due · {c.new.toLocaleString()} new</span>
                <span className="grow" />
                <a className="btn" href={href("/review", { subject: s.subject })}>Review</a>
              </div>
              {o?.sections.map((sec, i) => {
                const k = counts[`${s.subject}|${sec.name}`];
                return (
                  <div className="row sec" key={sec.name}>
                    <span>{sec.name}</span>
                    <span className="muted">{k ? `${k.due + k.learn} due · ${k.new} new` : ""}</span>
                    <span className="grow" />
                    <a className="btn" href={href("/review", { subject: s.subject, section: i })}>Queue</a>
                    <a className="btn" href={href("/review", { subject: s.subject, section: i, mode: "drill" })}>Drill</a>
                  </div>
                );
              })}
              <div className="row"><a className="btn" href={href("/review", { subject: s.subject, mode: "drill" })}>Drill whole subject</a></div>
            </details>
          );
        })}
      </section>
    </div>
  );
}

const pct = (score: number) => `${Math.max(0, Math.min(100, ((score - FLOOR) / (1000 - FLOOR)) * 100))}%`;
