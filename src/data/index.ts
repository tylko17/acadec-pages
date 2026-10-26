import type { Backend } from "./backend";

const env = import.meta.env;
const cfg = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Firestore when the build has a Firebase config, otherwise the in-browser demo. */
export async function createBackend(): Promise<Backend> {
  if (cfg.apiKey && cfg.projectId) {
    const { firestoreBackend } = await import("./firestore");
    return firestoreBackend(cfg as Record<string, string>);
  }
  return (await import("./demo")).demoBackend;
}
