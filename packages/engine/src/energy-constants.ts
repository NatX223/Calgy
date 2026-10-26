// Every tunable number the device energy engine uses. [low, typical, high] triples
// are ordered so that picking index 0/1/2 everywhere gives the low/typical/high estimate.

export type Triple = [number, number, number];

export const MAINS_VOLTS = 230; // Nigeria nominal (220–240V)

/** Nominal cell voltage by battery device type. */
export const DEFAULT_NOMINAL_V = { phone: 3.85, tablet: 3.8, powerbank: 3.7, mifi: 3.85, liion_generic: 3.7 } as const;
export type NominalKind = keyof typeof DEFAULT_NOMINAL_V;

/** Wall → battery efficiency. High efficiency means *less* energy, so these are [for low, typ, for high]. */
export const CHARGE_EFFICIENCY: { wired: Triple; wireless: Triple } = {
  wired: [0.9, 0.85, 0.8],
  wireless: [0.75, 0.65, 0.6],
};

/** Real average draw ÷ adapter V×A rating. */
export const ADAPTER_TYPICAL_FACTOR: Triple = [0.25, 0.4, 0.6];
/** Battery MiFi/routers: adapter-derived draw is capped here. */
export const MIFI_MAX_W = 10;

export const W_PER_HP_MOTOR = 746;
/** Motor efficiency, ordered for [low, typ, high] watts. */
export const MOTOR_EFFICIENCY: Triple = [0.8, 0.75, 0.7];

export const BTU_PER_HP_AC = 9000; // Nigerian AC labels: 1HP ≈ 9,000 BTU/h cooling
export const W_PER_BTU_H = 0.29307; // cooling watts per BTU/h
/** Cooling W ÷ electrical W, ordered for [low, typ, high] watts (efficient → old/poor). */
export const AC_COP: Triple = [3.4, 2.9, 2.4];

/** Microwave output (cooking) W → input W. */
export const MICROWAVE_OUTPUT_TO_INPUT: Triple = [1.4, 1.5, 1.6];

/** Spread applied around a preset's typical-use factor when it is below 1 (capped at 1). */
export const FACTOR_SPREAD: Triple = [0.7, 1, 1.3];

/** Laptop draw while plugged in, by workload. */
export const LAPTOP_WORKLOAD_W = {
  light: [10, 18, 30],
  moderate: [25, 35, 50],
  heavy: [50, 70, 100],
} satisfies Record<string, Triple>;
/** Desktops and consoles: workload scales the moderate draw (capped at label watts). */
export const WORKLOAD_SCALE = { light: 0.5, moderate: 1, heavy: 2 } as const;

/** Compressor pull-down after an outage: fridges/freezers/24h cycling devices on partial supply. */
export const RECOVERY_FACTOR = 1.1;
export const DEFAULT_OUTAGES_PER_DAY = 1;

export const MONTH_DAYS = 30;
