// Run with: npm test  (node --test, native TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dailyEnergyFullSupply, dailyEnergyWithSupply, homeTotals, inferGridHours, resolveDraw,
  type Device, type DeviceRating, type DeviceUsage,
} from "./energy.ts";

const dev = (presetId: string | null, rating: DeviceRating, usage: DeviceUsage, quantity = 1): Device => ({
  id: Math.random().toString(36).slice(2), presetId, name: "t", category: "other", icon: "", quantity, rating, usage,
  createdAt: "", updatedAt: "",
});
const near = (actual: number, expected: number, tol = 0.05) =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.abs(expected), `expected ~${expected}, got ${actual}`);

test("12V ⎓ 2A router → max 24W, typical ~9.6W, range 6–14.4W", () => {
  const d = dev("router", { method: "volts_amps", volts: 12, amps: 2 }, { profile: "steady", hoursPerDay: 24 });
  const r = resolveDraw(d);
  near(r.low, 6, 0.001);
  near(r.typical, 9.6, 0.001);
  near(r.high, 14.4, 0.001);
});

test("mA toggle and mains-side ratings", () => {
  near(resolveDraw(dev("router", { method: "volts_amps", volts: 12, amps: 2000, ampsIsMilli: true }, { profile: "steady", hoursPerDay: 1 })).typical, 9.6, 0.001);
  near(resolveDraw(dev("router", { method: "volts_amps", volts: 240, amps: 0.5 }, { profile: "steady", hoursPerDay: 1 })).typical, 230 * 0.5 * 0.4, 0.001);
});

test("phone 5,000mAh, 2.5 charges/day, wired → ~56.6Wh/day", () => {
  const d = dev("phone", { method: "battery", mAh: 5000 }, { profile: "charges", chargesPerDay: 2.5 });
  near(dailyEnergyFullSupply(d).typical, (19.25 / 0.85) * 2.5, 0.001);
  near(dailyEnergyWithSupply(d, 4).typical, 56.6, 0.01); // battery devices aren't capped by grid hours
  near(dailyEnergyFullSupply({ ...d, usage: { ...d.usage, wireless: true } }).typical, (19.25 / 0.65) * 2.5, 0.001);
});

test("MiFi 5,000mAh, 8h battery life, G = 8 → ~2.4W, ~45.2Wh/day from the grid", () => {
  const d = dev("mifi", { method: "battery", mAh: 5000, batteryLifeHours: 8 }, { profile: "always_on_battery" });
  near(resolveDraw(d).typical, 2.4, 0.01);
  near(dailyEnergyWithSupply(d, 8).typical, 45.2, 0.01);
  near(dailyEnergyFullSupply(d).typical, (19.25 / 8) * 24 / 0.85, 0.001);
});

test("MiFi adapter-only draw is capped at 10W", () => {
  const d = dev("mifi", { method: "battery", mAh: 5000, volts: 12, amps: 3 }, { profile: "always_on_battery" });
  const r = resolveDraw(d);
  assert.equal(r.high, 10);
  near(r.typical, 10, 0.001); // 36W × 0.4 = 14.4 → capped
});

test("AC 1.5HP from BTU → typical ~1,213W", () => {
  const d = dev("ac-15hp", { method: "hp_btu", btu: 12000, hpKind: "ac_cooling" }, { profile: "cycling", hoursPerDay: 6, dutyPercent: 70 });
  near(resolveDraw(d).typical, 1213, 0.002);
  near(resolveDraw(dev("ac-15hp", { method: "preset_only" }, d.usage)).typical, 1213, 0.002);
  near(resolveDraw(dev("ac-15hp", { method: "hp_btu", watts: 1100, hpKind: "ac_cooling" }, d.usage)).typical, 1100, 0.001);
});

test("pumping machine 1HP → ~995W typical (746 ÷ 0.75)", () => {
  const r = resolveDraw(dev("pump-1", { method: "preset_only" }, { profile: "steady", hoursPerDay: 0.5 }));
  near(r.low, 932.5, 0.001);
  near(r.typical, 994.7, 0.001);
  near(r.high, 1065.7, 0.001);
});

test("fridge 425 kWh/yr, G = 8 → ~427Wh/day", () => {
  const d = dev("fridge-freezer", { method: "kwh_year", kwhPerYear: 425 }, { profile: "cycling", hoursPerDay: 24, dutyPercent: 45 });
  near(dailyEnergyFullSupply(d).typical, 1164.4, 0.001); // duty not applied twice
  near(dailyEnergyWithSupply(d, 8).typical, 427, 0.002);
});

test("laptop moderate, plugged 10h, G = 8 → 280Wh", () => {
  const d = dev("laptop-plugged", { method: "preset_only" }, { profile: "steady", hoursPerDay: 10, workload: "moderate" });
  near(dailyEnergyWithSupply(d, 8).typical, 280, 0.001);
  // A 30W charger caps the high tier
  const capped = dev("laptop-plugged", { method: "volts_amps", volts: 15, amps: 2 }, d.usage);
  assert.equal(resolveDraw(capped).high, 30);
});

test("label watts get the preset's typical-use factor; preset_only keeps its range", () => {
  const tv = dev("tv-32", { method: "watts", watts: 50 }, { profile: "steady", hoursPerDay: 5 });
  near(resolveDraw(tv).typical, 40, 0.001);
  const typ = resolveDraw(dev("tv-32", { method: "preset_only" }, tv.usage));
  assert.deepEqual([typ.low, typ.typical, typ.high].map((x) => Math.round(x)), [16, 32, 48]);
  const kettle = resolveDraw(dev("kettle", { method: "watts", watts: 2000 }, tv.usage));
  assert.equal(kettle.low, 2000);
  assert.equal(kettle.high, 2000);
});

test("microwave output-only label is converted to input", () => {
  const d = dev("microwave", { method: "watts", watts: 800, wattsIsOutput: true }, { profile: "steady", hoursPerDay: 0.25 });
  near(resolveDraw(d).typical, 1200, 0.001);
});

test("tier override collapses the range; mains devices are capped by grid hours", () => {
  const fan = dev("standing-fan", { method: "preset_only" }, { profile: "steady", hoursPerDay: 12 }, 2);
  const r = dailyEnergyWithSupply(fan, 8);
  near(r.typical, 60 * 8 * 2, 0.001);
  const pinned = dailyEnergyWithSupply({ ...fan, tierOverride: "high" }, 8);
  assert.equal(pinned.low, pinned.high);
  near(pinned.typical, 90 * 8 * 2, 0.001);
});

test("homeTotals and inferGridHours round-trip", () => {
  const devices = [
    dev("standing-fan", { method: "preset_only" }, { profile: "steady", hoursPerDay: 12 }, 2),
    dev("fridge-freezer", { method: "preset_only" }, { profile: "cycling", hoursPerDay: 24, dutyPercent: 45 }),
    dev("phone", { method: "preset_only" }, { profile: "charges", chargesPerDay: 1 }, 2),
  ];
  const t = homeTotals(devices, 10, 30, 200);
  near(t.naira!.typical, t.kwh.typical * 200, 1e-9);
  const meter = homeTotals(devices, 10, 1).kwh.typical;
  assert.equal(inferGridHours(devices, meter), 10);
  assert.equal(inferGridHours(devices, 1000), null);
});
