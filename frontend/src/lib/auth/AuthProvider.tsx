"use client";

// Anonymous-first auth (§5): sign in anonymously, bootstrap the user doc via the API, follow
// users/{uid}, migrate the old on-device store once, and offer linking to Google / email.
import type { UserDoc } from "@calgy/shared";
import {
  EmailAuthProvider, getRedirectResult, GoogleAuthProvider, isSignInWithEmailLink, linkWithCredential, linkWithPopup,
  linkWithRedirect, onAuthStateChanged, sendSignInLinkToEmail, signInAnonymously, signInWithCredential, signInWithPopup,
  signOut as fbSignOut, type AuthCredential, type User,
} from "firebase/auth";
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getApi, onApiAuthFailure } from "../api";
import { ApiError, isApiError } from "../api/types";
import { env } from "../env";
import { auth, db, PERSISTENCE_NOTICE, probePersistence, resetFirebase } from "../firebase";
import { notify } from "../notify";
import { resetStore } from "../data/store";
import { startSyncWatch } from "../data/sync-state";
import { flush as flushUserDoc, onUserDoc, startUserDoc } from "../data/user-doc";
import { deleteLegacy } from "../migration/legacy-db";
import { runMigration, type Choice } from "../migration/migrate";
import { markAppReady, setCurrentUser, waitForUser } from "./current";
import {
  authCode, clearAppStorage, CONFLICT_CODES, emailLinkUrl, forgetEmail, POPUP_FALLBACK_CODES, recalledEmail,
  rememberEmail,
} from "./linking";

export type AuthStatus = "loading" | "ready" | "error";

/** Linking hit an account that already exists (§5.5). */
export type Conflict = {
  kind: "google" | "email";
  credential: AuthCredential | null;
  email?: string;
  href?: string;
  /** The anonymous user's token, saved before switching accounts. */
  fromIdToken: string;
};

export type EmailLinkResult = "linked" | "signed_in" | "needs_email" | "invalid" | "conflict";

type AuthContextValue = {
  user: User | null;
  uid: string | null;
  isAnonymous: boolean;
  status: AuthStatus;
  /** Why status is "error", for the banner. */
  error: string | null;
  /** First launch and offline: can't create the anonymous user yet. */
  waitingForNetwork: boolean;
  userDoc: UserDoc | null;
  isDefaultDoc: boolean;
  /** Bumps when the account switches (merge), so screens remount and reload. */
  epoch: number;
  linkWithGoogle(): Promise<void>;
  sendEmailLink(email: string): Promise<void>;
  completeEmailLink(email?: string): Promise<EmailLinkResult>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  retrySession(): void;
  conflict: Conflict | null;
  resolveConflict(choice: "merge" | "discard" | "cancel"): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth needs <AuthProvider>");
  return v;
}

const SESSION_AT_KEY = "calgy_session_at";
const SESSION_REFRESH_MS = 12 * 3600e3;
const online = () => navigator.onLine !== false;

/** Runs `fn` the next time the browser comes online. */
function whenOnline(fn: () => void) {
  const h = () => {
    window.removeEventListener("online", h);
    fn();
  };
  window.addEventListener("online", h);
  return () => window.removeEventListener("online", h);
}

/** Clear the local Firestore cache, then reload into a fresh anonymous user. */
async function wipeLocalAndReload() {
  try {
    const d = db();
    await terminate(d);
    await clearIndexedDbPersistence(d);
  } catch (e) {
    // Another tab still has the cache open; the next sign-in replaces it anyway.
    console.warn("Calgy: couldn't clear the offline cache", e);
  }
  resetFirebase();
  // A full reload on purpose: in-memory Firebase/Firestore state must not survive into the next user.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/app");
}

/**
 * POST /v1/session (bootstraps the user doc; sets the cookie in cookie mode). Offline it retries when the
 * connection is back and the same user is still signed in.
 */
async function startSession(
  u: User,
  o: { force?: boolean; isCurrent: () => boolean; onOk: () => void; onError: (msg: string) => void },
): Promise<void> {
  try {
    await getApi().createSession(await u.getIdToken(o.force));
    o.onOk();
    try {
      localStorage.setItem(SESSION_AT_KEY, String(Date.now()));
    } catch {
      // only used for cookie-mode refresh timing
    }
  } catch (e) {
    if (isApiError(e, "offline") || isApiError(e, "timeout")) {
      // App stays usable; try again when the connection is back.
      whenOnline(() => o.isCurrent() && void startSession(u, { ...o, force: false }));
      return;
    }
    console.error("Calgy: session failed", e);
    o.onError("We couldn't reach your account.");
  }
}

export function AuthProvider({
  children,
  renderMigrationDialog,
}: {
  children: ReactNode;
  /** Shown when this device and the account both have data (§10.4). */
  renderMigrationDialog: (answer: (c: Choice) => void) => ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [waitingForNetwork, setWaiting] = useState(false);
  const [userDoc, setUserDoc] = useState<{ doc: UserDoc; isDefault: boolean } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [ask, setAsk] = useState<((c: Choice) => void) | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [epoch, setEpoch] = useState(0);
  const uidRef = useRef<string | null>(null);
  const cookieMode = useRef(false);

  // ——— Session (§5.2 step 2, §5.3) ———

  const createSession = useCallback(
    (u: User, force = false) =>
      startSession(u, {
        force,
        isCurrent: () => uidRef.current === u.uid,
        onOk: () => {
          setError(null);
          setStatus("ready");
        },
        onError: (msg) => {
          setError(msg);
          setStatus("error");
        },
      }),
    [],
  );

  const retrySession = useCallback(() => {
    const u = auth().currentUser;
    if (u) void createSession(u, true);
  }, [createSession]);

  // ——— Bootstrap ———

  useEffect(() => {
    let a: ReturnType<typeof auth>;
    try {
      a = auth();
      cookieMode.current = env().authMode === "cookie";
    } catch (e) {
      // Bad config (missing env) or no browser APIs: nothing to subscribe to, so report it once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    }
    probePersistence().then((ok) => !ok && notify(PERSISTENCE_NOTICE));
    const stopUserDoc = onUserDoc((s) => setUserDoc({ doc: s.userDoc, isDefault: s.isDefault }));
    const stopAuthFail = onApiAuthFailure(() => {
      setError("Your session ended.");
      setStatus("error");
    });

    let cancelOnline: (() => void) | null = null;
    const anon = () => {
      setWaiting(false);
      signInAnonymously(a).catch((e) => {
        if (authCode(e) === "auth/network-request-failed" || !online()) {
          setWaiting(true);
          cancelOnline = whenOnline(anon);
        } else {
          console.error("Calgy: anonymous sign-in failed", e);
          setError("Couldn't start Calgy. Check your connection and try again.");
          setStatus("error");
        }
      });
    };

    // Linking by redirect (mobile browsers without popups) lands back here.
    getRedirectResult(a)
      .then((res) => {
        if (!res) return;
        void createSession(res.user, true);
        notify("Your data is saved to your account.");
        setTick((t) => t + 1);
      })
      .catch(async (e) => {
        if (CONFLICT_CODES.has(authCode(e) ?? "") && a.currentUser) {
          setConflict({
            kind: "google",
            credential: GoogleAuthProvider.credentialFromError(e),
            fromIdToken: await a.currentUser.getIdToken(),
          });
        } else if (authCode(e)) {
          console.error("Calgy: redirect sign-in failed", e);
        }
      });

    const stopAuth = onAuthStateChanged(a, (u) => {
      setCurrentUser(u);
      if (!u) {
        setUser(null);
        anon();
        return;
      }
      const switched = uidRef.current !== u.uid;
      uidRef.current = u.uid;
      // Hook for the emulator integration tests (e2e/), never set against a real project.
      if (env().useEmulators) (window as unknown as { __calgy?: object }).__calgy = { uid: u.uid, isAnonymous: u.isAnonymous };
      setUser(u);
      setWaiting(false);
      if (!switched) return;
      resetStore();
      startUserDoc(u.uid);
      startSyncWatch(u.uid);
      setStatus((s) => (s === "error" ? s : "ready"));
      void createSession(u);
      // Migration (once per uid); the app waits for it only while it runs.
      setMigrating(true);
      runMigration(u.uid, () => new Promise<Choice>((resolve) => setAsk(() => resolve)))
        .then((outcome) => {
          if (outcome === "failed") notify("We couldn't move your data yet. We'll try again.");
          if (outcome === "deferred") whenOnline(() => uidRef.current === u.uid && void runMigration(u.uid, () => Promise.resolve("merge")));
        })
        .finally(() => {
          setAsk(null);
          resetStore();
          setMigrating(false);
          markAppReady(u.uid);
        });
    });

    // Cookie mode: renew the session when the tab comes back after a long time.
    const onVisible = () => {
      if (!cookieMode.current || document.visibilityState !== "visible" || !a.currentUser) return;
      let at = 0;
      try {
        at = Number(localStorage.getItem(SESSION_AT_KEY)) || 0;
      } catch {
        // treat as stale
      }
      if (Date.now() - at > SESSION_REFRESH_MS) void createSession(a.currentUser);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopAuth();
      stopUserDoc();
      stopAuthFail();
      cancelOnline?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [createSession]);

  // ——— Linking (§5.4) ———

  const afterLink = useCallback(
    async (u: User) => {
      if (env().useEmulators) (window as unknown as { __calgy?: object }).__calgy = { uid: u.uid, isAnonymous: u.isAnonymous };
      await createSession(u, true);
      setTick((t) => t + 1); // isAnonymous changed on the same User object
      notify("Your data is saved to your account.");
    },
    [createSession],
  );

  const startConflict = useCallback(async (c: Omit<Conflict, "fromIdToken">) => {
    const anonUser = auth().currentUser;
    if (!anonUser) return;
    setConflict({ ...c, fromIdToken: await anonUser.getIdToken() });
  }, []);

  const linkWithGoogle = useCallback(async () => {
    const u = auth().currentUser;
    if (!u) throw new ApiError({ status: 401, code: "unauthenticated" });
    const provider = new GoogleAuthProvider();
    try {
      const res = await linkWithPopup(u, provider);
      await afterLink(res.user);
    } catch (e) {
      const code = authCode(e) ?? "";
      if (CONFLICT_CODES.has(code))
        return startConflict({ kind: "google", credential: GoogleAuthProvider.credentialFromError(e as never) });
      if (POPUP_FALLBACK_CODES.has(code)) return linkWithRedirect(u, provider);
      throw e;
    }
  }, [afterLink, startConflict]);

  const sendEmailLink = useCallback(async (email: string) => {
    await sendSignInLinkToEmail(auth(), email, { url: emailLinkUrl(), handleCodeInApp: true });
    rememberEmail(email);
  }, []);

  const completeEmailLink = useCallback(
    async (emailArg?: string): Promise<EmailLinkResult> => {
      const a = auth();
      const href = window.location.href;
      if (!isSignInWithEmailLink(a, href)) return "invalid";
      const email = emailArg?.trim() || recalledEmail();
      if (!email) return "needs_email";
      const cred = EmailAuthProvider.credentialWithLink(email, href);
      // Link to this device's (anonymous) user, which may still be starting up on landing.
      const u = a.currentUser ?? (await waitForUser());
      if (u?.isAnonymous) {
        try {
          const res = await linkWithCredential(u, cred);
          forgetEmail();
          await afterLink(res.user);
          return "linked";
        } catch (e) {
          if (CONFLICT_CODES.has(authCode(e) ?? "")) {
            await startConflict({ kind: "email", credential: null, email, href });
            return "conflict";
          }
          throw e;
        }
      }
      const res = await signInWithCredential(a, cred);
      forgetEmail();
      await createSession(res.user, true);
      return "signed_in";
    },
    [afterLink, createSession, startConflict],
  );

  // ——— Merge (§5.5) ———

  const resolveConflict = useCallback(
    async (choice: "merge" | "discard" | "cancel") => {
      const c = conflict;
      if (!c || choice === "cancel") return setConflict(null);
      if (!online()) throw new ApiError({ code: "offline", message: "Needs a connection." });
      // The dev shim can't merge: don't switch accounts and leave data behind.
      if (env().apiMode === "dev") throw new ApiError({ code: "not_available_in_dev" });
      const a = auth();
      // Everything logged on this device must be on the server before the API merges it.
      await flushUserDoc();
      await Promise.race([waitForPendingWrites(db()), new Promise((r) => setTimeout(r, 15_000))]);
      const cred = c.kind === "email" && c.email && c.href ? EmailAuthProvider.credentialWithLink(c.email, c.href) : c.credential;
      const res = cred ? await signInWithCredential(a, cred) : await signInWithPopup(a, new GoogleAuthProvider());
      await getApi().createSession(await res.user.getIdToken(true));
      if (choice === "merge") {
        await getApi().mergeAccount(c.fromIdToken);
        notify("Merged.");
      } else {
        await getApi().discardAnonymous(c.fromIdToken);
        notify("Switched to your account.");
      }
      forgetEmail();
      setConflict(null);
      resetStore();
      setEpoch((n) => n + 1);
    },
    [conflict],
  );

  // ——— Sign out / delete (§5.6, §5.7) ———

  const signOut = useCallback(async () => {
    // Let queued entries reach the account before the local cache is cleared.
    await Promise.race([waitForPendingWrites(db()), new Promise((r) => setTimeout(r, 10_000))]);
    await getApi().logout().catch(() => {});
    await fbSignOut(auth());
    await wipeLocalAndReload();
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!online()) throw new ApiError({ code: "offline", message: "Needs a connection." });
    await getApi().deleteAccount();
    await fbSignOut(auth()).catch(() => {});
    clearAppStorage();
    await deleteLegacy();
    await wipeLocalAndReload();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      uid: user?.uid ?? null,
      isAnonymous: user?.isAnonymous ?? true,
      status: !user ? (status === "error" ? "error" : "loading") : migrating && status === "ready" ? "loading" : status,
      error,
      waitingForNetwork,
      userDoc: userDoc?.doc ?? null,
      isDefaultDoc: userDoc?.isDefault ?? true,
      epoch,
      linkWithGoogle,
      sendEmailLink,
      completeEmailLink,
      signOut,
      deleteAccount,
      retrySession,
      conflict,
      resolveConflict,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isAnonymous lives on the mutable User; tick re-renders
    [user, user?.isAnonymous, status, migrating, error, waitingForNetwork, userDoc, epoch, conflict, linkWithGoogle, sendEmailLink,
      completeEmailLink, signOut, deleteAccount, retrySession, resolveConflict],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {ask && renderMigrationDialog((c) => ask(c))}
    </AuthContext.Provider>
  );
}
