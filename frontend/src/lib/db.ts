// Local-first storage: everything lives in this browser's IndexedDB.
import Dexie, { type Table } from "dexie";
import { isLegacyDevice, migrateDevice, normaliseDevice, type Device } from "./appliances";
import type { FuelPurchase, GeneratorProfile } from "./generator";
import { localNoon, normaliseMeterState, OB_READING_ID, type MeterReading, type MeterState } from "./meter";
import { normaliseSolar, type SolarSettings } from "./solar";
import { normaliseSettings, type Entry, type Settings } from "./spend";

type Row<T> = { key: string; value: T };
type StoredDevice = Device & { pos: number };
type HomeSettings = { tariffOverride: number | null };

class CalgyDB extends Dexie {
  entries!: Table<Entry, string>;
  settings!: Table<Row<Settings>, string>;
  devices!: Table<StoredDevice, string>;
  homeSettings!: Table<Row<HomeSettings>, string>;
  solarSettings!: Table<Row<SolarSettings>, string>;
  generators!: Table<GeneratorProfile, string>;
  fuelPurchases!: Table<FuelPurchase, string>;
  drafts!: Table<Row<unknown>, string>;
  meterReadings!: Table<MeterReading, string>;
  meterState!: Table<Row<MeterState>, string>;

  constructor() {
    super("calgy");
    this.version(1).stores({
      entries: "id, date, type",
      settings: "key",
      devices: "id, pos",
      homeSettings: "key",
    });
    this.version(2).stores({ solarSettings: "key" });
    this.version(3).stores({ generators: "id", fuelPurchases: "id, purchasedAt", drafts: "key" });
    // v4: devices store label values + usage profile (device ratings spec). Runs once per browser.
    this.version(4)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("devices")
          .toCollection()
          .modify((d: { pos: number }, ref) => {
            if (isLegacyDevice(d)) ref.value = { ...migrateDevice(d), pos: d.pos };
          }),
      );
    // v5: prepaid meter readings + calibration. The old single "units left" and "daily kWh" answers become
    // the first reading and the meter's average.
    this.version(5)
      .stores({ meterReadings: "id, takenAt", meterState: "key" })
      .upgrade(async (tx) => {
        const row = (await tx.table("settings").get("settings")) as Row<Partial<Settings>> | undefined;
        const s = row?.value;
        if (!s) return;
        if ((s.unitsLeft ?? 0) > 0 && s.unitsAsOf)
          await tx.table("meterReadings").put({
            id: OB_READING_ID, unitsLeft: s.unitsLeft!, takenAt: localNoon(s.unitsAsOf), context: "onboarding",
          } satisfies MeterReading);
        if ((s.dailyKwh ?? 0) > 0)
          await tx.table("meterState").put({ key: "meter", value: normaliseMeterState({ profile: { meterDailyAvgKwh: s.dailyKwh } }) });
      });
  }
}

let instance: CalgyDB | null = null;
const db = () => (instance ??= new CalgyDB());

// Serialise writes so a fast sequence of edits lands in order.
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (fn: () => Promise<unknown>) => {
  queue = queue.then(fn).catch((err) => console.error("Calgy: could not save", err));
  return queue;
};

export async function loadSpend(): Promise<{ entries: Entry[]; settings: Settings }> {
  try {
    const [entries, row] = await Promise.all([db().entries.toArray(), db().settings.get("settings")]);
    return { entries, settings: normaliseSettings(row?.value) };
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return { entries: [], settings: normaliseSettings(undefined) };
  }
}

/** Change a few settings from outside the spend screens (My Home's light-hours and calibration cards). */
export function patchSettings(patch: Partial<Settings>) {
  return enqueue(async () => {
    const row = await db().settings.get("settings");
    await db().settings.put({ key: "settings", value: { ...normaliseSettings(row?.value), ...patch } });
  });
}

export function saveSpend(entries: Entry[], settings: Settings) {
  return enqueue(() =>
    db().transaction("rw", db().entries, db().settings, async () => {
      await db().entries.clear();
      await db().entries.bulkPut(entries);
      await db().settings.put({ key: "settings", value: settings });
    }),
  );
}

export async function loadHome(): Promise<{ devices: Device[]; tariffOverride: number | null }> {
  try {
    const [rows, row] = await Promise.all([db().devices.orderBy("pos").toArray(), db().homeSettings.get("home")]);
    const devices = rows.map((r) => {
      const d: Partial<StoredDevice> = { ...r };
      delete d.pos;
      return normaliseDevice(d);
    });
    return { devices, tariffOverride: row?.value.tariffOverride ?? null };
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return { devices: [], tariffOverride: null };
  }
}

export function saveHome(devices: Device[], tariffOverride: number | null) {
  return enqueue(() =>
    db().transaction("rw", db().devices, db().homeSettings, async () => {
      await db().devices.clear();
      await db().devices.bulkPut(devices.map((d, pos) => ({ ...d, pos })));
      await db().homeSettings.put({ key: "home", value: { tariffOverride } });
    }),
  );
}

export async function loadSolar(): Promise<SolarSettings> {
  try {
    return normaliseSolar((await db().solarSettings.get("solar"))?.value);
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return normaliseSolar(null);
  }
}

export function saveSolar(settings: SolarSettings) {
  return enqueue(() => db().solarSettings.put({ key: "solar", value: settings }));
}

export async function loadGen(): Promise<{ generator: GeneratorProfile | null; purchases: FuelPurchase[] }> {
  try {
    const [gens, purchases] = await Promise.all([db().generators.toArray(), db().fuelPurchases.toArray()]);
    return { generator: gens[0] ?? null, purchases };
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return { generator: null, purchases: [] };
  }
}

export function saveGen(generator: GeneratorProfile | null, purchases: FuelPurchase[]) {
  return enqueue(() =>
    db().transaction("rw", db().generators, db().fuelPurchases, async () => {
      await db().generators.clear();
      if (generator) await db().generators.put(generator);
      await db().fuelPurchases.clear();
      await db().fuelPurchases.bulkPut(purchases);
    }),
  );
}

/** Half-finished onboarding answers, so leaving mid-flow resumes at the same step. */
export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    return ((await db().drafts.get(key))?.value as T) ?? null;
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return null;
  }
}

export function saveDraft<T>(key: string, value: T | null) {
  return enqueue(() => (value == null ? db().drafts.delete(key) : db().drafts.put({ key, value })));
}

export async function loadMeter(): Promise<{ readings: MeterReading[]; meter: MeterState }> {
  try {
    const [readings, row] = await Promise.all([db().meterReadings.toArray(), db().meterState.get("meter")]);
    return { readings, meter: normaliseMeterState(row?.value) };
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return { readings: [], meter: normaliseMeterState(null) };
  }
}

export function saveMeter(readings: MeterReading[], meter: MeterState) {
  return enqueue(() =>
    db().transaction("rw", db().meterReadings, db().meterState, async () => {
      await db().meterReadings.clear();
      await db().meterReadings.bulkPut(readings);
      await db().meterState.put({ key: "meter", value: meter });
    }),
  );
}
