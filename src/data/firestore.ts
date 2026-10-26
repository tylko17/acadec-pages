import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence, browserSessionPersistence, getAuth, setPersistence, signInAnonymously, signOut as fbSignOut,
} from "firebase/auth";
import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, setDoc,
  updateDoc, where, writeBatch,
} from "firebase/firestore";
import type { AuthState, Backend } from "./backend";
import type { DeckCard, FeedItem, Outline, Progress, Student, SubjectOutline } from "../lib/types";
import { fromRow } from "../lib/types";
import { cacheGet, cachePut } from "./cache";

/**
 * The real backend. Collections (see firestore.rules for who may touch what):
 *   private/secrets          team + captain codes; no client may read it, only the rules do
 *   members/{uid}            proof that this sign-in presented the team code
 *   captains/{uid}           same, for the captain code
 *   config/team              competition date
 *   students/{id}            roster + the numbers each student publishes
 *   progress/{id}_{slug}     { c: { cardId: "n,n,n…" } } one subject's FSRS state for one student
 *   deck/_index, deck/{slug}_{n}   outline, and the card text in ~700 KB chunks (members only)
 *   events/{auto}            activity feed
 */
export function firestoreBackend(cfg: Record<string, string>): Backend {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const fs = getFirestore(app);

  const uidNow = () => auth.currentUser?.uid ?? null;

  async function isMember(uid: string): Promise<boolean> {
    try { await getDoc(doc(fs, "config", "team")); await getDoc(doc(fs, "members", uid)); return true; }
    catch { return false; }
  }

  return {
    kind: "firestore",

    async authState(): Promise<AuthState> {
      await auth.authStateReady();
      const uid = uidNow();
      if (!uid) return { uid: null, member: false, captain: false };
      const member = await isMember(uid);
      const captain = member && (await getDoc(doc(fs, "captains", uid)).catch(() => null))?.exists() === true;
      return { uid, member, captain };
    },

    async signIn(shared) {
      // A shared school Chromebook keeps the sign-in for this tab only, so the
      // next student to use it isn't silently signed in as the last one.
      await setPersistence(auth, shared ? browserSessionPersistence : browserLocalPersistence);
      return (await signInAnonymously(auth)).user.uid;
    },

    async join(code) {
      const uid = uidNow(); if (!uid) return false;
      try { await setDoc(doc(fs, "members", uid), { code: code.trim().toLowerCase() }); return true; }
      catch { return false; }
    },
    async joinCaptain(code) {
      const uid = uidNow(); if (!uid) return false;
      try { await setDoc(doc(fs, "captains", uid), { code: code.trim().toLowerCase() }); return true; }
      catch { return false; }
    },
    async signOut() { await fbSignOut(auth); },

    async getConfig() {
      const s = await getDoc(doc(fs, "config", "team"));
      return { competitionDate: (s.data()?.competitionDate as string) ?? "2026-11-07" };
    },
    async setConfig(c) { await setDoc(doc(fs, "config", "team"), c, { merge: true }); },

    async listStudents() {
      const snap = await getDocs(collection(fs, "students"));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Student).sort((a, b) => a.name.localeCompare(b.name));
    },
    async myStudent(uid) {
      const snap = await getDocs(query(collection(fs, "students"), where("uid", "==", uid)));
      const d = snap.docs[0];
      return d ? ({ id: d.id, ...d.data() } as Student) : null;
    },
    async claim(studentId, uid) {
      // Release any name this sign-in already holds, then take the new one.
      const mine = await getDocs(query(collection(fs, "students"), where("uid", "==", uid)));
      const b = writeBatch(fs);
      for (const d of mine.docs) if (d.id !== studentId) b.update(d.ref, { uid: null });
      b.update(doc(fs, "students", studentId), { uid, claimedAt: Date.now() });
      await b.commit();
    },
    async unbind(studentId) { await updateDoc(doc(fs, "students", studentId), { uid: null }); },
    async addStudents(rows) {
      const b = writeBatch(fs);
      for (const r of rows) b.set(doc(collection(fs, "students")), { name: r.name, division: r.division, uid: null });
      await b.commit();
    },
    async removeStudent(studentId) {
      await deleteDoc(doc(fs, "students", studentId));
      const snap = await getDocs(query(collection(fs, "progress"), where("studentId", "==", studentId)));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    },

    async getOutline() {
      const s = await getDoc(doc(fs, "deck", "_index"));
      return (s.data()?.subjects ?? {}) as Outline;
    },

    async getDeck(subject: string, o: SubjectOutline): Promise<DeckCard[]> {
      const key = `${o.slug}@${o.version}`;
      const hit = await cacheGet<DeckCard[]>(key);
      if (hit) return hit;
      const chunks = await Promise.all(
        Array.from({ length: o.chunks }, (_, i) => getDoc(doc(fs, "deck", `${o.slug}_${i}`))),
      );
      // Stored as a JSON string: an array of maps would put a Firestore index entry on every field of every card.
      const cards = chunks.flatMap((c) => JSON.parse((c.data()?.json as string) ?? "[]") as DeckCard[]);
      if (cards.length) await cachePut(key, cards, o.slug);
      void subject;
      return cards;
    },

    async loadProgress(studentId): Promise<Progress> {
      const snap = await getDocs(query(collection(fs, "progress"), where("studentId", "==", studentId)));
      const out: Progress = {};
      for (const d of snap.docs) {
        const { subject, c } = d.data() as { subject: string; c: Record<string, string> };
        out[subject] = Object.fromEntries(Object.entries(c ?? {}).map(([id, row]) => [id, fromRow(row.split(",").map(Number))]));
      }
      return out;
    },
    async saveProgress(studentId, subject, rows) {
      // Merge into the map, so one flush touches only the cards that changed.
      const slug = subject.toLowerCase().replace(/\W+/g, "-");
      // Each card is one comma-joined string: a 10-number array per card would blow
      // Firestore's 40,000 index-entries-per-doc limit on a 3,000-card subject.
      const c = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, r.join(",")]));
      await setDoc(doc(fs, "progress", `${studentId}_${slug}`), { studentId, subject, c }, { merge: true });
    },
    async publish(studentId, { addDay, ...patch }) {
      await updateDoc(doc(fs, "students", studentId), { ...patch, ...(addDay ? { days: arrayUnion(addDay) } : {}) });
    },

    async feed(n) {
      const snap = await getDocs(query(collection(fs, "events"), orderBy("ts", "desc"), limit(n)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeedItem);
    },
    async postEvent(kind, studentId, text) {
      let name: string | null = null;
      if (studentId) name = ((await getDoc(doc(fs, "students", studentId))).data()?.name as string) ?? null;
      await addDoc(collection(fs, "events"), { ts: Date.now(), kind, studentId, name, text });
    },
  };
}
