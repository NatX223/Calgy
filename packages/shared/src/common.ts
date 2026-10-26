import { z } from "zod";

/** Any string Date.parse understands; stored as a Firestore Timestamp, exchanged as ISO 8601. */
export const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Expected an ISO date-time");
/** A calendar day the user picked, YYYY-MM-DD (no time zone). */
export const isoDay = z.string().regex(/^\d{4}-\d\d-\d\d$/, "Expected YYYY-MM-DD");
/** "HH:MM", 24-hour. */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const PowerSourceSchema = z.enum(["gen", "nepa", "hybrid"]);
export type PowerSource = z.infer<typeof PowerSourceSchema>;

export const ConfidenceSchema = z.enum(["rough", "good", "solid"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;
