/**
 * Deck text is ~10 MB across all subjects and changes rarely, so it is kept in
 * IndexedDB keyed by "<slug>@<version>". A new version in the outline misses the
 * cache and fetches again; older versions of the same subject are dropped.
 * Every call degrades to "no cache" if IndexedDB is unavailable.
 */
const DB = "acadec-decks";
const STORE = "decks";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result as T | undefined);
      q.onerror = () => res(undefined);
    });
  } catch { return undefined; }
}

export async function cachePut(key: string, value: unknown, slug: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const k of keys.result) if (String(k).startsWith(slug + "@") && k !== key) store.delete(k);
        store.put(value, key);
      };
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* no cache */ }
}
