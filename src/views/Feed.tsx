import { useEffect, useState } from "react";
import type { Ctx } from "../App";
import { ago } from "../lib/ago";
import type { FeedItem } from "../lib/types";

const ICON: Record<string, string> = { session: "📚", device: "📱", milestone: "🏆" };

export function Feed({ ctx }: { ctx: Ctx }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const load = () => { setItems(null); ctx.backend.feed(40).then(setItems).catch(() => setItems([])); };
  useEffect(load, [ctx.backend]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div className="row"><h1>Activity</h1><span className="grow" /><button onClick={load}>Refresh</button></div>
      {!items && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">Nothing yet. Finish a review session and it shows up here.</p>}
      <ul className="feed">
        {items?.map((e) => (
          <li key={e.id}>
            <span>{ICON[e.kind] ?? "•"}</span>
            <span><b>{e.name ?? "Someone"}</b> {e.text}</span>
            <span className="muted">{ago(e.ts)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
