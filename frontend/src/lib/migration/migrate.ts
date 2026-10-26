// One-time move of the old on-device store into Firestore (§10).
import {
  COLLECTIONS, defaultUserDoc, mergeUserDocPatches, type CollectionName, type LogDocs, type UserDocPatch,
} from "@calgy/shared";
import { probePersistence } from "../firebase";
import { devices } from "../data/devices";
import { fuelPurchases } from "../data/fuel-purchases";
import { generators } from "../data/generators";
import {
  deviceToDoc, entryToToken, fuelDocs, generatorToDoc, isEmptyPatch, meterPatch, readingToDoc, settingsPatch,
  type Bare,
} from "../data/mapping";
import { meterReadings } from "../data/meter-readings";
import { tokenLoads } from "../data/token-loads";
import { queueUserDocPatch } from "../data/user-doc";
import { readLegacy, type LegacyData } from "./legacy-db";

export type LocalDocs = { [K in CollectionName]: Bare<LogDocs[K]>[] };
export type Plan = { docs: LocalDocs; patch: UserDocPatch };
export type Decision = "nothing" | "upload" | "ask" | "retry";
/** Both this device and the account have logs: what to keep. */
export type Choice = "merge" | "cloud" | "device";
export type Outcome = "done" | "deferred" | "failed";

const COLS = { devices, meterReadings, tokenLoads, fuelPurchases, generators } as const;

export const MIGRATED_KEY = (uid: string) => `calgy_migrated_${uid}`;
/** Set once the old store was copied to any account, so a later anonymous user doesn't get it again. */
export const LEGACY_DONE_KEY = "calgy_legacy_done";
const COMMIT_WAIT_MS = 20_000;

export function hasLocalData(l: LegacyData | null): l is LegacyData {
  return (
    !!l &&
    (l.entries.length > 0 || l.devices.length > 0 || l.readings.length > 0 || !!l.generator || l.settings.onboarded ||
      l.tariffOverride != null || l.solar != null)
  );
}

/** What to do, given whether this device has old data and whether the account already has logs (null = can't tell). */
export function decideMigration(hasLocal: boolean, remoteHasLogs: boolean | null): Decision {
  if (!hasLocal) return "nothing";
  if (remoteHasLogs == null) return "retry";
  return remoteHasLogs ? "ask" : "upload";
}

/** Old store → docs + user-doc patch, in the same shapes the screens save. */
export function planFromLegacy(l: LegacyData, uid: string): Plan {
  const base = defaultUserDoc(uid);
  let patch: UserDocPatch = l.hasSettings ? settingsPatch(base, l.settings) : {};
  patch = mergeUserDocPatches(patch, meterPatch(base, l.meter));
  if (l.tariffOverride != null) patch.tariffOverride = l.tariffOverride;
  if (l.solar) patch.solar = l.solar as unknown as Record<string, unknown>;
  return {
    docs: {
      devices: l.devices.map(deviceToDoc),
      meterReadings: l.readings.map(readingToDoc),
      tokenLoads: l.entries.filter((e) => e.type === "token").map(entryToToken),
      fuelPurchases: fuelDocs(l.entries, l.purchases),
      generators: l.generator ? [generatorToDoc(l.generator)] : [],
    },
    patch,
  };
}

/** Docs whose id (= clientId) the account doesn't have yet. */
export function onlyNew(docs: LocalDocs, remoteIds: { [K in CollectionName]: Set<string> }): LocalDocs {
  const out = {} as LocalDocs;
  for (const name of COLLECTIONS)
    (out as Record<string, unknown[]>)[name] = (docs[name] as { id: string }[]).filter((d) => !remoteIds[name].has(d.id));
  return out;
}

export const countDocs = (docs: LocalDocs) => COLLECTIONS.reduce((t, n) => t + docs[n].length, 0);

async function remoteHasLogs(uid: string): Promise<boolean | null> {
  const res = await Promise.all(COLLECTIONS.map((n) => COLS[n].any(uid)));
  if (res.some((r) => r === true)) return true;
  return res.some((r) => r === null) ? null : false;
}

const remoteIds = async (uid: string) =>
  Object.fromEntries(await Promise.all(COLLECTIONS.map(async (n) => [n, await COLS[n].ids(uid)] as const))) as {
    [K in CollectionName]: Set<string>;
  };

/** Write docs; resolves once committed locally-and-acked, or after a wait (they stay queued in the cache). */
export async function uploadDocs(uid: string, docs: LocalDocs, deletes?: { [K in CollectionName]?: string[] }) {
  const commits = COLLECTIONS.flatMap((n) => {
    const col = COLS[n] as unknown as {
      applyChanges: (uid: string, u: { doc: unknown; create: boolean }[], d: string[]) => Promise<void>[];
    };
    return col.applyChanges(uid, docs[n].map((doc) => ({ doc, create: true })), deletes?.[n] ?? []);
  });
  const all = Promise.all(commits).then(() => "acked" as const);
  const res = await Promise.race([all, new Promise<"queued">((r) => setTimeout(() => r("queued"), COMMIT_WAIT_MS))]);
  // Queued writes survive a reload only with the persistent cache.
  if (res === "queued" && !(await probePersistence())) throw new Error("Upload not confirmed and no offline cache");
}

function mark(uid: string) {
  try {
    const now = new Date().toISOString();
    localStorage.setItem(MIGRATED_KEY(uid), now);
    localStorage.setItem(LEGACY_DONE_KEY, now);
  } catch {
    // blocked storage: we'll check again next launch (uploads are idempotent)
  }
}

export function alreadyMigrated(uid: string) {
  try {
    return !!(localStorage.getItem(MIGRATED_KEY(uid)) || localStorage.getItem(LEGACY_DONE_KEY));
  } catch {
    return false;
  }
}

/**
 * Run once per uid after auth is ready. The old store is left in place (read-only) for one release.
 * `ask` shows the Merge / Keep cloud / Keep this device dialog when both sides have data.
 */
export async function runMigration(uid: string, ask: () => Promise<Choice>): Promise<Outcome> {
  if (alreadyMigrated(uid)) return "done";
  try {
    const legacy = await readLegacy();
    if (!hasLocalData(legacy)) {
      mark(uid);
      return "done";
    }
    const plan = planFromLegacy(legacy, uid);
    const decision = decideMigration(true, await remoteHasLogs(uid));
    if (decision === "retry") return "deferred";

    if (decision === "upload") {
      await uploadDocs(uid, plan.docs);
      if (!isEmptyPatch(plan.patch)) queueUserDocPatch(plan.patch);
    } else {
      const choice = await ask();
      if (choice === "merge") {
        await uploadDocs(uid, onlyNew(plan.docs, await remoteIds(uid)));
      } else if (choice === "device") {
        const ids = await remoteIds(uid);
        // Docs this device also has are overwritten; the rest are deleted.
        const deletes = Object.fromEntries(
          COLLECTIONS.map((n) => {
            const mine = new Set(plan.docs[n].map((d) => d.id));
            return [n, [...ids[n]].filter((id) => !mine.has(id))];
          }),
        );
        await uploadDocs(uid, plan.docs, deletes);
        if (!isEmptyPatch(plan.patch)) queueUserDocPatch(plan.patch);
      }
    }
    // Carry a half-finished onboarding over too.
    try {
      if (legacy.draft && !localStorage.getItem("calgy_draft_onboarding"))
        localStorage.setItem("calgy_draft_onboarding", JSON.stringify(legacy.draft));
    } catch {
      // drafts are a convenience
    }
    mark(uid);
    return "done";
  } catch (e) {
    console.error("Calgy: migration failed", e);
    return "failed";
  }
}
