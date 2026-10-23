// Local-first storage: everything lives in this browser's IndexedDB.
import Dexie, { type Table } from "dexie";
import type { Device } from "./appliances";
import { normaliseSolar, type SolarSettings } from "./solar";
import { DEFAULT_SETTINGS, type Entry, type Settings } from "./spend";

type Row<T> = { key: string; value: T };
type StoredDevice = Device & { pos: number };
type HomeSettings = { tariffOverride: number | null };

class CalgyDB extends Dexie {
  entries!: Table<Entry, string>;
  settings!: Table<Row<Settings>, string>;
  devices!: Table<StoredDevice, string>;
  homeSettings!: Table<Row<HomeSettings>, string>;
  solarSettings!: Table<Row<SolarSettings>, string>;

  constructor() {
    super("calgy");
    this.version(1).stores({
      entries: "id, date, type",
      settings: "key",
      devices: "id, pos",
      homeSettings: "key",
    });
    this.version(2).stores({ solarSettings: "key" });
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
    return { entries, settings: { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) } };
  } catch (err) {
    console.error("Calgy: storage unavailable", err);
    return { entries: [], settings: { ...DEFAULT_SETTINGS } };
  }
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
      return d as Device;
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
