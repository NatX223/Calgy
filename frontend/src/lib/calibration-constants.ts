// Tunable numbers for the meter flow and calibration. Fuel-model values are estimates.

import type { Triple } from "./energy-constants.ts";

/** Light hours used when they're neither set by the user nor inferable. */
export const DEFAULT_GRID_HOURS = 12;

// ——— Readings ———

/** A pair of readings closer together than this (days) is too noisy to use. */
export const MIN_PAIR_DAYS = 0.75;
/** Only pairs ending in the last N days count toward the readings average. */
export const READINGS_WINDOW_DAYS = 30;
/** A pair is an outlier above this many × the median of the other valid pairs… */
export const OUTLIER_MEDIAN_MULTIPLE = 3;
/** …or above this many kWh a day outright. */
export const OUTLIER_MAX_KWH_PER_DAY = 50;
/** Before-token readings are stamped this long before the token. */
export const BEFORE_TOKEN_OFFSET_MS = 60_000;
/** Remind about a check-in once the last reading is this old. */
export const STALE_READING_DAYS = 7;

/** [readings, meter average, lifetime] weights; renormalised over the sources present. */
export const BLEND_NO_READINGS: Triple = [0, 0.7, 0.3];
/** First row whose `below` exceeds the readings span (days) applies. */
export const BLEND_WEIGHTS: { below: number; w: Triple }[] = [
  { below: 3, w: [0.3, 0.5, 0.2] },
  { below: 14, w: [0.6, 0.3, 0.1] },
  { below: Infinity, w: [0.85, 0.1, 0.05] },
];
/** Grid confidence: good from `good` days of readings, solid from `solid` days with `solidPairs` pairs. */
export const GRID_CONFIDENCE = { good: 3, solid: 14, solidPairs: 3 };

// ——— Grid calibration ———

export const SOLVE_TOLERANCE_H = 0.05;
/** …and keep going until the devices' total is this close to the meter (fraction), so a match reads 100%. */
export const SOLVE_TOLERANCE_ENERGY = 0.001;
export const SOLVE_MAX_ITER = 40;
/** Mode B case 2 / mismatch scale limits. */
export const K_MIN = 0.5;
export const K_MAX = 2;
/** Suggest the inferred hours when they differ from the user's by more than max(hours, fraction × user's). */
export const SUGGEST_DIFF_HOURS = 3;
export const SUGGEST_DIFF_FRACTION = 0.3;
/** Coverage outside this band shows the mismatch prompts. */
export const COVERAGE_OK: [number, number] = [0.7, 1.3];
/** Below this grid coverage, mention shared meters. */
export const SHARED_METER_COVERAGE = 0.5;

/** Calibrated display range, ± fraction by confidence. */
export const CONFIDENCE_SPREAD = { rough: 0.25, good: 0.15, solid: 0.08 } as const;

// ——— Generator ———

// ESTIMATE: tune with logged data.
/** Fuel at full rated load, litres per kWh delivered: [efficient, typical, poor]. */
export const L_PER_KWH_FULL: Record<"petrol" | "diesel", Triple> = {
  petrol: [0.45, 0.5, 0.6],
  diesel: [0.28, 0.33, 0.4],
};
// ESTIMATE: tune with logged data.
/** Fuel at zero load as a fraction of full-load burn: [efficient, typical, poor]. */
export const IDLE_FRACTION: Record<"petrol" | "diesel", Triple> = {
  petrol: [0.35, 0.45, 0.5],
  diesel: [0.25, 0.3, 0.4],
};

/** Simulator Hybrid tab: gen hours a day to assume before any fuel is logged with hours. */
export const ASSUMED_HYBRID_GEN_HOURS = 4;

/** Gen confidence by purchases with hours: rough below `good`, solid from `solid`. */
export const GEN_CONFIDENCE = { good: 3, solid: 6 };
/** Gen coverage band treated as matched. */
export const GEN_COVERAGE_OK: [number, number] = [0.7, 1.3];
/** Below this load fraction the gen is oversized for what it runs. */
export const GEN_OVERSIZED_LOAD = 0.25;

/** Preset ids rarely run on a home gen; they default to grid only in hybrid homes. */
export const GRID_ONLY_PRESETS = ["ac-1hp", "ac-15hp", "ac-2hp", "ac-15hp-inv", "heater", "pump-05", "pump-1", "kettle", "iron"];
