import { useState } from "react";
import type { Backend } from "../data/backend";

export function Gate({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await backend.signIn(shared);
      if (await backend.join(code)) return onDone();
      setErr("That's not the team code.");
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Couldn't sign in.");
    }
    setBusy(false);
  }

  return (
    <main className="narrow center">
      {backend.kind === "demo" && <div className="banner">Demo mode. The team code is <code>demo</code>.</div>}
      <h1>AcDec</h1>
      <p className="muted">Enter the team code to get in.</p>
      <form onSubmit={submit} className="stack">
        <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Team code" autoCapitalize="off" autoCorrect="off" />
        <label className="check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          This is a shared computer (sign me out when I close the tab)
        </label>
        <button className="primary" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Enter"}</button>
        {err && <p className="bad">{err}</p>}
      </form>
    </main>
  );
}
