import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Config } from "./config.js";

/**
 * Admin SDK with the service account from CRED. Without one (emulators only: FIRESTORE_EMULATOR_HOST /
 * FIREBASE_AUTH_EMULATOR_HOST set) it needs no credential.
 */
export function initFirebase(config: Config) {
  const app =
    getApps()[0] ??
    initializeApp({
      projectId: config.projectId,
      ...(config.serviceAccount ? { credential: cert(config.serviceAccount) } : {}),
    });
  const db = getFirestore(app);
  return { app, db, auth: getAuth(app) };
}
