import { useEffect, useState } from "react";
import type { Ctx } from "../App";
import { DIVISIONS, DIVISION_LABEL, divisionFor, type Student } from "../lib/types";

export function Captain({ ctx }: { ctx: Ctx }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  if (!ctx.captain) {
    return (
      <form className="stack narrow" onSubmit={async (e) => {
        e.preventDefault();
        if (await ctx.backend.joinCaptain(code)) ctx.reload(); else setErr("That's not the captain code.");
      }}>
        <h1>Captain</h1>
        <p className="muted">Roster, competition date and device resets. Enter the captain code to unlock.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Captain code" autoCapitalize="off" />
        <button className="primary" disabled={!code.trim()}>Unlock</button>
        {err && <p className="bad">{err}</p>}
      </form>
    );
  }
  return <Tools ctx={ctx} />;
}

function Tools({ ctx }: { ctx: Ctx }) {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [roster, setRoster] = useState("");
  const [date, setDate] = useState(ctx.config.competitionDate);
  const [msg, setMsg] = useState("");
  const load = () => ctx.backend.listStudents().then(setStudents);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    // One per line: "Name, GPA". The GPA only picks the division and is never stored.
    const rows = roster.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, gpa] = l.split(",").map((x) => x.trim());
      return { name, division: divisionFor(Number(gpa)) };
    }).filter((r) => r.name);
    if (!rows.length) return;
    const bad = roster.split("\n").filter((l) => l.trim() && !(Number(l.split(",")[1]) >= 0)).length;
    if (bad) return setMsg(`${bad} line(s) have no GPA. Use "Name, 3.8".`);
    await ctx.backend.addStudents(rows);
    setRoster(""); setMsg(`Added ${rows.length}.`); await load();
  }

  return (
    <div className="stack">
      <h1>Captain</h1>
      {msg && <p className="note">{msg}</p>}

      <section className="stack">
        <h2>Add students</h2>
        <textarea rows={5} value={roster} onChange={(e) => setRoster(e.target.value)} placeholder={"Name, GPA\nAvery Chen, 3.9\nJordan Patel, 3.2"} />
        <button onClick={add} disabled={!roster.trim()}>Add to roster</button>
        <p className="muted">GPA sets the division (3.75+ Honors, 3.0+ Scholastic, below Varsity) and is then thrown away.</p>
      </section>

      <section className="stack">
        <h2>Competition date</h2>
        <div className="row">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button onClick={async () => { await ctx.backend.setConfig({ competitionDate: date }); setMsg("Saved. Everyone sees it on their next load."); }}>Save</button>
        </div>
      </section>

      <section>
        <h2>Roster</h2>
        {!students && <p className="muted">Loading…</p>}
        <table><tbody>
          {students?.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td><td className="muted">{DIVISION_LABEL[s.division] ?? s.division}</td>
              <td className="muted">{s.uid ? "signed in" : ""}</td>
              <td className="actions">
                {s.uid && <button className="link" onClick={async () => { await ctx.backend.unbind(s.id); await load(); }}>unbind device</button>}
                <button className="link bad" onClick={async () => { if (confirm(`Remove ${s.name} and their progress?`)) { await ctx.backend.removeStudent(s.id); await load(); } }}>remove</button>
              </td>
            </tr>
          ))}
        </tbody></table>
        <p className="muted">Divisions: {DIVISIONS.map((d) => `${DIVISION_LABEL[d]} ${students?.filter((s) => s.division === d).length ?? 0}`).join(" · ")}</p>
      </section>
      <p className="muted">The team code and captain code live in the Firebase console (private/secrets), so they can't be read from this page.</p>
    </div>
  );
}
