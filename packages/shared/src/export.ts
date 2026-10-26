// Settings → Data & privacy → Export / Import.
import { z } from "zod";
import { isoTime } from "./common.ts";
import {
  DeviceDocSchema, FuelPurchaseDocSchema, GeneratorDocSchema, MeterReadingDocSchema, TokenLoadDocSchema,
} from "./logs.ts";
import { UserDocSchema } from "./user-doc.ts";

export const EXPORT_VERSION = 1;

export const ExportFileSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  exportedAt: isoTime,
  userDoc: UserDocSchema,
  devices: z.array(DeviceDocSchema),
  meterReadings: z.array(MeterReadingDocSchema),
  tokenLoads: z.array(TokenLoadDocSchema),
  fuelPurchases: z.array(FuelPurchaseDocSchema),
  generators: z.array(GeneratorDocSchema),
});
export type ExportFile = z.infer<typeof ExportFileSchema>;

export const exportFileName = (d: Date) =>
  `calgy-export-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
