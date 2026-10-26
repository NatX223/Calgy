import type { FuelPurchase } from "@calgy/engine/generator";
import { DEFAULT_METER_STATE } from "@calgy/engine/meter";
import { DEFAULT_SETTINGS, type Entry } from "@calgy/engine/spend";
import { applyUserDocPatch, defaultUserDoc, UserDocPatchSchema } from "@calgy/shared";
import { describe, expect, test } from "vitest";
import {
  diffDocs, entryToToken, fuelDocs, fuelToEntry, fuelToPurchase, meterFromDoc, meterPatch, settingsFromDoc, settingsPatch,
  tokenToEntry,
} from "./mapping";

const token: Entry = {
  id: "t1", type: "token", amount_naira: 10000, quantity: 47.7, unit_price: 209.64, date: "2026-10-01", note: null,
  created_at: "2026-10-01T09:31:00.000Z", loaded_at: "2026-10-01T09:30:00.000Z", before_reading_id: "r1",
};
const fuel: Entry = {
  id: "f1", type: "fuel", amount_naira: 9800, quantity: 10, unit_price: 980, date: "2026-09-30", note: "Roadside",
  created_at: "2026-09-30T12:00:00.000Z",
};
const purchase: FuelPurchase = {
  id: "f1", generatorId: "gen-home", amountNaira: 9800, litres: 10, hoursRun: 6, purchasedAt: "2026-09-30", source: "log",
  createdAt: "2026-09-30T12:00:00.000Z",
};
const withMeta = <T extends { id: string }>(d: T) => ({ ...d, clientId: d.id, updatedAt: "2026-10-02T00:00:00.000Z" });

describe("spend log ↔ docs", () => {
  test("tokens round-trip", () => {
    expect(tokenToEntry(withMeta(entryToToken(token)) as never)).toEqual(token);
  });

  test("fuel entry + gen purchase become one doc and split back", () => {
    const [doc] = fuelDocs([fuel, token], [purchase]);
    expect(doc).toMatchObject({ id: "f1", litres: 10, generatorId: "gen-home", hoursRun: 6, source: "log" });
    const stored = withMeta(doc) as never;
    expect(fuelToEntry(stored)).toEqual(fuel);
    expect(fuelToPurchase(stored)).toEqual(purchase);
  });

  test("fuel without a gen purchase isn't a purchase", () => {
    const [doc] = fuelDocs([fuel], []);
    expect(doc.generatorId).toBeNull();
    expect(fuelToPurchase(withMeta(doc) as never)).toBeNull();
  });
});

describe("diffDocs", () => {
  type D = { id: string; n: number; createdAt?: string; extra?: string };
  const a: D = { id: "a", n: 1, createdAt: "x" };
  const b: D = { id: "b", n: 2, extra: "keep" };
  const prev = new Map<string, D>([["a", a], ["b", b]]);

  test("no change → nothing to write (metadata ignored)", () => {
    expect(diffDocs(prev, [{ ...a, createdAt: "y" }, b])).toEqual({ upserts: [], deletes: [] });
  });

  test("creates, updates with removed keys, deletes", () => {
    const d = diffDocs(prev, [{ id: "b", n: 3 }, { id: "c", n: 4 }]);
    expect(d.deletes).toEqual(["a"]);
    expect(d.upserts).toEqual([
      { doc: { id: "b", n: 3 }, create: false, removedKeys: ["extra"] },
      { doc: { id: "c", n: 4 }, create: true, removedKeys: [] },
    ]);
  });
});

describe("settings ↔ user doc", () => {
  const u = defaultUserDoc("u1", "2026-10-01T00:00:00.000Z");

  test("unchanged settings → empty patch", () => {
    expect(settingsPatch(u, settingsFromDoc(u))).toEqual({});
    expect(meterPatch(u, meterFromDoc(u))).toEqual({});
  });

  test("patch contains only what changed, and applies back to the same settings", () => {
    const s = { ...settingsFromDoc(u), onboarded: true, fuelWeekly: 25000, gridHours: 6, gridHoursSource: "user" as const };
    const p = settingsPatch(u, s);
    expect(p).toEqual({ onboarding: { completed: true }, household: { fuelWeekly: 25000 }, gridHours: { source: "user", value: 6 } });
    expect(UserDocPatchSchema.safeParse(p).success).toBe(true);
    expect(settingsFromDoc(applyUserDocPatch(u, p))).toEqual({ ...DEFAULT_SETTINGS, ...s });
  });

  test("inferred hours are left to their own debounce when asked", () => {
    const s = { ...settingsFromDoc(u), gridHours: 6.3, gridHoursSource: "inferred" as const, gridHoursRange: [5, 7] as [number, number] };
    expect(settingsPatch(u, s, { skipInferred: true })).toEqual({});
    expect(settingsPatch(u, s).gridHours).toEqual({ source: "inferred", value: 6.3, inferredRange: [5, 7] });
  });

  test("meter state and reminder", () => {
    const m = { ...DEFAULT_METER_STATE, profile: { meterDailyAvgKwh: 7.5 }, tokenSkips: 2, reminder: { on: true, day: 1 as const, time: "08:15" } };
    const p = meterPatch(u, m);
    expect(p).toEqual({
      meterProfile: { meterDailyAvgKwh: 7.5 },
      meterState: { tokenSkips: 2 },
      settings: { reminder: { enabled: true, day: 1, time: "08:15" } },
    });
    expect(meterFromDoc(applyUserDocPatch(u, p))).toEqual(m);
  });
});
