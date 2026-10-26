// users/{uid} at rest. The client reads it through its own converter (frontend/src/lib/data/converters.ts):
// createdAt, updatedAt and settings.lastExport are Timestamps, everything else is what @calgy/shared says,
// and extra fields are ignored. The server-only fields below ride along on the same doc.
import {
  defaultUserDoc, normaliseUserDoc, type UserDoc, type UserDocPatch,
} from "@calgy/shared";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import type { Identity } from "../deps.js";

export const SCHEMA_VERSION = 1;

/** Fields only the server sets. Clients can't patch them (UserDocPatchSchema is strict). */
export type ServerMeta = Identity & {
  schemaVersion: number;
  /** First time the account stopped being anonymous. */
  linkedAt: string | null;
  /** When gridHours last changed through the API. */
  gridHoursUpdatedAt: string | null;
  reminderLastSentAt: string | null;
};

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const iso = (v: unknown): string | null =>
  v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !(v instanceof Timestamp) ? (v as Record<string, unknown>) : {});

export function newMeta(identity: Identity): ServerMeta {
  return { ...identity, schemaVersion: SCHEMA_VERSION, linkedAt: null, gridHoursUpdatedAt: null, reminderLastSentAt: null };
}

export function encodeUserDoc(doc: UserDoc, meta: ServerMeta): DocumentData {
  const { reminder, lastExport, ...settings } = doc.settings;
  return {
    schemaVersion: meta.schemaVersion,
    uid: doc.uid,
    createdAt: ts(doc.createdAt),
    updatedAt: ts(doc.updatedAt),
    isAnonymous: meta.isAnonymous,
    authProviders: meta.authProviders,
    linkedAt: meta.linkedAt ? ts(meta.linkedAt) : null,
    onboarding: doc.onboarding,
    household: doc.household,
    gridHours: { ...doc.gridHours, updatedAt: meta.gridHoursUpdatedAt ? ts(meta.gridHoursUpdatedAt) : null },
    meterProfile: doc.meterProfile,
    meterState: doc.meterState,
    tariffOverride: doc.tariffOverride,
    solar: doc.solar,
    settings: {
      ...settings,
      lastExport: lastExport ? ts(lastExport) : null,
      reminder: { ...reminder, lastSentAt: meta.reminderLastSentAt ? ts(meta.reminderLastSentAt) : null },
    },
  };
}

/** Lenient, like the client: bad or missing groups fall back to defaults. */
export function decodeUserDoc(raw: DocumentData | undefined, uid: string): { doc: UserDoc; meta: ServerMeta } {
  const r = obj(raw);
  const settings = obj(r.settings);
  const doc = normaliseUserDoc(
    {
      ...r,
      createdAt: iso(r.createdAt) ?? undefined,
      updatedAt: iso(r.updatedAt) ?? undefined,
      settings: { ...settings, lastExport: iso(settings.lastExport) },
    },
    uid,
  );
  const providers = Array.isArray(r.authProviders) ? r.authProviders.filter((p): p is string => typeof p === "string") : [];
  return {
    doc,
    meta: {
      schemaVersion: typeof r.schemaVersion === "number" ? r.schemaVersion : SCHEMA_VERSION,
      isAnonymous: typeof r.isAnonymous === "boolean" ? r.isAnonymous : providers.length === 0,
      authProviders: providers,
      linkedAt: iso(r.linkedAt),
      gridHoursUpdatedAt: iso(obj(r.gridHours).updatedAt),
      reminderLastSentAt: iso(obj(settings.reminder).lastSentAt),
    },
  };
}

/** Identity change → new meta (sets linkedAt the first time an anonymous account gets a provider). */
export function syncIdentity(meta: ServerMeta, identity: Identity, now: string): ServerMeta {
  const linkedAt = meta.linkedAt ?? (meta.isAnonymous && !identity.isAnonymous ? now : null);
  return { ...meta, ...identity, linkedAt };
}

export const sameIdentity = (a: Identity, b: Identity) =>
  a.isAnonymous === b.isAnonymous && a.authProviders.join() === b.authProviders.join();

const json = (v: unknown) => JSON.stringify(v);

/**
 * Merge (§9.5): what the anonymous doc should add to the account's doc. The account's doc was usually
 * just created by POST /v1/session, so "lacks a value" means "still has the default". The account wins
 * wherever it has its own value. Light hours and the reminder move as a unit; data-sharing consent and
 * export time never move.
 */
export function fillFromAnonymous(target: UserDoc, source: UserDoc): UserDocPatch {
  const def = defaultUserDoc(target.uid);
  const patch: Record<string, unknown> = {};
  const take = (cur: unknown, dflt: unknown, from: unknown) => json(cur) === json(dflt) && json(from) !== json(dflt);

  for (const g of ["onboarding", "household", "meterProfile", "meterState"] as const) {
    const fields: Record<string, unknown> = {};
    for (const k of Object.keys(def[g]) as (keyof (typeof def)[typeof g])[]) {
      if (take(target[g][k], def[g][k], source[g][k])) fields[k as string] = source[g][k];
    }
    if (Object.keys(fields).length) patch[g] = fields;
  }
  // A finished onboarding brings its power source with it, even if the account's source was set.
  if (!target.onboarding.completed && source.onboarding.completed) patch.onboarding = { ...source.onboarding };

  if (take(target.gridHours, def.gridHours, source.gridHours)) patch.gridHours = source.gridHours;
  if (target.tariffOverride == null && source.tariffOverride != null) patch.tariffOverride = source.tariffOverride;
  if (target.solar == null && source.solar != null) patch.solar = source.solar;

  const settings: Record<string, unknown> = {};
  if (take(target.settings.calibrationEnabled, def.settings.calibrationEnabled, source.settings.calibrationEnabled))
    settings.calibrationEnabled = source.settings.calibrationEnabled;
  if (take(target.settings.reminder, def.settings.reminder, source.settings.reminder)) settings.reminder = source.settings.reminder;
  if (Object.keys(settings).length) patch.settings = settings;

  return patch as UserDocPatch;
}
