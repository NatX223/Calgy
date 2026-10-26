// Run with: npm test  (node --test, native TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { predictedLph, type GenSpec, type Split } from "./calibration.ts";
import type { Range } from "./energy.ts";
import { costMode, fuelModel, lastsDays } from "./sim-modes.ts";

const r = (v: number): Range => ({ low: v * 0.8, typical: v, high: v * 1.2 });
const zero = r(0);
const petrol2kw: GenSpec = { kwLow: 2, kwHigh: 2, fuelType: "petrol" };
const near = (a: number, e: number, tol = 1e-9) => assert.ok(Math.abs(a - e) <= tol, `expected ~${e}, got ${a}`);

test("fuel model: idle 0.45 L/h + 0.275 L per kWh on a 2 kW petrol gen", () => {
  const f = fuelModel(petrol2kw);
  near(f.idleLph, 0.45);
  near(f.litresPerKwh, 0.275);
});

test("gen only: total fuel matches the burn model at the average load", () => {
  const splits: Split[] = [{ grid: zero, gen: r(0.6) }, { grid: zero, gen: r(0.4) }];
  const { rows, totals } = costMode(splits, [true, true], 5, petrol2kw, { tariff: null, nairaPerLitre: 1000 });
  near(totals.litres.typical, predictedLph(petrol2kw, 1 / 5) * 5); // 0.505 L/h × 5h
  near(totals.idleLitres, 2.25);
  near(rows[0].litres.typical, 0.6 * 0.275);
  near(totals.naira!.typical, totals.litres.typical * 1000);
  near(totals.loadKw!, 0.2);
  assert.equal(totals.overload, false);
});

test("switching a device off drops its marginal fuel; everything off means no idle burn", () => {
  const splits: Split[] = [{ grid: zero, gen: r(0.6) }, { grid: zero, gen: r(0.4) }];
  const one = costMode(splits, [true, false], 5, petrol2kw, { tariff: null, nairaPerLitre: 1000 }).totals;
  near(one.litres.typical, 2.25 + 0.6 * 0.275);
  const none = costMode(splits, [false, false], 5, petrol2kw, { tariff: null, nairaPerLitre: 1000 }).totals;
  near(none.litres.typical, 0);
});

test("hybrid: light at the tariff plus gen fuel; a missing price leaves ₦ unknown", () => {
  const splits: Split[] = [{ grid: r(1), gen: r(0.5) }, { grid: r(2), gen: zero }];
  const { rows, totals } = costMode(splits, [true, true], 4, petrol2kw, { tariff: 200, nairaPerLitre: 1000 });
  near(totals.gridNaira!.typical, 600);
  near(totals.genNaira!.typical, (1.8 + 0.5 * 0.275) * 1000);
  near(totals.naira!.typical, totals.gridNaira!.typical + totals.genNaira!.typical);
  near(rows[1].naira!.typical, 400);
  const noTariff = costMode(splits, [true, true], 4, petrol2kw, { tariff: null, nairaPerLitre: 1000 });
  assert.equal(noTariff.totals.naira, null);
  assert.equal(noTariff.rows[1].naira, null);
});

test("overload when the average load is bigger than the gen", () => {
  const { totals } = costMode([{ grid: zero, gen: r(12) }], [true], 4, petrol2kw, { tariff: null, nairaPerLitre: null });
  assert.equal(totals.overload, true);
  assert.equal(totals.genNaira, null);
});

test("lasts: litres ÷ litres a day", () => {
  near(lastsDays(10, 2.5), 4);
  assert.equal(lastsDays(10, 0), Infinity);
});
