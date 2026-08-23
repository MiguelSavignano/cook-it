/**
 * The recipe library, in the browser.
 *
 * This is where your recipes actually live. They are NOT committed to the
 * repository -- the JSON files under src/recipes/ are factory seed, copied
 * in here once on first run and owned by you from then on. Google Drive is
 * the backup and the way they travel between devices.
 *
 * IndexedDB rather than localStorage: these are structured records that can
 * run to a few hundred KB, and localStorage's ~5 MB string budget is shared
 * with everything else the page keeps. Every call degrades to "no library"
 * rather than throwing, because a browser in private mode, or one with site
 * data blocked, must still be able to cook.
 *
 * The server keeps a MIRROR of this (see mirrorToServer below and
 * src/recipe_store.py): it needs one to match speech against your recipes
 * and to resolve a shared /r/<uuid> link for someone else's device. The
 * browser is the owner; the mirror is downstream of it, never the reverse.
 */

import { apiUrl, type Recipe } from '../api';

const DB_NAME = 'cookit';
const DB_VERSION = 1;
const STORE = 'recipes';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // storage blocked outright
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'uuid' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Firefox in private mode neither resolves nor errors on a blocked open.
    setTimeout(() => resolve(null), 3000);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = work(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function getAll(): Promise<Recipe[]> {
  return (await run<Recipe[]>('readonly', (s) => s.getAll())) ?? [];
}

export async function get(uuid: string): Promise<Recipe | null> {
  return (await run<Recipe>('readonly', (s) => s.get(uuid))) ?? null;
}

export async function put(recipe: Recipe): Promise<void> {
  if (!recipe?.uuid) return;
  await run('readwrite', (s) => s.put(recipe));
}

export async function putAll(recipes: Recipe[]): Promise<void> {
  for (const recipe of recipes) await put(recipe);
}

export async function remove(uuid: string): Promise<void> {
  await run('readwrite', (s) => s.delete(uuid));
}

/** True when this browser has no library yet (first run, or cleared data). */
export async function isEmpty(): Promise<boolean> {
  const count = await run<number>('readonly', (s) => s.count());
  return (count ?? 0) === 0;
}

/**
 * Hands the server a copy so it can match speech and resolve shared links.
 * Failure is not fatal and is not surfaced: the library is still yours and
 * still readable, only those two server-side features go stale.
 */
export async function mirrorToServer(recipes?: Recipe[]): Promise<void> {
  const payload = recipes ?? (await getAll());
  try {
    await fetch(apiUrl('api/library'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipes: payload }),
    });
  } catch (err) {
    console.warn('No se pudo espejar la biblioteca en el servidor', err);
  }
}

/**
 * Called once at start-up. Fills an empty library from the project's seed
 * recipes, then mirrors whatever we ended up with to the server.
 *
 * Returns the library, so the caller can render from it without a second
 * read.
 */
export async function bootstrap(): Promise<Recipe[]> {
  if (await isEmpty()) {
    try {
      const response = await fetch(apiUrl('api/recipes/seed'));
      if (response.ok) await putAll(await response.json());
    } catch (err) {
      console.warn('No se pudieron cargar las recetas de ejemplo', err);
    }
  }
  const library = await getAll();
  void mirrorToServer(library);
  return library;
}
