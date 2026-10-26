// One module per log collection under users/{uid}. Writes are fire-and-forget: the local cache updates
// at once (snapshots show it), the promise only settles when the server acks, so the UI never awaits it.
import { ORDER_BY, TIMESTAMP_FIELDS, type CollectionName, type LogDocs } from "@calgy/shared";
import {
  collection, deleteDoc, deleteField, doc, getDocs, getDocsFromCache, getDocsFromServer, limit, onSnapshot, orderBy,
  query, serverTimestamp, setDoc, Timestamp, where, writeBatch, type FirestoreError, type Query,
} from "firebase/firestore";
import { db } from "../firebase";
import { reportWriteError } from "../notify";
import { isValidDoc, logConverter } from "./converters";
import { newClientId } from "./ids";

/** Firestore allows 500 writes per batch; leave headroom. */
export const BATCH_LIMIT = 450;

export type Snapshot<T> = { data: T[]; hasPendingWrites: boolean; fromCache: boolean };
export type ListOpts = { sinceDays?: number };
/** App fields only; the data layer fills `clientId`, `createdAt` (unless given) and `updatedAt`. */
export type NewDoc<T> = Omit<T, "id" | "clientId" | "updatedAt"> & { id?: string };
/** One write in a batch. `create` sets createdAt; `removedKeys` are deleted from an existing doc. */
export type Upsert<T> = { doc: T; create: boolean; removedKeys?: string[] };

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const LIST_TIMEOUT_MS = 4000;

export function chunk<T>(a: T[], n = BATCH_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

/** Fire a write without waiting for the server; failures surface as a toast. */
export function background(p: Promise<unknown>) {
  p.catch(reportWriteError);
}

export function logCollection<K extends CollectionName>(name: K) {
  type Doc = LogDocs[K];
  const conv = logConverter(name);
  const col = (uid: string) => collection(db(), "users", uid, name).withConverter(conv);
  const ref = (uid: string, id: string) => doc(col(uid), id);

  function ordered(uid: string, opts?: ListOpts): Query<Doc> {
    const order = ORDER_BY[name];
    if (!order) return query(col(uid));
    const { field, dir } = order;
    let q = query(col(uid), orderBy(field, dir));
    if (opts?.sinceDays != null && TIMESTAMP_FIELDS[name].includes(field))
      q = query(q, where(field, ">=", Timestamp.fromMillis(Date.now() - opts.sinceDays * 864e5)));
    return q;
  }

  // A given createdAt (migration/import) is kept only if it's a real time; rules require a timestamp.
  const createdAt = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : serverTimestamp());
  const payload = (d: Record<string, unknown>, create: boolean) => ({
    ...d,
    clientId: d.id,
    updatedAt: serverTimestamp(),
    createdAt: create ? createdAt(d.createdAt) : undefined,
  });

  return {
    name,

    /** Live docs, newest first (devices in My Home order). Includes local unsynced writes. */
    subscribe(uid: string, cb: (s: Snapshot<Doc>) => void, opts?: ListOpts, onError?: (e: FirestoreError) => void) {
      return onSnapshot(
        ordered(uid, opts),
        { includeMetadataChanges: true },
        (snap) =>
          cb({
            data: snap.docs.map((d) => d.data()).filter(isValidDoc) as Doc[],
            hasPendingWrites: snap.metadata.hasPendingWrites,
            fromCache: snap.metadata.fromCache,
          }),
        onError,
      );
    },

    /** Fresh from the server when online (falling back to cache if it's slow), else the local cache. */
    async list(uid: string, opts?: ListOpts): Promise<Doc[]> {
      const q = ordered(uid, opts);
      const fromCache = () => getDocsFromCache(q).catch(() => null);
      let snap = null;
      if (online()) {
        const server = getDocs(q).catch(() => null);
        snap = await Promise.race([server, new Promise<null>((r) => setTimeout(() => r(null), LIST_TIMEOUT_MS))]);
        if (!snap) {
          // Slow network: use the cache if it has anything, else keep waiting for the server.
          const cached = await fromCache();
          snap = cached && !cached.empty ? cached : await server;
        }
      }
      snap ??= await fromCache();
      return snap ? (snap.docs.map((d) => d.data()).filter(isValidDoc) as Doc[]) : [];
    },

    /** Whether the collection has any doc. `null` = can't tell (offline with nothing cached). */
    async any(uid: string): Promise<boolean | null> {
      const q = query(col(uid), limit(1));
      const cached = await getDocsFromCache(q).catch(() => null);
      if (cached && !cached.empty) return true;
      if (!online()) return null;
      const server = await getDocsFromServer(q).catch(() => null);
      return server ? !server.empty : null;
    },

    /** Every doc id on the server (for merge decisions). */
    async ids(uid: string): Promise<Set<string>> {
      const snap = await getDocsFromServer(col(uid));
      return new Set(snap.docs.map((d) => d.id));
    },

    add(uid: string, data: NewDoc<Doc>): string {
      const id = data.id ?? newClientId();
      background(setDoc(ref(uid, id), payload({ ...data, id }, true) as unknown as Doc));
      return id;
    },

    update(uid: string, id: string, patch: Partial<Omit<Doc, "id" | "clientId">>) {
      background(setDoc(ref(uid, id), { ...patch, updatedAt: serverTimestamp() } as unknown as Doc, { merge: true }));
    },

    remove(uid: string, id: string) {
      background(deleteDoc(ref(uid, id)));
    },

    /** Many creates/updates/deletes, in batches of BATCH_LIMIT. Returns the commit promises (for migration/import). */
    applyChanges(uid: string, upserts: Upsert<Doc>[], deletes: string[] = []): Promise<void>[] {
      type Op = { kind: "up"; u: Upsert<Doc> } | { kind: "del"; id: string };
      const ops: Op[] = [...upserts.map((u) => ({ kind: "up" as const, u })), ...deletes.map((id) => ({ kind: "del" as const, id }))];
      return chunk(ops).map((part) => {
        const b = writeBatch(db());
        for (const op of part) {
          if (op.kind === "del") {
            b.delete(ref(uid, op.id));
            continue;
          }
          const d = op.u.doc as Record<string, unknown>;
          const data: Record<string, unknown> = payload(d, op.u.create);
          for (const k of op.u.removedKeys ?? []) data[k] = deleteField();
          b.set(ref(uid, String(d.id)), data as unknown as Doc, { merge: true });
        }
        return b.commit();
      });
    },
  };
}

export type LogCollection<K extends CollectionName> = ReturnType<typeof logCollection<K>>;
