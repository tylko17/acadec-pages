import { useEffect, useState } from "react";
import type { Backend } from "../data/backend";
import { DIVISIONS, DIVISION_LABEL, type Student } from "../lib/types";

export function PickName({ backend, uid, onDone }: { backend: Backend; uid: string; onDone: () => void }) {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => { backend.listStudents().then(setStudents).catch((e) => setErr(String(e))); }, [backend]);

  async function pick(s: Student) {
    if (s.uid && s.uid !== uid && !confirm(`${s.name} is already signed in on another device. Move it to this one?`)) return;
    try {
      await backend.claim(s.id, uid);
      if (s.uid && s.uid !== uid) await backend.postEvent("device", s.id, "moved to a new device");
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  if (!students) return <main className="narrow center"><p className="muted">{err || "Loading roster…"}</p></main>;
  return (
    <main className="narrow">
      <h1>Who are you?</h1>
      <p className="muted">Pick your name. This device stays signed in as you.</p>
      {students.length === 0 && <p>No one is on the roster yet. The captain adds names on the Captain page.</p>}
      {DIVISIONS.map((d) => {
        const list = students.filter((s) => s.division === d);
        return list.length === 0 ? null : (
          <section key={d}>
            <h2>{DIVISION_LABEL[d]}</h2>
            <div className="names">
              {list.map((s) => <button key={s.id} onClick={() => pick(s)}>{s.name}{s.uid ? <small> · signed in elsewhere</small> : null}</button>)}
            </div>
          </section>
        );
      })}
      {err && <p className="bad">{err}</p>}
    </main>
  );
}
