// Log collections under users/{uid}. Clients write these directly (offline-first).
// Shapes use ISO strings; fields in TIMESTAMP_FIELDS are Firestore Timestamps at rest.
import { z } from "zod";
import { isoDay, isoTime } from "./common.ts";

export const COLLECTIONS = ["devices", "meterReadings", "tokenLoads", "fuelPurchases", "generators"] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

/** Set by the data layer on every write; `createdAt` keeps the original time for migrated/imported docs. */
const meta = {
  clientId: z.string().min(1),
  createdAt: isoTime.optional(),
  updatedAt: isoTime.optional(),
};
const id = z.string().min(1);

/** A device in My Home. Rating/usage are validated by the engine (`normaliseDevice`); kept loose here. */
export const DeviceDocSchema = z.looseObject({
  id,
  ...meta,
  /** Order in My Home. */
  pos: z.number().int().min(0),
  name: z.string(),
  quantity: z.number().min(0),
  rating: z.looseObject({}),
  usage: z.looseObject({}),
});

export const MeterReadingDocSchema = z.object({
  id,
  ...meta,
  unitsLeft: z.number().min(0),
  takenAt: isoTime,
  context: z.enum(["onboarding", "before_token", "check_in"]),
  meterDaysLeft: z.number().min(0).optional(),
  meterDailyAvgKwh: z.number().positive().optional(),
});

export const TokenLoadDocSchema = z.object({
  id,
  ...meta,
  amountNaira: z.number().positive(),
  unitsReceived: z.number().positive().nullable(),
  /** ₦/kWh, 2dp. */
  unitPrice: z.number().nullable(),
  /** Day it counts towards in the spend log. */
  date: isoDay,
  loadedAt: isoTime,
  /** The meter reading taken just before loading. */
  beforeReadingId: z.string().nullable(),
  note: z.string().nullable(),
});

/** A fuel purchase. `generatorId` set = it feeds the generator numbers (needs litres). */
export const FuelPurchaseDocSchema = z.object({
  id,
  ...meta,
  amountNaira: z.number().positive(),
  litres: z.number().positive().nullable(),
  /** ₦/L, 2dp. */
  unitPrice: z.number().nullable(),
  purchasedAt: isoDay,
  note: z.string().nullable(),
  generatorId: z.string().nullable(),
  hoursRun: z.number().positive().nullable(),
  source: z.enum(["onboarding", "log"]).nullable(),
});

export const GeneratorDocSchema = z.object({
  id,
  ...meta,
  sizeSource: z.enum(["card", "entered", "not_sure"]),
  typeId: z.string().optional(),
  ratingValue: z.number().min(0).optional(),
  ratingUnit: z.enum(["kVA", "kW"]).optional(),
  kwLow: z.number().min(0),
  kwHigh: z.number().min(0),
  fuelType: z.enum(["petrol", "diesel"]),
});

export type DeviceDoc = z.infer<typeof DeviceDocSchema>;
export type MeterReadingDoc = z.infer<typeof MeterReadingDocSchema>;
export type TokenLoadDoc = z.infer<typeof TokenLoadDocSchema>;
export type FuelPurchaseDoc = z.infer<typeof FuelPurchaseDocSchema>;
export type GeneratorDoc = z.infer<typeof GeneratorDocSchema>;

export type LogDocs = {
  devices: DeviceDoc;
  meterReadings: MeterReadingDoc;
  tokenLoads: TokenLoadDoc;
  fuelPurchases: FuelPurchaseDoc;
  generators: GeneratorDoc;
};

export const LOG_SCHEMAS: { [K in CollectionName]: z.ZodType<LogDocs[K]> } = {
  devices: DeviceDocSchema,
  meterReadings: MeterReadingDocSchema,
  tokenLoads: TokenLoadDocSchema,
  fuelPurchases: FuelPurchaseDocSchema,
  generators: GeneratorDocSchema,
};

/** Fields stored as Firestore Timestamps. Everything else is stored as-is. */
export const TIMESTAMP_FIELDS: { [K in CollectionName]: readonly string[] } = {
  devices: ["createdAt", "updatedAt"],
  meterReadings: ["createdAt", "updatedAt", "takenAt"],
  tokenLoads: ["createdAt", "updatedAt", "loadedAt"],
  fuelPurchases: ["createdAt", "updatedAt"],
  generators: ["createdAt", "updatedAt"],
};

/**
 * Field each collection lists newest-first by (devices keep their My Home order). Docs missing the field
 * are left out of ordered queries, so it's always one the client sets (never a pending server timestamp).
 * `null` = no ordering.
 */
export const ORDER_BY: { [K in CollectionName]: { field: string; dir: "asc" | "desc" } | null } = {
  devices: { field: "pos", dir: "asc" },
  meterReadings: { field: "takenAt", dir: "desc" },
  tokenLoads: { field: "loadedAt", dir: "desc" },
  fuelPurchases: { field: "purchasedAt", dir: "desc" },
  generators: null,
};
