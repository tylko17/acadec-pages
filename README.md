# AcDec on GitHub Pages + Firebase

The static version of AcDec for networks that block `fly.dev` (netcheck Option A).
The site is plain files on `*.github.io`; the data lives in Firestore at
`firestore.googleapis.com`, which a school can't block without breaking Classroom and Drive.

```
Chromebook ──▶ tylko17.github.io/<repo>/   (static React app, no server)
           └─▶ firestore.googleapis.com     (Auth + Firestore, gated by firestore.rules)
```

## What's in it

Ported from the Next app, same maths: FSRS scheduling with exam-targeted retention, the
1,000-points-per-subject scoring model (guess floor, unseen-card estimate, outline weights),
streaks with freezes, the Anki-style queue (learning-set cap, likely-tier first), drill mode,
the Scoring Six, activity feed, shared-device sign-in, captain roster tools. Source passage
shows under each card after the reveal.

**Not ported yet:** duels, daily card, practice tests, coach/admin/integrity pages,
scrimmage anchors, card reports and "that wasn't me". The Next app on Fly still has all of them.

## Run it locally (no Firebase needed)

```sh
npm install
npm run dev        # demo backend in localStorage; team code "demo", captain code "captain"
npm test           # scoring/queue/FSRS tests + a full UI flow test
```

With no `VITE_FIREBASE_*` set the app uses hand-written placeholder cards and a banner says so.

## Go live

1. **Firebase console** → create a project (Spark/free plan is enough, see Limits).
   - Build → Authentication → Sign-in method → enable **Anonymous**.
   - Authentication → Settings → Authorized domains → add `tylko17.github.io`.
   - Build → Firestore Database → create (production mode, any region).
   - Project settings → General → Your apps → add a **Web app**; copy its config.
2. **Rules**: paste `firestore.rules` into Firestore → Rules → Publish
   (or `npx firebase-tools deploy --only firestore:rules`).
3. **Cards + codes**: Project settings → Service accounts → generate a key, save it as
   `service-account.json` here (gitignored), then:
   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=service-account.json \
   TEAM_CODE=<what students type> CAPTAIN_CODE=<yours> npm run seed
   ```
   Add `-- --dry` to see chunk sizes without writing. Re-running only uploads subjects
   whose content changed. Codes are written once; change them later in the console
   (`private/secrets`), and changing `teamCode` locks every device out until they re-enter it.
4. **Repo**: push this folder as its own GitHub repo (the workflow expects it at the root).
   Settings → Pages → Source: **GitHub Actions**. Settings → Secrets and variables → Actions →
   **Variables**: `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID`.
5. Open the site, enter the team code, then use **Captain** to paste the roster as `Name, GPA`.

## Copyright

`../decks/*.json` holds Resource Guide text. It is gitignored in the main repo, and **this repo is
public**, so the cards must never be committed here. They go only to Firestore (`deck/*`), whose
rules let signed-in members read them. `scripts/placeholders.json` and `src/demo/placeholders.json`
are the hand-written placeholders and are safe to publish.

## How access works

Anonymous sign-in alone opens nothing. Presenting the team code creates `members/{uid}`, and the
rules check it against `private/secrets`, which no client can read. So the code is never in the
bundle, and anyone reading the page source gets no cards. Students bind to a name as before
(picking it again moves it). The captain code works the same way.

Same trust level as the Fly app: no passwords, self-graded, anyone with the code can pick any name.

## Limits worth knowing

- **Free-tier quota** (Spark): 20k writes and 50k reads a day. Reviews are batched (every 5
  cards, 15 s, or tab hide), so ~30 students at ~300 cards each is roughly 3–4k writes. The
  team/feed pages fetch on open with a Refresh button rather than live listeners, to keep reads down.
- **First review downloads the decks** (~10 MB across subjects), then they're cached in IndexedDB
  per subject version. A school-wifi cold start of "Everything due" is the slowest path.
- **Brute-forcing the code**: rules can't rate-limit. Use a long code, or turn on Firebase App Check.
- A school could still block `tylko17.github.io` or the Google API host. Run `../netcheck` on a
  real Chromebook first; if Firestore + Firebase Auth show ✅ this design works.
- **Unverified:** I've run the app only against the demo backend (unit tests + a jsdom UI flow).
  The Firestore backend and `firestore.rules` have not been exercised against a real project.
