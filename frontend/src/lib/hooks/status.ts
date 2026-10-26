"use client";

import type { UserDoc, UserDocPatch } from "@calgy/shared";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getSyncState, onSyncState, type SyncState } from "../data/sync-state";
import { onUserDoc, updateUserDoc, type UserDocState } from "../data/user-doc";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** navigator.onLine, live. Assumed online during prerender. */
export const useOnline = () =>
  useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

export function useSyncState(): SyncState {
  const [s, set] = useState<SyncState>({ online: true, pending: false });
  useEffect(() => onSyncState(set), []);
  return typeof window === "undefined" ? s : { ...s, online: s.online && getSyncState().online };
}

/** The user doc (with this device's queued changes applied) and a guarded `update`. */
export function useUserDoc(): { userDoc: UserDoc | null; isDefault: boolean; pending: boolean; update: (p: UserDocPatch) => Promise<UserDoc> } {
  const [s, set] = useState<UserDocState | null>(null);
  useEffect(() => onUserDoc(set), []);
  const update = useCallback((p: UserDocPatch) => updateUserDoc(p), []);
  return { userDoc: s?.userDoc ?? null, isDefault: s?.isDefault ?? true, pending: s?.pending ?? false, update };
}
