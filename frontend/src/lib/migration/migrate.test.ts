import { DEFAULT_METER_STATE } from "@calgy/engine/meter";
import { DEFAULT_SETTINGS } from "@calgy/engine/spend";
import { UserDocPatchSchema } from "@calgy/shared";
import { describe, expect, test } from "vitest";
import { shouldNudge } from "@/components/account/LinkNudge";
import type { LegacyData } from "./legacy-db";
import { countDocs, decideMigration, hasLocalData, onlyNew, planFromLegacy } from "./migrate";

const empty: LegacyData = {
  entries: [], settings: DEFAULT_SETTINGS, hasSettings: false, devices: [], tariffOverride: null, solar: null,
  generator: null, purchases: [], readings: [], meter: DEFAULT_METER_STATE, draft: null,
};
const legacy: LegacyData = {
  ...empty,
  hasSettings: true,
  settings: { ...DEFAULT_SETTINGS, onboarded: true, source: "hybrid", fuelWeekly: 20000, calibrate: false },
  entries: [
    { id: "t1", type: "token", amount_naira: 5000, quantity: 24, unit_price: 208.33, date: "2026-09-01", note: null, created_at: "2026-09-01T10:00:00.000Z" },
    { id: "f1", type: "fuel", amount_naira: 9000, quantity: 9, unit_price: 1000, date: "2026-09-02", note: null, created_at: "2026-09-02T10:00:00.000Z" },
  ],
  readings: [{ id: "r1", unitsLeft: 30, takenAt: "2026-09-01T09:00:00.000Z", context: "onboarding" }],
  tariffOverride: 210,
};

describe("decideMigration", () => {
  test("no local data → nothing", () => expect(decideMigration(false, true)).toBe("nothing"));
  test("remote empty → upload", () => expect(decideMigration(true, false)).toBe("upload"));
  test("both → ask", () => expect(decideMigration(true, true)).toBe("ask"));
  test("can't tell → retry later", () => expect(decideMigration(true, null)).toBe("retry"));
});

describe("planFromLegacy", () => {
  test("empty store has nothing to move", () => {
    expect(hasLocalData(null)).toBe(false);
    expect(hasLocalData(empty)).toBe(false);
    expect(hasLocalData(legacy)).toBe(true);
  });

  test("maps logs to docs and settings to a valid user-doc patch", () => {
    const plan = planFromLegacy(legacy, "u1");
    expect(plan.docs.tokenLoads.map((d) => d.id)).toEqual(["t1"]);
    expect(plan.docs.fuelPurchases.map((d) => d.id)).toEqual(["f1"]);
    expect(plan.docs.meterReadings).toHaveLength(1);
    expect(countDocs(plan.docs)).toBe(3);
    expect(plan.patch).toMatchObject({
      onboarding: { completed: true, source: "hybrid" },
      household: { fuelWeekly: 20000 },
      settings: { calibrationEnabled: false },
      tariffOverride: 210,
    });
    expect(UserDocPatchSchema.safeParse(plan.patch).success).toBe(true);
  });

  test("merge skips docs whose clientId already exists remotely", () => {
    const plan = planFromLegacy(legacy, "u1");
    const none = new Set<string>();
    const fresh = onlyNew(plan.docs, {
      devices: none, meterReadings: new Set(["r1"]), tokenLoads: none, fuelPurchases: new Set(["f1"]), generators: none,
    });
    expect(countDocs(fresh)).toBe(1);
    expect(fresh.tokenLoads[0].id).toBe("t1");
  });
});

describe("link nudge", () => {
  const now = Date.parse("2026-10-10T00:00:00.000Z");
  const base = { isAnonymous: true, entries: 0, createdAt: "2026-10-08T00:00:00.000Z", dismissed: false, now };
  test("after 5 entries or 7 days, anonymous only, until dismissed", () => {
    expect(shouldNudge(base)).toBe(false);
    expect(shouldNudge({ ...base, entries: 5 })).toBe(true);
    expect(shouldNudge({ ...base, createdAt: "2026-10-03T00:00:00.000Z" })).toBe(true);
    expect(shouldNudge({ ...base, entries: 9, isAnonymous: false })).toBe(false);
    expect(shouldNudge({ ...base, entries: 9, dismissed: true })).toBe(false);
  });
});
