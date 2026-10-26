// Run with: npm test  (node --test, native TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { iso } from "./format.ts";
import {
  computeActualDaily, daysLeftRange, estimateUnitsNow, meterTariff, readingPairs, tokensFromEntries, unitsError,
  type MeterReading, type TokenLoad,
} from "./meter.ts";
import type { Entry } from "./spend.ts";

const T0 = Date.parse("2026-03-01T08:00:00.000Z");
const at = (days: number) => new Date(T0 + days * 864e5).toISOString();
let n = 0;
const reading = (unitsLeft: number, day: number, extra: Partial<MeterReading> = {}): MeterReading => ({
  id: "r" + n++, unitsLeft, takenAt: at(day), context: "check_in", ...extra,
});
const token = (units: number | null, day: number, amount = 10000): TokenLoad => ({
  id: "t" + n++, amountNaira: amount, unitsReceived: units, loadedAt: at(day),
});
const near = (actual: number, expected: number, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ~${expected}, got ${actual}`);

test("1 · 11.9 → 11.6 a day later, no token → 0.3/day", () => {
  const a = computeActualDaily([reading(11.9, 0), reading(11.6, 1)], [], {}, at(1));
  near(a.value!, 0.3);
  assert.equal(a.validPairs, 1);
  assert.equal(a.confidence, "rough");
});

test("2 · 11.6 → +50 token → 61.0 two days later → 0.3/day", () => {
  const a = computeActualDaily([reading(11.6, 1), reading(61.0, 3)], [token(50, 2)], {}, at(3));
  near(a.pairs[0].used!, 0.6);
  near(a.value!, 0.3);
});

test("3 · units went up with no token → excluded and flagged suspect", () => {
  const pairs = readingPairs([reading(11.6, 1), reading(12.4, 2)], []);
  assert.equal(pairs[0].flag, "suspect");
  assert.equal(computeActualDaily([reading(11.6, 1), reading(12.4, 2)], [], {}, at(2)).value, null);
});

test("token without units in the window → excluded, asks for that token", () => {
  const t = token(null, 2);
  const [p] = readingPairs([reading(11.6, 1), reading(61, 3)], [t]);
  assert.equal(p.flag, "missing_units");
  assert.equal(p.missingTokenId, t.id);
});

test("short pairs and outliers are left out", () => {
  const rs = [reading(40, 0), reading(39.9, 0.5), reading(39, 3.5), reading(38, 6.5), reading(10, 7.5)];
  const pairs = readingPairs(rs, []);
  assert.equal(pairs[0].flag, "short");
  assert.equal(pairs[3].flag, "outlier"); // 28 units in a day vs ~0.3/day
  const a = computeActualDaily(rs, [], {}, at(8));
  near(a.value!, (0.9 + 1) / 6);
});

test("4 · blend: readings 0.30 over 5 days + meter avg 0.28 + lifetime 0.24 → 0.288", () => {
  const rs = [reading(20, 0), reading(18.5, 5)];
  const now = at(5);
  const start = iso(new Date(Date.parse(now) - 100 * 864e5)); // ~100 days of lifetime
  const a = computeActualDaily(rs, [], { meterDailyAvgKwh: 0.28, lifetimeKwh: 0.24 * 100, meterStartDate: start }, now);
  near(a.sources.readings!, 0.3);
  near(a.sources.meterAvg!, 0.28);
  // Lifetime is measured from local noon on the start date; check the blend with whatever it came to.
  near(a.value!, 0.6 * 0.3 + 0.3 * 0.28 + 0.1 * a.sources.lifetime!, 1e-9);
  near(a.sources.lifetime!, 0.24, 0.005);
  near(a.value!, 0.288, 0.001);
  assert.equal(a.confidence, "good");
});

test("blend renormalises when only the meter's average exists", () => {
  const a = computeActualDaily([], [], { meterDailyAvgKwh: 0.28 }, at(0));
  near(a.value!, 0.28);
  assert.equal(a.confidence, "rough");
});

test("solid needs 14+ days and 3+ pairs", () => {
  const rs = [reading(20, 0), reading(18, 5), reading(16, 10), reading(14, 15)];
  assert.equal(computeActualDaily(rs, [], {}, at(15)).confidence, "solid");
});

test("5 · days left 36–40, buy by today + 36", () => {
  const r = reading(11.9, 0, { meterDaysLeft: 36, meterDailyAvgKwh: 0.3 });
  const units = estimateUnitsNow(r, [], 0.3, r.takenAt);
  near(units.units, 11.9);
  const d = daysLeftRange(units.units, 0.3, r, {}, r.takenAt)!;
  assert.deepEqual([d.low, d.high], [36, 40]);
  assert.equal(d.buyBy, iso(new Date(T0 + 36 * 864e5)));
});

test("units now: last reading + tokens since − usage", () => {
  const r = reading(10, 0);
  const u = estimateUnitsNow(r, [token(50, 1), token(20, -1)], 0.5, at(4));
  near(u.units, 10 + 50 - 2);
  assert.equal(u.estimated, true);
  const raw = estimateUnitsNow(r, [], null, at(4));
  near(raw.units, 10);
  assert.equal(raw.estimated, false);
});

test("tariff: mean ₦/kWh of the last 3 tokens with units", () => {
  const t = meterTariff([token(50, 0, 10000), token(40, 1, 10000), token(null, 2), token(100, 3, 20000), token(25, 4, 5000)]);
  near(t!.value, (250 + 200 + 200) / 3);
  assert.equal(t!.count, 3);
});

test("tokens come from spend entries; legacy ones load at local noon", () => {
  const e: Entry = {
    id: "x", type: "token", amount_naira: 5000, quantity: 25, unit_price: 200, date: "2026-03-02", note: null, created_at: "",
  };
  const [t] = tokensFromEntries([e, { ...e, id: "y", loaded_at: at(0) }, { ...e, id: "f", type: "fuel" }]);
  assert.equal(new Date(t.loadedAt).getHours(), 12);
  assert.equal(tokensFromEntries([e, { ...e, id: "f", type: "fuel" }]).length, 1);
});

test("units input: ≥ 0, one decimal", () => {
  assert.equal(unitsError("11.9"), null);
  assert.equal(unitsError("11.95"), "Use at most one decimal place.");
  assert.equal(unitsError(""), "");
});
