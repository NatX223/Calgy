// Is anything saved on this device but not yet on the server? Watches every log collection's snapshot
// metadata (which survives reloads, unlike write promises) plus the user doc's queued changes.
import { COLLECTIONS, type CollectionName } from "@calgy/shared";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { onUserDoc } from "./user-doc";

export type SyncState = { online: boolean; pending: boolean };

const pendingBy = new Map<CollectionName | "userDoc", boolean>();
const listeners = new Set<(s: SyncState) => void>();
let stops: (() => void)[] = [];

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export const getSyncState = (): SyncState => ({ online: isOnline(), pending: [...pendingBy.values()].some(Boolean) });

const emit = () => {
  const s = getSyncState();
  listeners.forEach((l) => l(s));
};

export function onSyncState(l: (s: SyncState) => void) {
  listeners.add(l);
  l(getSyncState());
  return () => {
    listeners.delete(l);
  };
}

export function startSyncWatch(uid: string | null) {
  stops.forEach((s) => s());
  stops = [];
  pendingBy.clear();
  if (!uid) return emit();
  for (const name of COLLECTIONS) {
    stops.push(
      onSnapshot(
        collection(db(), "users", uid, name),
        { includeMetadataChanges: true },
        (snap) => {
          pendingBy.set(name, snap.metadata.hasPendingWrites);
          emit();
        },
        () => pendingBy.set(name, false),
      ),
    );
  }
  stops.push(
    onUserDoc((s) => {
      pendingBy.set("userDoc", s.pending);
      emit();
    }),
  );
  const net = () => emit();
  window.addEventListener("online", net);
  window.addEventListener("offline", net);
  stops.push(() => {
    window.removeEventListener("online", net);
    window.removeEventListener("offline", net);
  });
}
