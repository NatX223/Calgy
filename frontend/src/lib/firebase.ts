// Firebase for the browser only. Import from client components; never during prerender.
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, initializeAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { env } from "./env";

type Firebase = { app: FirebaseApp; auth: Auth; db: Firestore; persistence: "indexeddb" | "memory" };

let instance: Firebase | null = null;
/** Set when the offline cache couldn't be enabled (e.g. private browsing); the UI says so once. */
export const PERSISTENCE_NOTICE = "Offline saving isn't available in this browser mode.";

function canUseIndexedDb() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function init(): Firebase {
  if (typeof window === "undefined") throw new Error("Firebase is client-only.");
  const cfg = env();
  const app = getApps()[0] ?? initializeApp(cfg.firebase);

  const auth = initializeAuth(app, { persistence: browserLocalPersistence });

  let db: Firestore;
  let persistence: Firebase["persistence"] = "indexeddb";
  try {
    if (!canUseIndexedDb()) throw new Error("IndexedDB unavailable");
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
  } catch {
    persistence = "memory";
    db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  }

  if (cfg.useEmulators) {
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "localhost", 8080);
  }
  return { app, auth, db, persistence };
}

/**
 * Whether the offline cache really works. Firestore falls back to memory on its own when IndexedDB
 * can't be opened (Firefox/Safari private windows), so probe it the same way.
 */
export function probePersistence(): Promise<boolean> {
  if (firebase().persistence === "memory") return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("calgy-probe");
      req.onsuccess = () => {
        req.result.close();
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export const firebase = () => (instance ??= init());
export const auth = () => firebase().auth;
export const db = () => firebase().db;

/** After terminate(): the next call builds a fresh Firestore (used by sign-out / delete before reload). */
export const resetFirebase = () => {
  instance = null;
};
