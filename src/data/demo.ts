import placeholders from "../demo/placeholders.json";
import type { Backend, AuthState } from "./backend";
import type { Config, DeckCard, EntryRow, FeedItem, Outline, Progress, Student } from "../lib/types";
import { fromRow } from "../lib/types";

/**
 * A localStorage stand-in for Firestore, so the app runs with no Firebase
 * project: `npm run dev` with no VITE_FIREBASE_* set. One browser only; nothing
 * is shared. Cards are the hand-written placeholders, never Resource Guide text.
 */
const KEY = "acadec.demo.v1";
const TEAM_CODE = "demo";
const CAPTAIN_CODE = "captain";

type Db = {
  uid: string | null; member: boolean; captain: boolean;
  config: Config; students: Student[];
  progress: Record<string, Record<string, Record<string, EntryRow>>>;
  events: FeedItem[];
};

const ROSTER: [string, Student["division"]][] = [
  ["Avery Chen", "honors"], ["Jordan Patel", "honors"], ["Sam Rivera", "honors"],
  ["Riley Kim", "scholastic"], ["Morgan Diaz", "scholastic"], ["Casey Nguyen", "scholastic"],
  ["Taylor Brooks", "varsity"], ["Jamie Ortiz", "varsity"], ["Drew Hall", "varsity"],
];

function fresh(): Db {
  return {
    uid: null, member: false, captain: false,
    config: { competitionDate: "2026-11-07" },
    students: ROSTER.map(([name, division], i) => ({ id: `s${i}`, name, division })),
    progress: {}, events: [],
  };
}

function load(): Db {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...fresh(), ...JSON.parse(raw) }; } catch { /* private window */ }
  return fresh();
}
let db = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };

// Outline and deck built once from the placeholders.
const subjects = [...new Set((placeholders as string[][]).map((c) => c[0]))];
const outline: Outline = {};
const decks: Record<string, DeckCard[]> = {};
for (const subject of subjects) {
  const rows = (placeholders as string[][]).filter((c) => c[0] === subject);
  const names = [...new Set(rows.map((c) => c[1]))];
  decks[subject] = rows.map((c, i) => ({ id: `p-${subject}-${i}`, sec: names.indexOf(c[1]), prompt: c[2], answer: c[3] }));
  outline[subject] = {
    slug: subject.toLowerCase().replace(/\W+/g, "-"), version: "demo", chunks: 1,
    sections: names.map((name) => ({ name, cards: rows.filter((c) => c[1] === name).length, extracted: false })),
  };
}

export const demoBackend: Backend = {
  kind: "demo",
  async authState(): Promise<AuthState> { return { uid: db.uid, member: db.member, captain: db.captain }; },
  async signIn() { db.uid ??= "demo-" + Math.random().toString(36).slice(2, 10); save(); return db.uid; },
  async join(code) { if (code.trim().toLowerCase() !== TEAM_CODE) return false; db.member = true; save(); return true; },
  async joinCaptain(code) { if (code.trim().toLowerCase() !== CAPTAIN_CODE) return false; db.captain = true; save(); return true; },
  async signOut() { db.uid = null; db.member = false; db.captain = false; save(); },

  async getConfig() { return db.config; },
  async setConfig(c) { db.config = c; save(); },

  async listStudents() { return structuredClone(db.students); },
  async myStudent(uid) { return structuredClone(db.students.find((s) => s.uid === uid) ?? null); },
  async claim(id, uid) {
    for (const s of db.students) if (s.uid === uid) s.uid = null;
    const s = db.students.find((x) => x.id === id); if (s) s.uid = uid;
    save();
  },
  async unbind(id) { const s = db.students.find((x) => x.id === id); if (s) s.uid = null; save(); },
  async addStudents(rows) {
    for (const r of rows) db.students.push({ id: "s" + Math.random().toString(36).slice(2, 8), ...r });
    save();
  },
  async removeStudent(id) { db.students = db.students.filter((s) => s.id !== id); delete db.progress[id]; save(); },

  async getOutline() { return outline; },
  async getDeck(subject) { return decks[subject] ?? []; },
  async loadProgress(id): Promise<Progress> {
    const out: Progress = {};
    for (const [subject, rows] of Object.entries(db.progress[id] ?? {})) {
      out[subject] = Object.fromEntries(Object.entries(rows).map(([cid, r]) => [cid, fromRow(r)]));
    }
    return out;
  },
  async saveProgress(id, subject, rows) {
    const mine = ((db.progress[id] ??= {})[subject] ??= {});
    Object.assign(mine, rows);
    save();
  },
  async publish(id, { addDay, ...patch }) {
    const s = db.students.find((x) => x.id === id); if (!s) return;
    Object.assign(s, patch);
    if (addDay && !(s.days ?? []).includes(addDay)) s.days = [...(s.days ?? []), addDay];
    save();
  },

  async feed(limit) { return db.events.slice(0, limit); },
  async postEvent(kind, studentId, text) {
    const name = db.students.find((s) => s.id === studentId)?.name ?? null;
    db.events.unshift({ id: String(Date.now()) + Math.random(), ts: Date.now(), kind, text, name });
    db.events = db.events.slice(0, 100); save();
  },
};

export function resetDemo() { db = fresh(); save(); }
