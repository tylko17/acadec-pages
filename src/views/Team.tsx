import { useEffect, useState } from "react";
import type { Ctx } from "../App";
import { standings, TEAM_MAX } from "../lib/scoring";
import { ago } from "../lib/ago";
import { DIVISIONS, DIVISION_LABEL, type Student } from "../lib/types";

export function Team({ ctx }: { ctx: Ctx }) {
  const [students, setStudents] = useState<Student[] | null>(null);
  const load = () => { setStudents(null); ctx.backend.listStudents().then(setStudents).catch(() => setStudents([])); };
  useEffect(load, [ctx.backend]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!students) return <p className="muted">Loading…</p>;
  // This browser knows its own score before the server round-trip does.
  const mine = ctx.store.summary().total;
  const list = students.map((s) => (s.id === ctx.student.id ? { ...s, total: mine } : s));
  const { byDivision, teamTotal } = standings(list);
  const byId = new Map(list.map((s) => [s.id, s]));

  return (
    <div className="stack">
      <div className="row"><h1>Team</h1><span className="grow" /><button onClick={load}>Refresh</button></div>
      <section className="hero">
        <div>
          <div className="big">{teamTotal.toLocaleString()}<small> / {TEAM_MAX.toLocaleString()}</small></div>
          <div className="muted">The Scoring Six: the top two in each division count, as at USAD.</div>
        </div>
      </section>
      {DIVISIONS.map((d) => (
        <section key={d}>
          <h2>{DIVISION_LABEL[d]}</h2>
          <table>
            <tbody>
              {(byDivision.get(d) ?? []).map((s) => (
                <tr key={s.id} className={s.id === ctx.student.id ? "me" : ""}>
                  <td className="rank">{s.rank}</td>
                  <td>{s.name}{s.counts ? <span className="tag">counts</span> : null}</td>
                  <td className="muted">{byId.get(s.id)?.lastReview ? ago(byId.get(s.id)!.lastReview!) : "no reviews yet"}</td>
                  <td className="num">{s.total === null ? "—" : s.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
