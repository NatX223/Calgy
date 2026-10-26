import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyUserDocPatch, defaultUserDoc, UserDocSchema, type UserDoc } from "@calgy/shared";
import { Timestamp } from "firebase-admin/firestore";
import { loadConfig } from "../src/config.ts";
import { computeAggregates, percentile, type Contributor } from "../src/jobs/aggregates.ts";
import { reminderDue, reminderPayload, zonedClock } from "../src/jobs/reminders.ts";
import {
  decodeUserDoc, encodeUserDoc, fillFromAnonymous, newMeta, syncIdentity,
} from "../src/services/user-doc.ts";
import { testConfig } from "./helpers.ts";

const NOW = "2026-10-01T09:00:00.000Z";

describe("config", () => {
  test("lists every missing required value", () => {
    assert.throws(() => loadConfig({}), (e: Error) => {
      for (const k of ["CRED", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) assert.match(e.message, new RegExp(k));
      return true;
    });
  });

  test("defaults: bearer, 127.0.0.1:8080, jobs on", () => {
    const c = testConfig();
    assert.equal(c.authMode, "bearer");
    assert.equal(c.host, "127.0.0.1");
    assert.equal(c.port, 8080);
    assert.equal(c.jobsEnabled, true);
    assert.equal(c.previewPattern, null);
  });

  test("CRED: project id comes from it; bad values and mismatches are refused", () => {
    const c = testConfig();
    assert.equal(c.projectId, "demo-calgy");
    assert.equal(c.serviceAccount?.clientEmail, "api@demo-calgy.iam.gserviceaccount.com");
    assert.throws(() => testConfig({ CRED: "not-base64-json" }), /CRED: Not base64/);
    assert.throws(() => testConfig({ CRED: Buffer.from('{"project_id":"x"}').toString("base64") }), /CRED/);
    assert.throws(() => testConfig({ FIREBASE_PROJECT_ID: "other" }), /Doesn't match/);
  });

  test("emulators need no CRED, but then a project id", () => {
    const base = { APP_ORIGINS: "http://localhost:3000", VAPID_PUBLIC_KEY: "k", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "mailto:a@b.c", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
    assert.throws(() => loadConfig(base), /FIREBASE_PROJECT_ID/);
    const c = loadConfig({ ...base, FIREBASE_PROJECT_ID: "demo-calgy" });
    assert.equal(c.serviceAccount, null);
  });

  test("preview pattern is anchored", () => {
    const c = testConfig({ ALLOW_VERCEL_PREVIEWS: "true", VERCEL_PREVIEW_PATTERN: "https://calgy-.*\\.vercel\\.app" });
    assert.ok(c.previewPattern!.test("https://calgy-abc.vercel.app"));
    assert.equal(c.previewPattern!.test("https://x.com/?https://calgy-abc.vercel.app"), false);
    assert.throws(() => testConfig({ ALLOW_VERCEL_PREVIEWS: "true" }), /VERCEL_PREVIEW_PATTERN/);
  });
});

describe("user doc at rest", () => {
  test("round-trips through Firestore shape with Timestamps where the client expects them", () => {
    const doc: UserDoc = applyUserDocPatch(defaultUserDoc("u1", NOW), {
      household: { fuelWeekly: 3000 },
      settings: { lastExport: "2026-09-30T10:00:00.000Z", reminder: { enabled: true } },
      solar: { panels: 4 },
    });
    const meta = { ...newMeta({ isAnonymous: false, authProviders: ["google.com"] }), reminderLastSentAt: NOW };
    const raw = encodeUserDoc(doc, meta);
    assert.ok(raw.createdAt instanceof Timestamp);
    assert.ok(raw.settings.lastExport instanceof Timestamp);
    assert.ok(raw.settings.reminder.lastSentAt instanceof Timestamp);
    assert.equal(raw.schemaVersion, 1);
    const back = decodeUserDoc(raw, "u1");
    assert.deepEqual(back.doc, doc);
    assert.equal(back.meta.reminderLastSentAt, NOW);
    assert.ok(UserDocSchema.safeParse(back.doc).success);
  });

  test("missing doc decodes to defaults", () => {
    const { doc, meta } = decodeUserDoc(undefined, "u1");
    assert.equal(doc.settings.calibrationEnabled, true);
    assert.equal(doc.settings.shareAnonymousData, false);
    assert.equal(meta.isAnonymous, true);
  });

  test("linkedAt is set once, when an anonymous account first gets a provider", () => {
    const anon = newMeta({ isAnonymous: true, authProviders: ["anonymous"] });
    const linked = syncIdentity(anon, { isAnonymous: false, authProviders: ["google.com"] }, NOW);
    assert.equal(linked.linkedAt, NOW);
    assert.equal(syncIdentity(linked, { isAnonymous: false, authProviders: ["google.com", "password"] }, "2027-01-01T00:00:00Z").linkedAt, NOW);
    const direct = syncIdentity(newMeta({ isAnonymous: false, authProviders: ["google.com"] }), { isAnonymous: false, authProviders: ["google.com"] }, NOW);
    assert.equal(direct.linkedAt, null);
  });
});

describe("merge fill", () => {
  const fresh = defaultUserDoc("me", NOW);
  const guest = applyUserDocPatch(defaultUserDoc("anon", NOW), {
    onboarding: { completed: true, source: "hybrid" },
    household: { fuelWeekly: 8000 },
    gridHours: { source: "user", value: 10 },
    tariffOverride: 209,
    settings: { shareAnonymousData: true, reminder: { enabled: true, day: 2 } },
  });

  test("a fresh account takes the guest's values, except data-sharing consent", () => {
    const merged = applyUserDocPatch(fresh, fillFromAnonymous(fresh, guest));
    assert.deepEqual(merged.onboarding, { completed: true, source: "hybrid" });
    assert.equal(merged.household.fuelWeekly, 8000);
    assert.equal(merged.gridHours.value, 10);
    assert.equal(merged.tariffOverride, 209);
    assert.equal(merged.settings.reminder.day, 2);
    assert.equal(merged.settings.shareAnonymousData, false);
    assert.equal(merged.uid, "me");
  });

  test("the account's own values win", () => {
    const mine = applyUserDocPatch(fresh, { household: { fuelWeekly: 100 }, tariffOverride: 150, onboarding: { completed: true, source: "gen" } });
    const merged = applyUserDocPatch(mine, fillFromAnonymous(mine, guest));
    assert.equal(merged.household.fuelWeekly, 100);
    assert.equal(merged.tariffOverride, 150);
    assert.equal(merged.onboarding.source, "gen");
  });

  test("nothing to add → empty patch", () => {
    assert.deepEqual(fillFromAnonymous(guest, defaultUserDoc("anon2", NOW)), {});
  });
});

describe("reminders", () => {
  const reminder = { enabled: true, day: 6, time: "09:00", timezone: "Africa/Lagos" }; // Saturday 09:00 WAT (UTC+1)
  const at = (iso: string) => new Date(iso);

  test("zoned clock", () => {
    assert.deepEqual(zonedClock(at("2026-10-03T08:00:00Z"), "Africa/Lagos"), { weekday: 6, minute: 9 * 60 });
    assert.deepEqual(zonedClock(at("2026-10-03T23:30:00Z"), "Asia/Tokyo"), { weekday: 0, minute: 8 * 60 + 30 });
  });

  test("due only in the reminder's quarter-hour in the user's zone", () => {
    assert.equal(reminderDue(reminder, null, at("2026-10-03T08:00:00Z")), true);
    assert.equal(reminderDue(reminder, null, at("2026-10-03T08:14:59Z")), true);
    assert.equal(reminderDue(reminder, null, at("2026-10-03T08:15:00Z")), false);
    assert.equal(reminderDue(reminder, null, at("2026-10-03T09:00:00Z")), false); // 09:00 UTC = 10:00 Lagos
    assert.equal(reminderDue(reminder, null, at("2026-10-04T08:00:00Z")), false); // Sunday
    assert.equal(reminderDue({ ...reminder, enabled: false }, null, at("2026-10-03T08:00:00Z")), false);
  });

  test("other zones: London (BST) and Los Angeles across the date line from UTC", () => {
    assert.equal(reminderDue({ ...reminder, timezone: "Europe/London" }, null, at("2026-10-03T08:00:00Z")), true);
    // Friday 21:00 in LA is Saturday 04:00 UTC.
    assert.equal(reminderDue({ ...reminder, day: 5, time: "21:00", timezone: "America/Los_Angeles" }, null, at("2026-10-03T04:05:00Z")), true);
  });

  test("off-grid time falls in its quarter-hour", () => {
    assert.equal(reminderDue({ ...reminder, time: "09:20" }, null, at("2026-10-03T08:15:00Z")), true);
    assert.equal(reminderDue({ ...reminder, time: "09:20" }, null, at("2026-10-03T08:30:00Z")), false);
  });

  test("once a week", () => {
    const now = at("2026-10-03T08:00:00Z");
    assert.equal(reminderDue(reminder, "2026-10-03T08:00:00Z", now), false);
    assert.equal(reminderDue(reminder, "2026-09-29T08:00:00Z", now), false);
    assert.equal(reminderDue(reminder, "2026-09-26T08:00:00Z", now), true);
  });

  test("bad zone is never due", () => {
    assert.equal(reminderDue({ ...reminder, timezone: "Nope/Nope" }, null, at("2026-10-03T08:00:00Z")), false);
  });

  test("copy depends on the last reading's age", () => {
    const now = at("2026-10-20T08:00:00Z");
    assert.match(reminderPayload("2026-10-15T08:00:00Z", now).body, /keeps your estimates/);
    assert.match(reminderPayload("2026-10-01T08:00:00Z", now).body, /been a while/);
    assert.match(reminderPayload(null, now).body, /keeps your estimates/);
    assert.equal(reminderPayload(null, now).title, "Check your meter");
  });
});

describe("aggregates", () => {
  const now = new Date("2026-10-20T01:00:00Z");
  const user = (i: number, over: Partial<Contributor> = {}): Contributor => ({
    doc: defaultUserDoc(`u${i}`, NOW),
    devices: [],
    meterReadings: [],
    fuelPurchases: [],
    generators: [{ id: "g", clientId: "g", sizeSource: "card", typeId: "small_petrol", kwLow: 1, kwHigh: 2, fuelType: "petrol" }],
    tokenLoads: [
      {
        id: `t${i}`, clientId: `t${i}`, amountNaira: 10_000, unitsReceived: 10_000 / (200 + i), unitPrice: null,
        date: "2026-10-15", loadedAt: "2026-10-15T12:00:00.000Z", beforeReadingId: null, note: null,
      },
    ],
    ...over,
  });

  test("percentile interpolates", () => {
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(percentile([10], 0.25), 10);
  });

  test("a bucket needs enough distinct users", () => {
    const users = Array.from({ length: 9 }, (_, i) => user(i));
    assert.equal(computeAggregates(users, now, 10).tariff.buckets.length, 0);
    const out = computeAggregates([...users, user(9)], now, 10).tariff;
    assert.equal(out.buckets.length, 1);
    assert.equal(out.buckets[0].count, 10);
    assert.equal(out.buckets[0].median, 204.5);
    assert.equal(out.windowDays, 30);
  });

  test("one user's many entries count once", () => {
    const loud = user(0, {
      tokenLoads: Array.from({ length: 50 }, (_, i) => ({ ...user(0).tokenLoads[0], id: `x${i}`, unitsReceived: 10 })),
    });
    const out = computeAggregates([loud, user(1)], now, 2).tariff.buckets[0];
    assert.equal(out.count, 2);
  });

  test("old entries are outside the window", () => {
    const old = user(0, { tokenLoads: [{ ...user(0).tokenLoads[0], loadedAt: "2026-08-01T12:00:00.000Z" }] });
    assert.equal(computeAggregates([old], now, 1).tariff.buckets.length, 0);
  });

  test("fuel price and generator burn, keyed by type and fuel, with no identifying fields", () => {
    const users = Array.from({ length: 3 }, (_, i) =>
      user(i, {
        fuelPurchases: [
          {
            id: "f", clientId: "f", amountNaira: 12_000, litres: 10, unitPrice: null, purchasedAt: "2026-10-18", note: null,
            generatorId: "g", hoursRun: 5 + i, source: "log",
          },
        ],
      }),
    );
    const out = computeAggregates(users, now, 3);
    assert.deepEqual(out.fuelPrice.buckets, [{ fuelType: "petrol", median: 1200, p25: 1200, p75: 1200, count: 3 }]);
    const burn = out.genBurn.buckets[0];
    assert.equal(burn.generatorType, "small_petrol");
    assert.equal(burn.count, 3);
    assert.equal(burn.median, 1.667);
    assert.deepEqual(Object.keys(burn).sort(), ["count", "fuelType", "generatorType", "median", "p25", "p75"]);
  });
});
