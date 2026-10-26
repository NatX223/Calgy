// Run with: npm test  (node --test, native TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyUserDocPatch, defaultUserDoc, mergeUserDocPatches, normaliseUserDoc, UserDocPatchSchema, UserDocSchema,
} from "./user-doc.ts";

const NOW = "2026-10-01T09:00:00.000Z";

test("default doc is valid", () => {
  assert.ok(UserDocSchema.safeParse(defaultUserDoc("u1", NOW)).success);
});

test("patch merges groups one level deep and reminder two", () => {
  const d = defaultUserDoc("u1", NOW);
  const next = applyUserDocPatch(d, { household: { fuelWeekly: 5000 }, settings: { reminder: { enabled: true } } });
  assert.equal(next.household.fuelWeekly, 5000);
  assert.equal(next.household.tokenMonthly, 0);
  assert.equal(next.settings.reminder.enabled, true);
  assert.equal(next.settings.reminder.time, "09:00");
  assert.equal(next.settings.calibrationEnabled, true);
});

test("null replaces scalar groups", () => {
  const d = { ...defaultUserDoc("u1", NOW), tariffOverride: 200 };
  assert.equal(applyUserDocPatch(d, { tariffOverride: null }).tariffOverride, null);
  assert.equal(applyUserDocPatch(d, {}).tariffOverride, 200);
});

test("merged patches apply like sequential ones", () => {
  const d = defaultUserDoc("u1", NOW);
  const a = { settings: { reminder: { enabled: true } }, household: { fuelWeekly: 1 } };
  const b = { settings: { reminder: { time: "10:15" }, shareAnonymousData: true }, household: { fuelWeekly: 2 } };
  assert.deepEqual(applyUserDocPatch(d, mergeUserDocPatches(a, b)), applyUserDocPatch(applyUserDocPatch(d, a), b));
});

test("patch schema rejects unknown groups and bad values", () => {
  assert.equal(UserDocPatchSchema.safeParse({ nope: 1 }).success, false);
  assert.equal(UserDocPatchSchema.safeParse({ gridHours: { value: 30 } }).success, false);
  assert.equal(UserDocPatchSchema.safeParse({ settings: { reminder: { time: "9am" } } }).success, false);
  assert.ok(UserDocPatchSchema.safeParse({ gridHours: { source: "inferred", value: 6.5, inferredRange: [5, 8] } }).success);
});

test("normalise fills missing and invalid groups with defaults", () => {
  const d = normaliseUserDoc({ household: { fuelWeekly: -4 }, gridHours: { source: "user", value: 6 } }, "u1");
  assert.equal(d.household.fuelWeekly, 0);
  assert.equal(d.gridHours.source, "user");
  assert.equal(d.gridHours.value, 6);
  assert.equal(d.settings.reminder.timezone, "Africa/Lagos");
  assert.ok(UserDocSchema.safeParse(d).success);
});
