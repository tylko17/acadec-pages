// Upload the cards (and codes, on first run) to Firestore with the admin SDK.
//
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json \
//   TEAM_CODE=... CAPTAIN_CODE=... node scripts/seed.mjs [--decks ../decks]
//
// Reads ../decks/*.json (the Resource Guide extraction; gitignored, and it goes
// to Firestore only) and falls back to the hand-written placeholders for any
// subject without a deck. Safe to re-run: a subject whose content hash is
// unchanged is skipped, and chunk docs a shrunk deck no longer needs are deleted.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const decksDir = path.resolve(here, args.includes("--decks") ? args[args.indexOf("--decks") + 1] : "../../decks");
const CHUNK_BYTES = 600_000; // Firestore's limit is 1 MiB per doc; leave room for overhead.

const DRY = args.includes("--dry"); // gather and chunk, print sizes, write nothing
if (!DRY) initializeApp({ credential: applicationDefault() });
const db = DRY ? null : getFirestore();

const slugOf = (s) => s.toLowerCase().replace(/\W+/g, "-");

// ---- gather subjects -------------------------------------------------------
const subjects = {}; // subject -> { sections: [{name, weight?, extracted}], cards: [...] }

if (fs.existsSync(decksDir)) {
  for (const f of fs.readdirSync(decksDir).filter((f) => f.endsWith(".json")).sort()) {
    const deck = JSON.parse(fs.readFileSync(path.join(decksDir, f), "utf8"));
    const names = [];
    for (const c of deck.cards) if (!names.includes(c.section)) names.push(c.section);
    subjects[deck.subject] = {
      sections: names.map((name) => ({ name, extracted: true, ...(deck.weights?.[name] !== undefined && { weight: deck.weights[name] }) })),
      cards: deck.cards.map((c) => ({
        id: c.id, sec: names.indexOf(c.section), prompt: c.prompt, answer: c.answer,
        ...(c.page != null && { page: c.page }), ...(c.priority != null && { pr: c.priority }),
        ...(c.source && { src: { where: c.source.where, before: c.source.before, text: c.source.text, after: c.source.after } }),
      })),
    };
  }
  console.log(`decks: ${Object.keys(subjects).join(", ") || "(none)"}`);
} else {
  console.log(`no decks dir at ${decksDir}; using placeholders only`);
}

const placeholders = JSON.parse(fs.readFileSync(path.join(here, "placeholders.json"), "utf8"));
for (const subject of [...new Set(placeholders.map((c) => c[0]))]) {
  if (subjects[subject]) continue;
  const rows = placeholders.filter((c) => c[0] === subject);
  const names = [...new Set(rows.map((c) => c[1]))];
  subjects[subject] = {
    sections: names.map((name) => ({ name, extracted: false })),
    cards: rows.map((c, i) => ({ id: `p-${slugOf(subject)}-${i}`, sec: names.indexOf(c[1]), prompt: c[2], answer: c[3] })),
  };
  console.log(`placeholders: ${subject} (${rows.length} cards)`);
}

// ---- write -----------------------------------------------------------------
const indexRef = DRY ? null : db.doc("deck/_index");
const existing = DRY ? {} : (await indexRef.get()).data()?.subjects ?? {};
const outline = {};

for (const [subject, s] of Object.entries(subjects)) {
  const slug = slugOf(subject);
  const version = crypto.createHash("sha256").update(JSON.stringify(s)).digest("hex").slice(0, 10);
  const sections = s.sections.map((sec, i) => ({ ...sec, cards: s.cards.filter((c) => c.sec === i).length }));

  const chunks = [];
  let cur = [], size = 0;
  for (const c of s.cards) {
    const n = Buffer.byteLength(JSON.stringify(c));
    if (size + n > CHUNK_BYTES && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(c); size += n;
  }
  if (cur.length) chunks.push(cur);

  outline[subject] = { slug, version, chunks: chunks.length, sections };
  if (DRY) {
    const sizes = chunks.map((c) => Buffer.byteLength(JSON.stringify({ json: JSON.stringify(c) })));
    console.log(`${subject}: ${s.cards.length} cards, ${chunks.length} chunk(s), largest ${Math.max(...sizes)} bytes, sections ${sections.map((x) => x.cards).join("/")}`);
    continue;
  }
  if (existing[subject]?.version === version) { console.log(`${subject}: unchanged (${version})`); continue; }

  for (let i = 0; i < chunks.length; i++) await db.doc(`deck/${slug}_${i}`).set({ json: JSON.stringify(chunks[i]) }); // a string, not an array of maps: see firestore.ts
  for (let i = chunks.length; i < (existing[subject]?.chunks ?? 0); i++) await db.doc(`deck/${slug}_${i}`).delete();
  console.log(`${subject}: ${s.cards.length} cards in ${chunks.length} chunk(s), version ${version}`);
}
if (DRY) { console.log("dry run: nothing written"); process.exit(0); }
await indexRef.set({ subjects: outline });

// ---- codes + config (only when absent, so re-seeding never changes them) ----
const secretsRef = db.doc("private/secrets");
if (!(await secretsRef.get()).exists) {
  const teamCode = process.env.TEAM_CODE, captainCode = process.env.CAPTAIN_CODE;
  if (!teamCode || !captainCode) {
    console.error("First run: set TEAM_CODE and CAPTAIN_CODE so there's something to unlock the app with.");
    process.exit(1);
  }
  await secretsRef.set({ teamCode, captainCode });
  console.log("wrote private/secrets");
}
const cfgRef = db.doc("config/team");
if (!(await cfgRef.get()).exists) { await cfgRef.set({ competitionDate: "2026-11-07" }); console.log("wrote config/team"); }
console.log("done");
