import type { Config, DeckCard, EntryRow, FeedItem, Outline, Progress, Student, SubjectOutline } from "../lib/types";

export type AuthState = { uid: string | null; member: boolean; captain: boolean };

/**
 * Everything the app needs from a server. Two implementations: Firestore (the
 * real one) and a localStorage demo, picked in data/index.ts. The UI never
 * touches Firebase directly.
 */
export interface Backend {
  readonly kind: "firestore" | "demo";

  /** Current sign-in and whether the team code has been accepted. */
  authState(): Promise<AuthState>;
  /** Anonymous sign-in. `shared` keeps it for this tab only (school Chromebooks). */
  signIn(shared: boolean): Promise<string>;
  /** Present the team code. False when it is wrong. */
  join(code: string): Promise<boolean>;
  joinCaptain(code: string): Promise<boolean>;
  signOut(): Promise<void>;

  getConfig(): Promise<Config>;
  setConfig(c: Config): Promise<void>;

  listStudents(): Promise<Student[]>;
  /** The student bound to this sign-in, if any. */
  myStudent(uid: string): Promise<Student | null>;
  /** Bind this device to a student; moves it if another device had it. */
  claim(studentId: string, uid: string): Promise<void>;
  unbind(studentId: string): Promise<void>;
  addStudents(rows: { name: string; division: Student["division"] }[]): Promise<void>;
  removeStudent(studentId: string): Promise<void>;

  getOutline(): Promise<Outline>;
  /** Card text for one subject (cached on the device by the data layer). */
  getDeck(subject: string, o: SubjectOutline): Promise<DeckCard[]>;
  loadProgress(studentId: string): Promise<Progress>;
  /** Merge changed cards into one subject's progress doc. */
  saveProgress(studentId: string, subject: string, rows: Record<string, EntryRow>): Promise<void>;
  /** Publish the headline numbers the team pages read. */
  publish(studentId: string, patch: Partial<Student> & { addDay?: string }): Promise<void>;

  feed(limit: number): Promise<FeedItem[]>;
  postEvent(kind: string, studentId: string | null, text: string): Promise<void>;
}
