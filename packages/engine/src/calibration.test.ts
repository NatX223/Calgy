// Run with: npm test  (node --test, native TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateHours, burn, calibrate, calibrateGrid, computeGenActuals, deviceSplit, genPrompt, genVerdict, gridEnergy,
  predictedLph, simulateWithCalibration, solveGridHours, sourcesOf, type GenSpec,
} from "./calibration.ts";
import type { Device, DeviceRating, DeviceUsage } from "./energy.ts";
import type { ActualDaily, MeterReading } from "./meter.ts";

const dev = (presetId: string | null, rating: DeviceRating, usage: DeviceUsage, quantity = 1, extra: Partial<Device> = {}): Device => ({
  id: presetId + Math.random().toString(36).slice(2), presetId, name: "t", category: "other", icon: "", quantity, rating, usage,
  createdAt: "", updatedAt: "", ...extra,
});
const near = (actual: number, expected: number, tol: number) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ~${expected} (±${tol}), got ${actual}`);
const actual = (value: number): ActualDaily => ({
  value, sources: { readings: value }, spanDays: 5, validPairs: 3, confidence: "good", pairs: [],
});

const founder = (workload: "light" | "moderate") => [
  dev("mifi", { method: "battery", mAh: 5000, volts: 12, amps: 2 }, { profile: "always_on_battery" }),
  dev("laptop-plugged", { method: "preset_only" }, { profile: "steady", hoursPerDay: 24, workload }),
  dev("phone", { method: "battery", mAh: 5000 }, { profile: "charges", chargesPerDay: 2.5 }),
];
const fans = () => [
  dev("standing-fan", { method: "preset_only" }, { profile: "steady", hoursPerDay: 12 }, 2),
  dev("tv-50", { method: "preset_only" }, { profile: "steady", hoursPerDay: 6 }),
  dev("fridge-freezer", { method: "preset_only" }, { profile: "cycling", hoursPerDay: 24, dutyPercent: 45 }),
];
const petrol2kw: GenSpec = { kwLow: 2, kwHigh: 2, fuelType: "petrol" };

test("6 · Mode A, founder's home, laptop Moderate → ~4.8h of light", () => {
  near(solveGridHours(founder("moderate"), 0.3, "typical")!, 4.8, 0.1);
});

test("7 · same home, laptop Light → ~7.5h", () => {
  near(solveGridHours(founder("light"), 0.3, "typical")!, 7.5, 0.1);
});

test("Mode A via calibrateGrid: matched, ratio 1, range brackets the value", () => {
  const { result, values } = calibrateGrid(founder("moderate"), { source: "none", value: null }, actual(0.3));
  assert.equal(result.status, "matched");
  assert.equal(result.mode, "infer_hours");
  const { value, range } = result.inferredGridHours!;
  assert.ok(range[0] <= value && value <= range[1]);
  near(values.reduce((a, b) => a + b, 0), 0.3, 0.005);
});

test("8 · Mode B case 1: unpinned devices share one t; sum = actual", () => {
  const devs = fans();
  const e = gridEnergy(devs, 8);
  const a = e.low + 0.37 * (e.high - e.low);
  const { result, values } = calibrateGrid(devs, { source: "user", value: 8 }, actual(a));
  assert.equal(result.status, "matched");
  near(result.t!, 0.37, 1e-9);
  near(values.reduce((x, y) => x + y, 0), a, 0.001);
  devs.forEach((d, i) => {
    const r = deviceSplit(d, 8, null, "grid").grid;
    near(values[i], r.low + result.t! * (r.high - r.low), 1e-9);
  });
});

test("9 · Mode B case 2: 1.3 × typical outside the range → k = 1.3, adjusted", () => {
  const kettle = dev("kettle", { method: "watts", watts: 2000 }, { profile: "steady", hoursPerDay: 1 });
  const ty = gridEnergy([kettle], 8).typical;
  const { result, values } = calibrateGrid([kettle], { source: "user", value: 8 }, actual(1.3 * ty));
  assert.equal(result.status, "adjusted");
  near(result.k!, 1.3, 1e-9);
  near(values[0], 1.3 * ty, 1e-9);
});

test("10 · grid mismatch under: actual = 3 × E_grid(24) → mismatch_under, k = 2", () => {
  const devs = fans();
  const { result } = calibrateGrid(devs, { source: "none", value: null }, actual(3 * gridEnergy(devs, 24).typical));
  assert.equal(result.status, "mismatch_under");
  assert.equal(result.k, 2);
  assert.equal(result.gridHoursUsed, 12);
});

test("mismatch over clamps k to 0.5", () => {
  const devs = fans();
  const { result } = calibrateGrid(devs, { source: "user", value: 8 }, actual(0.1 * gridEnergy(devs, 8).typical));
  assert.equal(result.status, "mismatch_over");
  assert.equal(result.k, 0.5);
});

test("11 · pinned device unchanged after calibration", () => {
  const devs = fans();
  devs[0] = { ...devs[0], tierOverride: "high" };
  const before = deviceSplit(devs[0], 8, null, "grid").grid.typical;
  const kettle = dev("kettle", { method: "watts", watts: 2000 }, { profile: "steady", hoursPerDay: 1 });
  const all = [...devs, kettle];
  const { result, values } = calibrateGrid(all, { source: "user", value: 8 }, actual(1.6 * gridEnergy(all, 8).typical));
  assert.notEqual(result.status, "matched");
  near(values[0], before, 1e-12);
});

test("Mode B suggests the meter's hours when far from the user's", () => {
  const devs = founder("moderate");
  const { result } = calibrateGrid(devs, { source: "user", value: 16 }, actual(0.3));
  near(result.suggestedGridHours!.value, 4.8, 0.1);
});

test("12 · petrol 2.5kVA (2.0 kW): full 1.0 L/h, idle 0.45 L/h, 0.2 kW → 0.505 L/h", () => {
  const b = burn(petrol2kw);
  near(b.full, 1.0, 1e-9);
  near(b.idle, 0.45, 1e-9);
  near(predictedLph(petrol2kw, 0.2), 0.505, 1e-9);
});

test("13 · 0.83 L/h with 0.2 kW of devices → load ~1.38 kW, under, k_gen 2, mentions servicing", () => {
  const v = genVerdict(petrol2kw, 0.83, 0.2);
  near(v.inferredLoadKw, 1.38, 0.005);
  near(v.coverage!, 0.145, 0.002);
  assert.equal(v.status, "gen_mismatch_under");
  assert.equal(v.k_gen, 2);
  assert.match(genPrompt(v)!, /servicing/);
});

test("14 · 0.2 L/h on a 2.0 kW petrol gen is below idle → gen_data_check", () => {
  const v = genVerdict(petrol2kw, 0.2, 0.2);
  assert.equal(v.status, "gen_data_check");
  assert.equal(v.check, "too_low");
  assert.equal(genVerdict(petrol2kw, 1.5, 0.2).check, "too_high");
});

test("15 · hybrid allocation: fan 10h, G 6, H 5 → grid 6h, gen 4h", () => {
  assert.deepEqual(allocateHours(10, 6, 5, ["grid", "gen"]), { grid: 6, gen: 4 });
  const fan = dev("standing-fan", { method: "preset_only" }, { profile: "steady", hoursPerDay: 10 });
  const s = deviceSplit(fan, 6, 5, "hybrid");
  near(s.grid.typical, 0.06 * 6, 1e-9);
  near(s.gen.typical, 0.06 * 4, 1e-9);
});

test("heavy loads default to grid only in hybrid homes; battery devices split by hours", () => {
  const iron = dev("iron", { method: "preset_only" }, { profile: "steady", hoursPerDay: 1 });
  assert.deepEqual(sourcesOf(iron, "hybrid"), ["grid"]);
  assert.deepEqual(sourcesOf({ ...iron, powerSources: ["gen"] }, "hybrid"), ["gen"]);
  assert.deepEqual(sourcesOf(iron, "gen"), ["gen"]);
  const phone = dev("phone", { method: "battery", mAh: 5000 }, { profile: "charges", chargesPerDay: 1 });
  const s = deviceSplit(phone, 6, 2, "hybrid");
  near(s.grid.typical / (s.grid.typical + s.gen.typical), 0.75, 1e-9);
  assert.equal(deviceSplit(phone, 6, null, "hybrid").gen.typical, 0);
});

test("gen actuals: L/gen-hour, hours a day between purchases, confidence", () => {
  const g = computeGenActuals([
    { amountNaira: 10000, litres: 10, hoursRun: 10, purchasedAt: "2026-03-01" },
    { amountNaira: 10000, litres: 10, hoursRun: 10, purchasedAt: "2026-03-03" },
  ]);
  near(g.actualLph!, 1, 1e-9);
  near(g.genHoursPerDay!, 5, 1e-9);
  near(g.nairaPerGenHour!, 1000, 1e-9);
  assert.equal(g.confidence, "rough");
});

const readings = (perDay: number): MeterReading[] => [0, 3, 6].map((d, i) => ({
  id: "r" + i, unitsLeft: 30 - perDay * d, takenAt: new Date(Date.parse("2026-03-01T08:00:00Z") + d * 864e5).toISOString(),
  context: "check_in",
}));

test("16 · hybrid: grid ready, no fuel purchases → grid calibrated, gen not_ready asking for a purchase", () => {
  const devs = founder("moderate");
  const r = calibrate("hybrid", devs, {
    readings: readings(0.3), tokens: [], profile: {}, gridHours: { source: "none", value: null }, now: "2026-03-07T09:00:00Z",
  }, { generator: petrol2kw, purchases: [] });
  assert.equal(r.grid!.status, "matched");
  near(r.grid!.gridHoursUsed, 4.8, 0.1);
  assert.equal(r.gen!.status, "not_ready");
  assert.match(genPrompt(r.gen!)!, /Log a fuel purchase/);
});

test("hybrid with fuel: gen side calibrated against the devices left for the gen", () => {
  const devs = fans();
  const r = calibrate("hybrid", devs, {
    readings: readings(1.0), tokens: [], profile: {}, gridHours: { source: "user", value: 6 }, now: "2026-03-07T09:00:00Z",
  }, {
    generator: petrol2kw,
    purchases: [
      { amountNaira: 10000, litres: 10, hoursRun: 12, purchasedAt: "2026-03-01" },
      { amountNaira: 10000, litres: 10, hoursRun: 12, purchasedAt: "2026-03-04" },
    ],
  });
  assert.equal(r.genHoursUsed, 4);
  assert.ok(r.gen!.deviceGenLoadKw! > 0);
  assert.notEqual(r.gen!.status, "not_ready");
  near(r.gen!.loadPercent!, r.gen!.inferredLoadKw! / 2, 1e-9);
});

test("simulator: base rows keep their ratios, new rows get the shared k", () => {
  const kettle = dev("kettle", { method: "watts", watts: 2000 }, { profile: "steady", hoursPerDay: 1 });
  const ty = gridEnergy([kettle], 8).typical;
  const r = calibrate("grid", [kettle], {
    readings: [], tokens: [], profile: { meterDailyAvgKwh: 1.3 * ty }, gridHours: { source: "user", value: 8 }, now: "2026-03-07T09:00:00Z",
  }, { generator: null, purchases: [] });
  const twoHours = { ...kettle, usage: { ...kettle.usage, hoursPerDay: 2 } };
  const [base, fresh] = simulateWithCalibration(
    [{ device: twoHours, baseId: kettle.id }, { device: { ...kettle, id: "new" }, baseId: null }], r, true, 8, null,
  );
  near(base.grid.typical, 2 * 1.3 * ty, 1e-9);
  near(fresh.grid.typical, 1.3 * ty, 1e-9);
});

test("Mode A on a steep home: a match explains 100% of the meter", () => {
  const devs = [
    ...fans(),
    dev("led", { method: "preset_only" }, { profile: "steady", hoursPerDay: 6 }, 4),
    dev("phone", { method: "battery", mAh: 5000 }, { profile: "charges", chargesPerDay: 1 }, 2),
  ];
  const a = gridEnergy(devs, 0).typical + 0.02; // just above the battery-only floor: ~0.5h of light
  const { result, values } = calibrateGrid(devs, { source: "none", value: null }, actual(a));
  assert.equal(result.status, "matched");
  assert.equal(Math.round(result.coverage! * 100), 100);
  near(values.reduce((x, y) => x + y, 0), a, 0.001 * a);
});
