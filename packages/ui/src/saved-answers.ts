/**
 * Saved answers: a react-query persister that keeps an app's answers in IndexedDB, so a page
 * paints at once from the last visit. Pass it to `PersistQueryClientProvider` as `persister`.
 *
 * Nothing waits on the device for good: a read that has not answered within `restoreMs` (another
 * tab holding a write, a broken store) gives up and the app asks the server, and an aborted or
 * blocked store fails instead of hanging. The provider shows nothing until the restore settles,
 * so a hung read would otherwise leave the app blank. Writes go out at most once a second, as one
 * record kept as an object (no JSON round trip).
 */

/** The shape `@tanstack/react-query-persist-client` expects; kept structural so the kit needs no extra package. */
export interface SavedAnswersPersister<C = unknown> {
  persistClient: (client: C) => void;
  restoreClient: () => Promise<C | undefined>;
  removeClient: () => Promise<void> | void;
}

export interface SavedAnswersOptions {
  /** The IndexedDB database name; one per app. */
  name: string;
  /** How long the first paint waits for the saved answers before asking the server (ms). Default 1500. */
  restoreMs?: number;
  /** How long writes wait to batch (ms). Default 1000. */
  writeMs?: number;
}

const KEY = 'queries';

export function savedAnswers<C = unknown>({
  name,
  restoreMs = 1500,
  writeMs = 1000,
}: SavedAnswersOptions): SavedAnswersPersister<C> {
  // No IndexedDB (a test runner, a locked-down browser): nothing is saved, every load asks the server.
  if (typeof indexedDB === 'undefined')
    return {
      persistClient: () => {},
      restoreClient: async () => undefined,
      removeClient: () => {},
    };

  let db: Promise<IDBDatabase> | undefined;
  const open = () => {
    if (!db)
      db = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('cache');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error(`${name}: saved answers blocked`));
      }).catch((e) => {
        // A failed open is tried again on the next read or write.
        db = undefined;
        throw e;
      });
    return db;
  };
  const run = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest) =>
    open().then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const tx = d.transaction('cache', mode);
          const req = op(tx.objectStore('cache'));
          tx.oncomplete = () => resolve(req.result as T);
          tx.onerror = () => reject(tx.error);
          // An aborted transaction (storage full, the browser gave up) fires only abort, never error.
          tx.onabort = () => reject(tx.error ?? new Error(`${name}: saved answers aborted`));
        }),
    );

  let next: C | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    persistClient: (client) => {
      next = client;
      timer ??= setTimeout(() => {
        timer = undefined;
        void run('readwrite', (s) => s.put(next, KEY)).catch(() => {});
      }, writeMs);
    },
    restoreClient: () =>
      Promise.race([
        run<C | undefined>('readonly', (s) => s.get(KEY)).catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), restoreMs)),
      ]),
    removeClient: () =>
      run<void>('readwrite', (s) => s.delete(KEY)).then(
        () => {},
        () => {},
      ),
  };
}
