import { useEffect, useState, useSyncExternalStore } from "react";
import { createBackend } from "./data";
import type { Backend, AuthState } from "./data/backend";
import { Store, competitionInstant } from "./lib/store";
import type { Config, Outline, Student } from "./lib/types";
import { href, useRoute } from "./route";
import { Gate } from "./views/Gate";
import { PickName } from "./views/PickName";
import { Home } from "./views/Home";
import { Review } from "./views/Review";
import { Team } from "./views/Team";
import { Feed } from "./views/Feed";
import { Captain } from "./views/Captain";

export type Ctx = { backend: Backend; store: Store; student: Student; config: Config; captain: boolean; reload: () => void };

type Boot =
  | { stage: "loading"; note?: string }
  | { stage: "error"; message: string }
  | { stage: "gate"; backend: Backend }
  | { stage: "pick"; backend: Backend; uid: string; captain: boolean }
  | { stage: "ready"; backend: Backend; store: Store; student: Student; config: Config; captain: boolean };

export function App() {
  const [boot, setBoot] = useState<Boot>({ stage: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const backend = await createBackend();
        const auth: AuthState = await backend.authState();
        if (dead) return;
        if (!auth.uid || !auth.member) return setBoot({ stage: "gate", backend });
        const student = await backend.myStudent(auth.uid);
        if (!student) return setBoot({ stage: "pick", backend, uid: auth.uid, captain: auth.captain });
        setBoot({ stage: "loading", note: "Loading your progress…" });
        const [config, outline, progress] = await Promise.all([
          backend.getConfig(), backend.getOutline(), backend.loadProgress(student.id),
        ]);
        if (dead) return;
        const store = new Store(backend, student, outline as Outline, progress, competitionInstant(config.competitionDate));
        setBoot({ stage: "ready", backend, store, student, config, captain: auth.captain });
      } catch (e) {
        if (!dead) setBoot({ stage: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { dead = true; };
  }, [tick]);

  const reload = () => setTick((t) => t + 1);

  if (boot.stage === "loading") return <Center><p className="muted">{boot.note ?? "Loading…"}</p></Center>;
  if (boot.stage === "error") {
    return <Center><h1>Can't reach the server</h1><p className="muted">{boot.message}</p><button onClick={reload}>Try again</button></Center>;
  }
  if (boot.stage === "gate") return <Gate backend={boot.backend} onDone={reload} />;
  if (boot.stage === "pick") return <PickName backend={boot.backend} uid={boot.uid} onDone={reload} />;
  return <Shell ctx={{ ...boot, reload }} />;
}

const Center = ({ children }: { children: React.ReactNode }) => <main className="narrow center">{children}</main>;

function Shell({ ctx }: { ctx: Ctx }) {
  const route = useRoute();
  useSyncExternalStore(ctx.store.subscribe, ctx.store.getVersion);
  const link = (path: string, label: string) => (
    <a href={href(path)} className={route.path === path ? "on" : ""}>{label}</a>
  );

  // Leaving the review screen for any other page ends the study session.
  useEffect(() => { if (route.path !== "/review") void ctx.store.endSession(); }, [route.path, ctx.store]);

  let page: React.ReactNode;
  switch (route.path) {
    case "/review": page = <Review key={route.key} ctx={ctx} route={route} />; break;
    case "/team": page = <Team ctx={ctx} />; break;
    case "/feed": page = <Feed ctx={ctx} />; break;
    case "/captain": page = <Captain ctx={ctx} />; break;
    default: page = <Home ctx={ctx} />;
  }
  return (
    <>
      {ctx.backend.kind === "demo" && <div className="banner">Demo mode: nothing is connected to a server. Data stays in this browser.</div>}
      <nav className="top">
        <strong>AcDec</strong>
        {link("/", "Home")}{link("/review", "Review")}{link("/team", "Team")}{link("/feed", "Feed")}{link("/captain", "Captain")}
        <span className="grow" />
        <button className="link" onClick={async () => { await ctx.store.flush(); await ctx.backend.unbind(ctx.student.id); ctx.reload(); }}
          title="Release this name so you can pick another">{ctx.student.name} · not me</button>
      </nav>
      <main>{page}</main>
    </>
  );
}
