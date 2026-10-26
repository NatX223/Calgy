// The screens' load/save API, backed by Firestore (logs) and the user doc (settings).
// Screens keep their own state and hand over whole lists; saves diff them against what Firestore
// already has and write only the docs that changed, without waiting (offline writes queue locally).
import type { Device } from "@calgy/engine/energy";
import type { FuelPurchase, GeneratorProfile } from "@calgy/engine/generator";
import type { MeterReading, MeterState } from "@calgy/engine/meter";
import type { SolarSettings } from "@calgy/engine/solar";
import type { Entry, Settings } from "@calgy/engine/spend";
import { defaultUserDoc, type CollectionName, type LogDocs } from "@calgy/shared";
import { waitForAppReady } from "../auth/current";
import { background } from "./collection";
import { devices as devicesCol } from "./devices";
import { fuelPurchases as fuelCol } from "./fuel-purchases";
import { generators as generatorsCol } from "./generators";
import {
  deviceToDoc, diffDocs, docToDevice, docToGenerator, docToReading, entryToToken, fuelDocs, fuelToEntry, fuelToPurchase,
  generatorToDoc, meterFromDoc, meterPatch, readingToDoc, same, settingsFromDoc, settingsPatch, solarFromDoc,
  tokenToEntry, type Bare,
} from "./mapping";
import { meterReadings as readingsCol } from "./meter-readings";
import { tokenLoads as tokensCol } from "./token-loads";
import { getUserDoc, getUserDocState, queueUserDocPatch, scheduleInferredHours, userDocReady } from "./user-doc";

const COLS = {
  devices: devicesCol,
  meterReadings: readingsCol,
  tokenLoads: tokensCol,
  fuelPurchases: fuelCol,
  generators: generatorsCol,
} as const;

type Known = { [K in CollectionName]?: Map<string, Bare<LogDocs[K]>> };

let forUid: string | null = null;
/** What Firestore has (as last loaded or written by this tab), per collection. */
let known: Known = {};
/** Latest lists from the screens; fuel docs need both the entries and the gen purchases. */
let local: { entries?: Entry[]; purchases?: FuelPurchase[] } = {};

async function user(): Promise<string> {
  // Waits for auth and the one-time migration, so screens never load half-moved data.
  const u = await waitForAppReady();
  if (u.uid !== forUid) {
    forUid = u.uid;
    known = {};
    local = {};
  }
  return u.uid;
}

/** Forget cached state (sign-out, delete, account switch, import). */
export function resetStore() {
  forUid = null;
  known = {};
  local = {};
}

async function list<K extends CollectionName>(uid: string, name: K): Promise<LogDocs[K][]> {
  const docs = (await COLS[name].list(uid)) as LogDocs[K][];
  (known as Record<string, Map<string, unknown>>)[name] = new Map(docs.map((d) => [d.id, d]));
  return docs;
}

function sync<K extends CollectionName>(name: K, next: Bare<LogDocs[K]>[]) {
  if (!forUid) return;
  const prev = (known[name] ?? new Map()) as Map<string, Bare<LogDocs[K]>>;
  const { upserts, deletes } = diffDocs(prev, next);
  (known as Record<string, Map<string, unknown>>)[name] = new Map(next.map((d) => [d.id, d]));
  if (!upserts.length && !deletes.length) return;
  const col = COLS[name] as unknown as { applyChanges: (uid: string, u: typeof upserts, d: string[]) => Promise<void>[] };
  col.applyChanges(forUid, upserts, deletes).forEach(background);
}

function syncFuel() {
  if (local.entries && local.purchases) sync("fuelPurchases", fuelDocs(local.entries, local.purchases));
}

async function withDoc() {
  await userDocReady();
  return getUserDoc();
}

const logged = <T>(fallback: T) => (err: unknown) => {
  console.error("Calgy: storage unavailable", err);
  return fallback;
};

// ——— Spend log + settings ———

export async function loadSpend(): Promise<{ entries: Entry[]; settings: Settings }> {
  try {
    const uid = await user();
    const [tokens, fuel, u] = await Promise.all([list(uid, "tokenLoads"), list(uid, "fuelPurchases"), withDoc()]);
    const entries = [...tokens.map(tokenToEntry), ...fuel.map(fuelToEntry)];
    local.entries = entries;
    local.purchases ??= fuel.map(fuelToPurchase).filter((p): p is FuelPurchase => !!p);
    return { entries, settings: settingsFromDoc(u) };
  } catch (err) {
    return logged({ entries: [], settings: settingsFromDoc(getUserDocSafe()) })(err);
  }
}

const getUserDocSafe = () => getUserDocState()?.userDoc ?? defaultUserDoc("");

function saveSettings(s: Partial<Settings>) {
  const u = getUserDoc();
  queueUserDocPatch(settingsPatch(u, s, { skipInferred: true }));
  if (s.gridHoursSource === "inferred" && s.gridHours != null)
    scheduleInferredHours({ source: "inferred", value: s.gridHours, inferredRange: s.gridHoursRange ?? null });
}

/** Change a few settings from outside the spend screens (My Home's light-hours and calibration cards). */
export function patchSettings(patch: Partial<Settings>) {
  if (forUid) saveSettings(patch);
}

export function saveSpend(entries: Entry[], settings: Settings) {
  if (!forUid) return;
  local.entries = entries;
  sync("tokenLoads", entries.filter((e) => e.type === "token").map(entryToToken));
  syncFuel();
  saveSettings(settings);
}

// ——— My Home ———

export async function loadHome(): Promise<{ devices: Device[]; tariffOverride: number | null }> {
  try {
    const uid = await user();
    const [docs, u] = await Promise.all([list(uid, "devices"), withDoc()]);
    return { devices: docs.map(docToDevice), tariffOverride: u.tariffOverride };
  } catch (err) {
    return logged({ devices: [] as Device[], tariffOverride: null })(err);
  }
}

export function saveHome(devices: Device[], tariffOverride: number | null) {
  if (!forUid) return;
  sync("devices", devices.map(deviceToDoc));
  if (getUserDoc().tariffOverride !== tariffOverride) queueUserDocPatch({ tariffOverride });
}

// ——— Solar ———

export async function loadSolar(): Promise<SolarSettings> {
  await user().catch(() => null);
  return solarFromDoc(await withDoc());
}

export function saveSolar(settings: SolarSettings) {
  if (!forUid) return;
  const u = getUserDoc();
  if (!same(u.solar, settings) && !same(solarFromDoc(u), settings)) queueUserDocPatch({ solar: settings as unknown as Record<string, unknown> });
}

// ——— Generator ———

export async function loadGen(): Promise<{ generator: GeneratorProfile | null; purchases: FuelPurchase[] }> {
  try {
    const uid = await user();
    const [gens, fuel] = await Promise.all([list(uid, "generators"), list(uid, "fuelPurchases")]);
    const purchases = fuel.map(fuelToPurchase).filter((p): p is FuelPurchase => !!p);
    local.purchases = purchases;
    local.entries ??= fuel.map(fuelToEntry);
    return { generator: gens[0] ? docToGenerator(gens[0]) : null, purchases };
  } catch (err) {
    return logged({ generator: null, purchases: [] as FuelPurchase[] })(err);
  }
}

export function saveGen(generator: GeneratorProfile | null, purchases: FuelPurchase[]) {
  if (!forUid) return;
  sync("generators", generator ? [generatorToDoc(generator)] : []);
  local.purchases = purchases;
  syncFuel();
}

// ——— Meter ———

export async function loadMeter(): Promise<{ readings: MeterReading[]; meter: MeterState }> {
  try {
    const uid = await user();
    const [docs, u] = await Promise.all([list(uid, "meterReadings"), withDoc()]);
    return { readings: docs.map(docToReading), meter: meterFromDoc(u) };
  } catch (err) {
    return logged({ readings: [] as MeterReading[], meter: meterFromDoc(getUserDocSafe()) })(err);
  }
}

export function saveMeter(readings: MeterReading[], meter: MeterState) {
  if (!forUid) return;
  sync("meterReadings", readings.map(readingToDoc));
  queueUserDocPatch(meterPatch(getUserDoc(), meter));
}

// ——— Onboarding drafts (this device only) ———

const DRAFT_PREFIX = "calgy_draft_";

/** Half-finished onboarding answers, so leaving mid-flow resumes at the same step. */
export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T | null) {
  try {
    if (value == null) localStorage.removeItem(DRAFT_PREFIX + key);
    else localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
  } catch {
    // storage blocked: drafts are a convenience
  }
}
