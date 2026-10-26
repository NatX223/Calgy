// users/{uid}: the household's settings. Only the API writes it (PATCH /v1/me); clients read it.
import { z } from "zod";
import { ConfidenceSchema, hhmm, isoDay, isoTime, PowerSourceSchema } from "./common.ts";

export const DEFAULT_TIMEZONE = "Africa/Lagos";

/** An IANA zone this runtime knows ("Africa/Lagos"). */
export const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Highest ₦/kWh override accepted (well above any real tariff). */
export const MAX_TARIFF_OVERRIDE = 10_000;

export const OnboardingSchema = z.object({
  completed: z.boolean(),
  source: PowerSourceSchema,
});

/** Rough spend guesses from the quick estimate. */
export const HouseholdSchema = z.object({
  fuelWeekly: z.number().min(0),
  tokenMonthly: z.number().min(0),
});

/** Hours of grid supply a day. `value` is kept while `source` is "none" so switching back restores it. */
export const GridHoursSchema = z.object({
  source: z.enum(["user", "inferred", "none"]),
  value: z.number().min(0).max(24).nullable(),
  inferredRange: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]).nullable(),
});

export const MeterProfileSchema = z.object({
  meterDailyAvgKwh: z.number().positive().nullable(),
  lifetimeKwh: z.number().positive().nullable(),
  /** Not after tomorrow (UTC), so a user ahead of UTC can still pick their today. */
  meterStartDate: isoDay
    .refine((d) => Date.parse(d) <= Date.now() + 86_400_000, "Can't be in the future")
    .nullable(),
});

export const MeterStateSchema = z.object({
  /** Tokens logged in a row without a before-reading. */
  tokenSkips: z.number().int().min(0),
  /** Kept own light hours over the meter's suggestion at this confidence. */
  suggestionKeptAt: ConfidenceSchema.nullable(),
});

/** Weekly "check your meter" reminder. `day` 0–6 = Sun–Sat. */
export const ReminderSchema = z.object({
  enabled: z.boolean(),
  day: z.number().int().min(0).max(6),
  time: hhmm,
  timezone: z.string().min(1).refine(isTimeZone, "Unknown time zone"),
});

export const UserSettingsSchema = z.object({
  calibrationEnabled: z.boolean(),
  shareAnonymousData: z.boolean(),
  reminder: ReminderSchema,
  lastExport: isoTime.nullable(),
});

/** Solar Compare answers; validated in detail by the engine's normaliseSolar. */
export const SolarSchema = z.record(z.string(), z.unknown());

export const UserDocSchema = z.object({
  uid: z.string().min(1),
  createdAt: isoTime,
  updatedAt: isoTime,
  onboarding: OnboardingSchema,
  household: HouseholdSchema,
  gridHours: GridHoursSchema,
  meterProfile: MeterProfileSchema,
  meterState: MeterStateSchema,
  /** ₦/kWh the user typed in over the one worked out from tokens. */
  tariffOverride: z.number().positive().max(MAX_TARIFF_OVERRIDE).nullable(),
  solar: SolarSchema.nullable(),
  settings: UserSettingsSchema,
});
export type UserDoc = z.infer<typeof UserDocSchema>;

/** PATCH /v1/me body: any group, any subset of its fields. Groups merge one level deep (reminder two). */
export const UserDocPatchSchema = z
  .object({
    onboarding: OnboardingSchema.partial(),
    household: HouseholdSchema.partial(),
    gridHours: GridHoursSchema.partial(),
    meterProfile: MeterProfileSchema.partial(),
    meterState: MeterStateSchema.partial(),
    tariffOverride: UserDocSchema.shape.tariffOverride,
    solar: UserDocSchema.shape.solar,
    settings: UserSettingsSchema.extend({ reminder: ReminderSchema.partial() }).partial(),
  })
  .partial()
  .strict();
export type UserDocPatch = z.infer<typeof UserDocPatchSchema>;

/** Groups that merge field by field; the rest are replaced whole. */
const GROUPS = ["onboarding", "household", "gridHours", "meterProfile", "meterState", "settings"] as const;

export function defaultUserDoc(uid: string, now: string = new Date().toISOString()): UserDoc {
  return {
    uid,
    createdAt: now,
    updatedAt: now,
    onboarding: { completed: false, source: "nepa" },
    household: { fuelWeekly: 0, tokenMonthly: 0 },
    gridHours: { source: "none", value: 8, inferredRange: null },
    meterProfile: { meterDailyAvgKwh: null, lifetimeKwh: null, meterStartDate: null },
    meterState: { tokenSkips: 0, suggestionKeptAt: null },
    tariffOverride: null,
    solar: null,
    settings: {
      calibrationEnabled: true,
      shareAnonymousData: false,
      reminder: { enabled: false, day: 6, time: "09:00", timezone: DEFAULT_TIMEZONE },
      lastExport: null,
    },
  };
}

/** The doc after a patch. Pure; the API and the dev shim both use it. */
export function applyUserDocPatch(doc: UserDoc, patch: UserDocPatch, now?: string): UserDoc {
  const next: UserDoc = { ...doc, updatedAt: now ?? doc.updatedAt };
  for (const g of GROUPS) {
    const p = patch[g];
    if (!p) continue;
    if (g === "settings") {
      const s = p as NonNullable<UserDocPatch["settings"]>;
      next.settings = { ...doc.settings, ...s, reminder: { ...doc.settings.reminder, ...(s.reminder ?? {}) } };
    } else {
      (next as Record<string, unknown>)[g] = { ...doc[g], ...p };
    }
  }
  if (patch.tariffOverride !== undefined) next.tariffOverride = patch.tariffOverride;
  if (patch.solar !== undefined) next.solar = patch.solar;
  return next;
}

/** Combine two patches so applying the result equals applying `a` then `b`. */
export function mergeUserDocPatches(a: UserDocPatch, b: UserDocPatch): UserDocPatch {
  const out: UserDocPatch = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof UserDocPatch, unknown][]) {
    const prev = a[k];
    if (GROUPS.includes(k as (typeof GROUPS)[number]) && prev && v && typeof v === "object") {
      const merged = { ...(prev as object), ...(v as object) } as Record<string, unknown>;
      if (k === "settings") {
        const pr = (prev as NonNullable<UserDocPatch["settings"]>).reminder;
        const vr = (v as NonNullable<UserDocPatch["settings"]>).reminder;
        if (pr || vr) merged.reminder = { ...(pr ?? {}), ...(vr ?? {}) };
      }
      (out as Record<string, unknown>)[k] = merged;
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * A stored doc read leniently: missing or invalid groups fall back to defaults, so an older doc
 * (or one with a field this build doesn't know) never breaks the app.
 */
export function normaliseUserDoc(raw: unknown, uid: string): UserDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = defaultUserDoc(uid, typeof r.createdAt === "string" ? r.createdAt : undefined);
  const group = <T extends object>(schema: z.ZodType<T>, fallback: T, value: unknown): T => {
    const merged = { ...fallback, ...(value && typeof value === "object" ? value : {}) };
    const res = schema.safeParse(merged);
    return res.success ? res.data : fallback;
  };
  const rs = (r.settings && typeof r.settings === "object" ? r.settings : {}) as Record<string, unknown>;
  const reminder = group(ReminderSchema, d.settings.reminder, rs.reminder);
  const tariff = UserDocSchema.shape.tariffOverride.safeParse(r.tariffOverride ?? null);
  const solar = UserDocSchema.shape.solar.safeParse(r.solar ?? null);
  return {
    uid,
    createdAt: d.createdAt,
    updatedAt: typeof r.updatedAt === "string" && isoTime.safeParse(r.updatedAt).success ? r.updatedAt : d.createdAt,
    onboarding: group(OnboardingSchema, d.onboarding, r.onboarding),
    household: group(HouseholdSchema, d.household, r.household),
    gridHours: group(GridHoursSchema, d.gridHours, r.gridHours),
    meterProfile: group(MeterProfileSchema, d.meterProfile, r.meterProfile),
    meterState: group(MeterStateSchema, d.meterState, r.meterState),
    tariffOverride: tariff.success ? tariff.data : null,
    solar: solar.success ? solar.data : null,
    settings: group(UserSettingsSchema, d.settings, { ...rs, reminder }),
  };
}
