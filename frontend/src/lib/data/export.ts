// Settings → Data & privacy: JSON export / import.
import { cleanImportedGen } from "@calgy/engine/generator";
import { cleanImportedReadings, normaliseMeterState } from "@calgy/engine/meter";
import { normaliseSolar } from "@calgy/engine/solar";
import { cleanImported, DEFAULT_SETTINGS, type Settings } from "@calgy/engine/spend";
import {
  COLLECTIONS, EXPORT_VERSION, ExportFileSchema, exportFileName, type CollectionName, type ExportFile, type UserDoc,
  type UserDocPatch,
} from "@calgy/shared";
import { countDocs, onlyNew, planFromLegacy, uploadDocs, type LocalDocs } from "../migration/migrate";
import { devices } from "./devices";
import { fuelPurchases } from "./fuel-purchases";
import { generators } from "./generators";
import { meterReadings } from "./meter-readings";
import { tokenLoads } from "./token-loads";
import { resetStore } from "./store";
import { getUserDoc, updateUserDoc, userDocReady } from "./user-doc";

const COLS = { devices, meterReadings, tokenLoads, fuelPurchases, generators } as const;

export async function buildExport(uid: string, now = new Date()): Promise<ExportFile> {
  await userDocReady();
  const lists = await Promise.all(COLLECTIONS.map((n) => COLS[n].list(uid)));
  const docs = Object.fromEntries(COLLECTIONS.map((n, i) => [n, lists[i]])) as unknown as Omit<ExportFile, "version" | "exportedAt" | "userDoc">;
  return { version: EXPORT_VERSION, exportedAt: now.toISOString(), userDoc: getUserDoc(), ...docs };
}

/** Download calgy-export-YYYY-MM-DD.json. Returns the number of log docs in it. */
export async function downloadExport(uid: string): Promise<number> {
  const now = new Date();
  const file = await buildExport(uid, now);
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  // Remember when, for the "Last backup" line.
  updateUserDoc({ settings: { lastExport: now.toISOString() } }).catch(() => {});
  return COLLECTIONS.reduce((t, n) => t + file[n].length, 0);
}

/** User-doc fields worth restoring from a file (never uid or timestamps). */
const docPatch = (u: UserDoc): UserDocPatch => ({
  onboarding: u.onboarding,
  household: u.household,
  gridHours: u.gridHours,
  meterProfile: u.meterProfile,
  meterState: u.meterState,
  tariffOverride: u.tariffOverride,
  solar: u.solar,
  settings: { calibrationEnabled: u.settings.calibrationEnabled, shareAnonymousData: u.settings.shareAnonymousData, reminder: u.settings.reminder },
});

export class ImportFormatError extends Error {
  name = "ImportFormatError";
}

/** A v1 export, or a backup from the on-device version of Calgy. */
export function parseImport(text: string, uid: string): { docs: LocalDocs; patch: UserDocPatch } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportFormatError("That file isn't a Calgy export.");
  }
  const v1 = ExportFileSchema.safeParse(raw);
  if (v1.success) {
    const f = v1.data;
    const docs = Object.fromEntries(COLLECTIONS.map((n) => [n, f[n]])) as unknown as LocalDocs;
    return { docs, patch: docPatch(f.userDoc) };
  }
  const d = raw as Record<string, unknown> | null;
  if (d && d.app === "calgy" && Array.isArray(d.entries)) {
    const entries = cleanImported(d.entries);
    const fuelIds = new Set(entries.filter((e) => e.type === "fuel").map((e) => e.id));
    const gen = cleanImportedGen(d.generator, d.fuelPurchases, fuelIds);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...((d.settings as Partial<Settings>) ?? {}), onboarded: true };
    const plan = planFromLegacy(
      {
        entries, settings, hasSettings: true, devices: [], tariffOverride: null,
        solar: d.solarSettings && typeof d.solarSettings === "object" ? normaliseSolar(d.solarSettings) : null,
        generator: gen.generator, purchases: gen.purchases, readings: cleanImportedReadings(d.meterReadings),
        meter: normaliseMeterState(d.meterState), draft: null,
      },
      uid,
    );
    return plan;
  }
  if (raw && typeof raw === "object" && "version" in raw)
    throw new ImportFormatError("This export is from a different version of Calgy, or it's damaged.");
  throw new ImportFormatError("That file isn't a Calgy export.");
}

/** Import: logs whose clientId already exists are skipped; settings go through the API. Needs a connection. */
export async function importExport(uid: string, text: string): Promise<{ imported: number; skipped: number }> {
  const { docs, patch } = parseImport(text, uid);
  const remote = Object.fromEntries(
    await Promise.all(COLLECTIONS.map(async (n) => [n, await COLS[n].ids(uid)] as const)),
  ) as { [K in CollectionName]: Set<string> };
  const fresh = onlyNew(docs, remote);
  await uploadDocs(uid, fresh);
  await updateUserDoc(patch);
  resetStore();
  const imported = countDocs(fresh);
  return { imported, skipped: countDocs(docs) - imported };
}
