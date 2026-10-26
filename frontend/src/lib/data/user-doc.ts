// users/{uid}, read-only on the client. Changes go through api.updateMe(). Changes made by screens
// that work offline (onboarding, light hours, meter state…) are queued here, kept across reloads,
// shown at once, and sent when online.
import {
  applyUserDocPatch, defaultUserDoc, mergeUserDocPatches, UserDocPatchSchema, type UserDoc, type UserDocPatch,
} from "@calgy/shared";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { getApi } from "../api";
import { ApiError, isApiError } from "../api/types";
import { db } from "../firebase";
import { reportWriteError } from "../notify";
import { userDocConverter } from "./converters";
import { createInferredHoursSync } from "./grid-hours";
import { isEmptyPatch } from "./mapping";

export type UserDocState = {
  uid: string;
  /** Remote doc (or the default until it arrives) with any queued changes applied. */
  userDoc: UserDoc;
  /** No real doc yet (session not created, or offline first launch). */
  isDefault: boolean;
  /** Changes made here that the server hasn't confirmed. */
  pending: boolean;
  fromCache: boolean;
};

/** Raw subscription (§7): the converted doc, or null while it doesn't exist. */
export function subscribeUserDoc(
  uid: string,
  cb: (d: UserDoc | null, meta: { fromCache: boolean; hasPendingWrites: boolean }) => void,
  onError?: (e: FirestoreError) => void,
) {
  return onSnapshot(
    doc(db(), "users", uid).withConverter(userDocConverter),
    { includeMetadataChanges: true },
    (s) => cb(s.exists() ? s.data() : null, s.metadata),
    onError,
  );
}

const PENDING_KEY = (uid: string) => `calgy_pending_patch_${uid}`;
const FLUSH_DEBOUNCE_MS = 1500;
const READY_TIMEOUT_MS = 10_000;

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

let uid: string | null = null;
let remote: UserDoc | null = null;
let fromCache = true;
let pending: UserDocPatch | null = null;
let inflight: UserDocPatch | null = null;
/** Settings-screen changes awaiting the server (online only, never persisted). */
let optimistic: UserDocPatch | null = null;
let stop: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let ready: Promise<void> = Promise.resolve();
let markReady: () => void = () => {};
const listeners = new Set<(s: UserDocState) => void>();

function readPending(id: string): UserDocPatch | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY(id));
    if (!raw) return null;
    const r = UserDocPatchSchema.safeParse(JSON.parse(raw));
    return r.success && !isEmptyPatch(r.data) ? r.data : null;
  } catch {
    return null;
  }
}

function writePending() {
  if (!uid) return;
  try {
    const all = inflight && pending ? mergeUserDocPatches(inflight, pending) : (pending ?? inflight);
    if (all) localStorage.setItem(PENDING_KEY(uid), JSON.stringify(all));
    else localStorage.removeItem(PENDING_KEY(uid));
  } catch {
    // storage full / blocked: the queue still works in memory
  }
}

export function getUserDocState(): UserDocState | null {
  if (!uid) return null;
  let d = remote ?? defaultUserDoc(uid);
  for (const p of [inflight, optimistic, pending]) if (p) d = applyUserDocPatch(d, p);
  return { uid, userDoc: d, isDefault: !remote, pending: !!(pending || inflight || optimistic), fromCache };
}

/** The doc the screens should use right now. */
export function getUserDoc(): UserDoc {
  const s = getUserDocState();
  if (!s) throw new Error("No signed-in user yet.");
  return s.userDoc;
}

const emit = () => {
  const s = getUserDocState();
  if (s) listeners.forEach((l) => l(s));
};

export function onUserDoc(l: (s: UserDocState) => void) {
  listeners.add(l);
  const s = getUserDocState();
  if (s) l(s);
  return () => {
    listeners.delete(l);
  };
}

/** Resolves once the first snapshot arrived (cache or server), or after a short wait offline. */
export const userDocReady = () => ready;

/** Start following users/{uid}. AuthProvider calls this when the user changes. */
export function startUserDoc(nextUid: string | null) {
  stop?.();
  stop = null;
  clearTimeout(flushTimer);
  inferred.cancel();
  uid = nextUid;
  remote = null;
  fromCache = true;
  inflight = null;
  optimistic = null;
  pending = nextUid ? readPending(nextUid) : null;
  if (!nextUid) return;
  ready = new Promise<void>((r) => {
    markReady = r;
    // Offline with nothing cached, the first snapshot may never come: use defaults quickly.
    setTimeout(r, online() ? READY_TIMEOUT_MS : 800);
  });
  stop = subscribeUserDoc(
    nextUid,
    (d, meta) => {
      remote = d;
      fromCache = meta.fromCache;
      markReady();
      emit();
    },
    (e) => {
      reportWriteError(e);
      markReady();
    },
  );
  window.removeEventListener("online", onOnline);
  window.addEventListener("online", onOnline);
  if (pending) scheduleFlush(0);
  emit();
}

function onOnline() {
  if (pending) scheduleFlush(0);
}

function scheduleFlush(ms = FLUSH_DEBOUNCE_MS) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

/** Send queued changes. Offline (or failing) leaves them queued for the next `online`. */
export async function flush() {
  if (!uid || !pending || inflight || !online()) return;
  const forUid = uid;
  inflight = pending;
  pending = null;
  writePending();
  try {
    const next = await getApi().updateMe(inflight);
    if (uid !== forUid) return;
    remote = next;
    inflight = null;
    writePending();
    emit();
    if (pending) scheduleFlush();
  } catch (e) {
    if (uid !== forUid) return;
    pending = pending ? mergeUserDocPatches(inflight!, pending) : inflight;
    inflight = null;
    writePending();
    if (isApiError(e, "bad_request")) {
      // Never retry a patch the server rejects; drop it so the queue doesn't jam.
      reportWriteError(e);
      pending = null;
      writePending();
      emit();
    }
  }
}

/** Queue a change from a screen that works offline; it shows at once and is sent when online. */
export function queueUserDocPatch(patch: UserDocPatch) {
  if (!uid || isEmptyPatch(patch)) return;
  pending = pending ? mergeUserDocPatches(pending, patch) : patch;
  writePending();
  emit();
  scheduleFlush();
}

/** Change settings now (settings screens, wrapped in OfflineGate). Rejects with `offline` when offline. */
export async function updateUserDoc(patch: UserDocPatch): Promise<UserDoc> {
  if (!online()) throw new ApiError({ code: "offline", message: "Needs a connection." });
  if (!uid) throw new ApiError({ status: 401, code: "unauthenticated" });
  const forUid = uid;
  // Optimistic: show it now, confirm with the server's copy.
  optimistic = optimistic ? mergeUserDocPatches(optimistic, patch) : patch;
  emit();
  try {
    const next = await getApi().updateMe(patch);
    if (uid === forUid) remote = next;
    return next;
  } finally {
    if (uid === forUid) {
      optimistic = null;
      emit();
    }
  }
}

/** Inferred light hours: in memory at once, sent at most every 10s and only when they moved ≥ 0.5h. */
const inferred = createInferredHoursSync({
  current: () => (remote ?? defaultUserDoc(uid ?? "")).gridHours,
  send: (p) => queueUserDocPatch(p),
});
export const scheduleInferredHours = inferred.schedule;
export const latestInferredHours = inferred.latest;

if (typeof window !== "undefined") {
  // Don't lose a debounced change when the tab goes away.
  window.addEventListener("pagehide", () => {
    inferred.flush();
    if (pending) void flush();
  });
}
