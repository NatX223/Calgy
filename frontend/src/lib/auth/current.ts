// The signed-in Firebase user, for code outside React (API client, data layer).
import type { User } from "firebase/auth";
import type { TokenSource } from "../api/types";

let current: User | null = null;
let waiters: ((u: User | null) => void)[] = [];

/** AuthProvider calls this whenever auth state settles. */
export function setCurrentUser(u: User | null) {
  current = u;
  if (u) {
    waiters.forEach((w) => w(u));
    waiters = [];
  }
}

export const currentUser = () => current;

/** The user, waiting up to `ms` for auth to start (first launch signs in anonymously). */
export function waitForUser(ms = 10_000): Promise<User | null> {
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    const done = (u: User | null) => {
      clearTimeout(t);
      resolve(u);
    };
    const t = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      resolve(null);
    }, ms);
    waiters.push(done);
  });
}

let readyUid: string | null = null;
let readyWaiters: ((u: User) => void)[] = [];

/** Auth resolved and the one-time migration for this user settled: screens may load data. */
export function markAppReady(uid: string) {
  readyUid = uid;
  if (current?.uid !== uid) return;
  const u = current;
  readyWaiters.forEach((w) => w(u));
  readyWaiters = [];
}

/** The user, once the app is ready for them (see markAppReady). */
export function waitForAppReady(): Promise<User> {
  if (current && current.uid === readyUid) return Promise.resolve(current);
  return new Promise((resolve) => readyWaiters.push(resolve));
}

/** ID tokens for the API. The SDK caches and refreshes them; `force` skips the cache after a 401. */
export const firebaseTokens: TokenSource = {
  async getIdToken(force = false) {
    const u = await waitForUser();
    return u ? u.getIdToken(force) : null;
  },
};
