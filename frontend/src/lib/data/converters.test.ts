import { COLLECTIONS, defaultUserDoc, type CollectionName, type LogDocs } from "@calgy/shared";
import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { describe, expect, test } from "vitest";
import { isValidDoc, logConverter, userDocConverter } from "./converters";

const T = "2026-10-01T09:30:00.000Z";
const C = "2026-09-01T08:00:00.000Z";

const SAMPLES: { [K in CollectionName]: LogDocs[K] } = {
  devices: {
    id: "d1", clientId: "d1", createdAt: C, updatedAt: T, pos: 0, name: "Fridge", quantity: 1,
    presetId: "fridge", category: "kitchen", icon: "🧊", rating: { method: "preset_only" }, usage: { profile: "cycling", hoursPerDay: 24 },
  },
  meterReadings: { id: "r1", clientId: "r1", createdAt: C, updatedAt: T, unitsLeft: 42.5, takenAt: T, context: "check_in", meterDaysLeft: 6 },
  tokenLoads: {
    id: "t1", clientId: "t1", createdAt: C, updatedAt: T, amountNaira: 10000, unitsReceived: 47.7, unitPrice: 209.64,
    date: "2026-10-01", loadedAt: T, beforeReadingId: "r1", note: null,
  },
  fuelPurchases: {
    id: "f1", clientId: "f1", createdAt: C, updatedAt: T, amountNaira: 9800, litres: 10, unitPrice: 980, purchasedAt: "2026-09-30",
    note: "Roadside", generatorId: "gen-home", hoursRun: 6, source: "log",
  },
  generators: {
    id: "gen-home", clientId: "gen-home", createdAt: C, updatedAt: T, sizeSource: "card", typeId: "small_petrol",
    kwLow: 1.2, kwHigh: 2, fuelType: "petrol",
  },
};

/** Just enough of a QueryDocumentSnapshot for a converter. */
const snap = (id: string, data: DocumentData) =>
  ({ id, data: () => data }) as unknown as QueryDocumentSnapshot<DocumentData, DocumentData>;

describe("log converters: ISO ↔ Timestamp round-trip", () => {
  for (const name of COLLECTIONS) {
    test(name, () => {
      const conv = logConverter(name);
      const stored = conv.toFirestore(SAMPLES[name] as never);
      expect(stored.id).toBeUndefined();
      expect(stored.createdAt).toBeInstanceOf(Timestamp);
      expect(stored.updatedAt).toBeInstanceOf(Timestamp);
      if (name === "meterReadings") expect(stored.takenAt).toBeInstanceOf(Timestamp);
      if (name === "tokenLoads") expect(stored.loadedAt).toBeInstanceOf(Timestamp);
      // Calendar days stay strings.
      if (name === "fuelPurchases") expect(stored.purchasedAt).toBe("2026-09-30");
      expect(conv.fromFirestore(snap(SAMPLES[name].id, stored))).toEqual(SAMPLES[name]);
    });
  }

  test("invalid docs are marked and filtered out", () => {
    const out = logConverter("tokenLoads").fromFirestore(snap("bad", { amountNaira: "lots" }));
    expect(isValidDoc(out)).toBe(false);
  });
});

describe("user doc converter", () => {
  test("round-trips, with lastExport as a Timestamp", () => {
    const d = { ...defaultUserDoc("u1", C), updatedAt: T, settings: { ...defaultUserDoc("u1").settings, lastExport: T } };
    const stored = userDocConverter.toFirestore(d);
    expect(stored.createdAt).toBeInstanceOf(Timestamp);
    expect((stored.settings as DocumentData).lastExport).toBeInstanceOf(Timestamp);
    expect(userDocConverter.fromFirestore(snap("u1", stored))).toEqual(d);
  });

  test("older docs missing groups get defaults", () => {
    const d = userDocConverter.fromFirestore(snap("u1", { createdAt: Timestamp.fromDate(new Date(C)), household: { fuelWeekly: 2000 } }));
    expect(d.household).toEqual({ fuelWeekly: 2000, tokenMonthly: 0 });
    expect(d.settings.reminder.timezone).toBe("Africa/Lagos");
    expect(d.createdAt).toBe(C);
  });
});
