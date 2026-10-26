// ISO string ↔ Timestamp at the Firestore boundary, validated with the shared schemas.
import {
  LOG_SCHEMAS, normaliseUserDoc, TIMESTAMP_FIELDS, type CollectionName, type LogDocs, type UserDoc,
} from "@calgy/shared";
import {
  Timestamp, type DocumentData, type FirestoreDataConverter, type QueryDocumentSnapshot, type SnapshotOptions,
} from "firebase/firestore";

const isTimestamp = (v: unknown): v is Timestamp =>
  v instanceof Timestamp || (!!v && typeof v === "object" && typeof (v as Timestamp).toDate === "function");

/** Listed fields that hold ISO strings become Timestamps; sentinels (serverTimestamp, deleteField) pass through. */
export function encodeTimestamps(data: Record<string, unknown>, fields: readonly string[]): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = fields.includes(k) && typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Timestamp.fromDate(new Date(v)) : v;
  }
  return out;
}

/** Any Timestamp becomes an ISO string (pending server timestamps arrive as estimates). */
export function decodeTimestamps(data: DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = isTimestamp(v) ? v.toDate().toISOString() : v;
  return out;
}

/** Marks a doc that failed validation; list/subscribe drop these. */
export const INVALID = Symbol("invalid");
export const isValidDoc = <T>(d: T): d is Exclude<T, { [INVALID]: true }> =>
  !(d && typeof d === "object" && INVALID in (d as object));

export function decodeLog<K extends CollectionName>(name: K, id: string, data: DocumentData): LogDocs[K] | null {
  const res = LOG_SCHEMAS[name].safeParse({ ...decodeTimestamps(data), id });
  if (!res.success) {
    if (process.env.NODE_ENV !== "production") console.warn(`Calgy: skipped invalid ${name}/${id}`, res.error.issues);
    return null;
  }
  return res.data;
}

const cache = new Map<CollectionName, FirestoreDataConverter<unknown>>();

export function logConverter<K extends CollectionName>(name: K): FirestoreDataConverter<LogDocs[K]> {
  if (!cache.has(name))
    cache.set(name, {
      toFirestore(model: Record<string, unknown>) {
        const rest = { ...model };
        delete rest.id;
        return encodeTimestamps(rest, TIMESTAMP_FIELDS[name]);
      },
      fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions) {
        const data = snap.data({ ...options, serverTimestamps: "estimate" });
        return decodeLog(name, snap.id, data) ?? { [INVALID]: true };
      },
    } as FirestoreDataConverter<unknown>);
  return cache.get(name) as FirestoreDataConverter<LogDocs[K]>;
}

export const USER_DOC_TIMESTAMPS = ["createdAt", "updatedAt", "lastExport"] as const;

/** users/{uid}. Read leniently (missing groups get defaults); writes only happen in the dev shim. */
export const userDocConverter: FirestoreDataConverter<UserDoc> = {
  toFirestore(model) {
    const out = encodeTimestamps(model as Record<string, unknown>, ["createdAt", "updatedAt"]);
    const settings = (model as Partial<UserDoc>).settings;
    if (settings && typeof settings === "object") out.settings = encodeTimestamps(settings as Record<string, unknown>, ["lastExport"]);
    return out;
  },
  fromFirestore(snap, options) {
    const raw = decodeTimestamps(snap.data({ ...options, serverTimestamps: "estimate" }));
    if (raw.settings && typeof raw.settings === "object") raw.settings = decodeTimestamps(raw.settings as DocumentData);
    return normaliseUserDoc(raw, snap.id);
  },
};
