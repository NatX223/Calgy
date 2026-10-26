// The pre-Firebase local store (IndexedDB via Dexie). Read-only now: migration copies it to Firestore.
// TODO(next release): delete this module and the "calgy" IndexedDB database once migration has shipped.
import { isLegacyDevice, migrateDevice, normaliseDevice, type Device } from "@calgy/engine/appliances";
import type { FuelPurchase, GeneratorProfile } from "@calgy/engine/generator";
import { localNoon, normaliseMeterState, OB_READING_ID, type MeterReading, type MeterState } from "@calgy/engine/meter";
import { normaliseSolar, type SolarSettings } from "@calgy/engine/solar";
import { normaliseSettings, type Entry, type Settings } from "@calgy/engine/spend";
import Dexie, { type Table } from "dexie";

type Row<T> = { key: string; value: T };
type StoredDevice = Device & { pos: number };
type HomeSettings = { tariffOverride: number | null };

export const LEGACY_DB_NAME = "calgy";

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
    super(LEGACY_DB_NAME);
    // Schema history kept so a browser still on an old version upgrades before we read it.
    this.version(1).stores({
      entries: "id, date, type",
      settings: "key",
      devices: "id, pos",
      homeSettings: "key",
    });
    this.version(2).stores({ solarSettings: "key" });
    this.version(3).stores({ generators: "id", fuelPurchases: "id, purchasedAt", drafts: "key" });
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

export type LegacyData = {
  entries: Entry[];
  settings: Settings;
  /** False when there was no settings row at all (never used the spend screens). */
  hasSettings: boolean;
  devices: Device[];
  tariffOverride: number | null;
  solar: SolarSettings | null;
  generator: GeneratorProfile | null;
  purchases: FuelPurchase[];
  readings: MeterReading[];
  meter: MeterState;
  draft: unknown;
};

/** Does the old database exist in this browser? Avoids creating an empty one just to look. */
async function legacyExists(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined") return false;
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === LEGACY_DB_NAME);
    }
    return Dexie.exists(LEGACY_DB_NAME);
  } catch {
    return false;
  }
}

/** Everything in the old store, or null when there is no old store. */
export async function readLegacy(): Promise<LegacyData | null> {
  if (!(await legacyExists())) return null;
  const db = new CalgyDB();
  try {
    const [entries, settingsRow, deviceRows, home, solar, gens, purchases, readings, meter, draft] = await Promise.all([
      db.entries.toArray(),
      db.settings.get("settings"),
      db.devices.orderBy("pos").toArray(),
      db.homeSettings.get("home"),
      db.solarSettings.get("solar"),
      db.generators.toArray(),
      db.fuelPurchases.toArray(),
      db.meterReadings.toArray(),
      db.meterState.get("meter"),
      db.drafts.get("onboarding"),
    ]);
    return {
      entries,
      settings: normaliseSettings(settingsRow?.value),
      hasSettings: !!settingsRow,
      devices: deviceRows.map((r) => {
        const d: Partial<StoredDevice> = { ...r };
        delete d.pos;
        return normaliseDevice(d);
      }),
      tariffOverride: home?.value.tariffOverride ?? null,
      solar: solar ? normaliseSolar(solar.value) : null,
      generator: gens[0] ?? null,
      purchases,
      readings,
      meter: normaliseMeterState(meter?.value),
      draft: draft?.value ?? null,
    };
  } finally {
    db.close();
  }
}

/** "Delete my data" removes the old store too. */
export async function deleteLegacy() {
  try {
    await Dexie.delete(LEGACY_DB_NAME);
  } catch {
    // nothing to delete
  }
}
