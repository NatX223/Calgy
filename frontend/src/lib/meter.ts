// Prepaid meter: readings, tokens, actual daily usage, units and days left. Pure functions only.
// Imports carry .ts extensions so `node --test` can run the unit tests without a build step.

import {
  BLEND_NO_READINGS, BLEND_WEIGHTS, GRID_CONFIDENCE, MIN_PAIR_DAYS, OUTLIER_MAX_KWH_PER_DAY, OUTLIER_MEDIAN_MULTIPLE,
  READINGS_WINDOW_DAYS,
} from "./calibration-constants.ts";
import { iso } from "./format.ts";
import type { Entry } from "./spend.ts";

export type Confidence = "rough" | "good" | "solid";

export interface MeterReading {
  id: string;
  unitsLeft: number; // kWh
  takenAt: string; // ISO datetime
  context: "onboarding" | "before_token" | "check_in";
  meterDaysLeft?: number; // if the user also noted "days left"
  meterDailyAvgKwh?: number; // if the user also noted the meter's average
}

export interface TokenLoad {
  id: string;
  amountNaira: number;
  unitsReceived: number | null;
  loadedAt: string; // ISO datetime
  beforeReadingId?: string; // MeterReading taken just before loading
}

export interface MeterProfile {
  meterDailyAvgKwh?: number; // latest value the user noted
  lifetimeKwh?: number;
  meterStartDate?: string; // YYYY-MM-DD
}

export interface GridHoursSetting {
  source: "user" | "inferred" | "none";
  value: number | null;
  inferredRange?: [number, number];
}

const DAY_MS = 864e5;
const ms = (s: string) => Date.parse(s);
const toMs = (now: Date | string) => (typeof now === "string" ? ms(now) : now.getTime());
const pos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Fractional days from a to b. */
export const daysBetween = (a: string, b: string) => (ms(b) - ms(a)) / DAY_MS;
export const daysSince = (a: string, now: Date | string) => (toMs(now) - ms(a)) / DAY_MS;

/** Token entries logged before load times were captured: treat them as loaded at local noon. */
export function localNoon(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

/** Tokens live in the spend log; this is the meter's view of them. */
export const tokensFromEntries = (entries: Entry[]): TokenLoad[] =>
  entries
    .filter((e) => e.type === "token")
    .map((e) => ({
      id: e.id,
      amountNaira: e.amount_naira,
      unitsReceived: e.quantity,
      loadedAt: e.loaded_at ?? localNoon(e.date),
      beforeReadingId: e.before_reading_id ?? undefined,
    }));

export const sortReadings = (rs: MeterReading[]) => [...rs].sort((a, b) => ms(a.takenAt) - ms(b.takenAt));
export const latestReading = (rs: MeterReading[]): MeterReading | null => sortReadings(rs).at(-1) ?? null;
export const tokensAfter = (tokens: TokenLoad[], at: string, until?: string) =>
  tokens.filter((k) => ms(k.loadedAt) > ms(at) && (until == null || ms(k.loadedAt) <= ms(until)));

// ——— Usage between readings (§B2.1) ———

/** Why a pair is left out: units went up, a token in the window has no units, implausible, or too close together. */
export type PairFlag = "suspect" | "missing_units" | "outlier" | "short";

export interface ReadingPair {
  from: MeterReading;
  to: MeterReading;
  days: number;
  used: number | null; // kWh; null when a token in the window has no units
  perDay: number | null;
  tokenIds: string[]; // tokens loaded in (from, to]
  missingTokenId?: string;
  flag?: PairFlag;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Consecutive reading pairs with their usage and any reason to exclude them. */
export function readingPairs(readings: MeterReading[], tokens: TokenLoad[]): ReadingPair[] {
  const rs = sortReadings(readings);
  const pairs: ReadingPair[] = [];
  for (let i = 1; i < rs.length; i++) {
    const from = rs[i - 1];
    const to = rs[i];
    const win = tokensAfter(tokens, from.takenAt, to.takenAt);
    const missing = win.find((k) => !pos(k.unitsReceived));
    const days = daysBetween(from.takenAt, to.takenAt);
    const used = missing ? null : from.unitsLeft + win.reduce((t, k) => t + (k.unitsReceived ?? 0), 0) - to.unitsLeft;
    const flag: PairFlag | undefined = missing
      ? "missing_units"
      : used! < 0
        ? "suspect"
        : days < MIN_PAIR_DAYS
          ? "short"
          : undefined;
    pairs.push({
      from, to, days, used, perDay: used != null && days > 0 ? used / days : null,
      tokenIds: win.map((k) => k.id), missingTokenId: missing?.id, flag,
    });
  }
  // Outliers are judged against the other valid pairs, all at once.
  const valid = pairs.filter((p) => !p.flag);
  const outliers = valid.filter((p) => {
    const others = valid.filter((q) => q !== p).map((q) => q.perDay!);
    const med = others.length ? median(others) : 0;
    return p.perDay! > OUTLIER_MAX_KWH_PER_DAY || (med > 0 && p.perDay! > OUTLIER_MEDIAN_MULTIPLE * med);
  });
  outliers.forEach((p) => (p.flag = "outlier"));
  return pairs;
}

export interface ActualDaily {
  value: number | null; // kWh/day
  sources: { readings?: number; meterAvg?: number; lifetime?: number };
  spanDays: number;
  validPairs: number;
  confidence: Confidence | null;
  pairs: ReadingPair[];
}

/** Actual grid kWh/day: valid reading pairs in the last 30 days, blended with the meter's own average and lifetime figures. */
export function computeActualDaily(
  readings: MeterReading[],
  tokens: TokenLoad[],
  profile: MeterProfile,
  now: Date | string,
): ActualDaily {
  const pairs = readingPairs(readings, tokens);
  const cutoff = toMs(now) - READINGS_WINDOW_DAYS * DAY_MS;
  const recent = pairs.filter((p) => !p.flag && ms(p.to.takenAt) >= cutoff);
  const spanDays = recent.reduce((t, p) => t + p.days, 0);
  const used = recent.reduce((t, p) => t + p.used!, 0);

  const sources: ActualDaily["sources"] = {};
  if (recent.length && spanDays > 0) sources.readings = used / spanDays;
  if (pos(profile.meterDailyAvgKwh)) sources.meterAvg = profile.meterDailyAvgKwh;
  if (pos(profile.lifetimeKwh) && profile.meterStartDate) {
    const d = daysSince(localNoon(profile.meterStartDate), now);
    if (d >= 1) sources.lifetime = profile.lifetimeKwh / d;
  }

  const w = recent.length ? BLEND_WEIGHTS.find((r) => spanDays < r.below)!.w : BLEND_NO_READINGS;
  const parts: [number | undefined, number][] = [
    [sources.readings, w[0]],
    [sources.meterAvg, w[1]],
    [sources.lifetime, w[2]],
  ];
  const present = parts.filter(([v, wt]) => v != null && wt > 0) as [number, number][];
  const wSum = present.reduce((t, [, wt]) => t + wt, 0);
  const value = wSum > 0 ? present.reduce((t, [v, wt]) => t + v * wt, 0) / wSum : null;

  const { good, solid, solidPairs } = GRID_CONFIDENCE;
  const confidence: Confidence | null =
    value == null
      ? null
      : !recent.length || spanDays < good
        ? "rough"
        : spanDays >= solid && recent.length >= solidPairs
          ? "solid"
          : "good";

  return { value, sources, spanDays, validPairs: recent.length, confidence, pairs };
}

// ——— Units and days left (§A6) ———

export interface UnitsNow {
  units: number;
  /** false when there's no usage figure yet, so this is the last reading plus any tokens since. */
  estimated: boolean;
  /** A token since the reading has no units, so this undercounts. */
  missingUnits: boolean;
}

export function estimateUnitsNow(
  lastReading: MeterReading,
  tokensSince: TokenLoad[],
  actualDaily: number | null,
  now: Date | string,
): UnitsNow {
  const toks = tokensAfter(tokensSince, lastReading.takenAt);
  const loaded = toks.reduce((t, k) => t + (k.unitsReceived ?? 0), 0);
  const used = pos(actualDaily) ? actualDaily * Math.max(0, daysSince(lastReading.takenAt, now)) : 0;
  return {
    units: Math.max(0, lastReading.unitsLeft + loaded - used),
    estimated: pos(actualDaily),
    missingUnits: toks.some((k) => !pos(k.unitsReceived)),
  };
}

export interface DaysLeft {
  low: number;
  high: number;
  /** YYYY-MM-DD, from the lower bound. */
  buyBy: string;
}

/** Days left as a range over every figure we have: calibrated usage, the meter's average, the meter's own countdown. */
export function daysLeftRange(
  estimatedUnitsNow: number,
  actualDaily: number | null,
  lastReading: MeterReading,
  profile: MeterProfile,
  now: Date | string,
  tokensSince: TokenLoad[] = [],
): DaysLeft | null {
  const since = Math.max(0, daysSince(lastReading.takenAt, now));
  const toks = tokensAfter(tokensSince, lastReading.takenAt);
  const loaded = toks.reduce((t, k) => t + (k.unitsReceived ?? 0), 0);
  const avg = lastReading.meterDailyAvgKwh ?? profile.meterDailyAvgKwh;
  const vals: number[] = [];
  if (pos(actualDaily)) vals.push(estimatedUnitsNow / actualDaily);
  if (pos(avg)) vals.push((lastReading.unitsLeft + loaded) / avg - since);
  // A token since the reading makes the meter's own countdown stale.
  if (lastReading.meterDaysLeft != null && !toks.length) vals.push(lastReading.meterDaysLeft - since);
  if (!vals.length) return null;
  const low = Math.max(0, Math.round(Math.min(...vals)));
  const high = Math.max(0, Math.round(Math.max(...vals)));
  return { low, high, buyBy: iso(new Date(toMs(now) + low * DAY_MS)) };
}

// ——— Tariff ———

/** Mean ₦/kWh of the last 3 tokens that have units. */
export function meterTariff(tokens: TokenLoad[]): { value: number; count: number } | null {
  const last = tokens
    .filter((k) => pos(k.unitsReceived) && k.amountNaira > 0)
    .sort((a, b) => ms(b.loadedAt) - ms(a.loadedAt))
    .slice(0, 3);
  if (!last.length) return null;
  return { value: last.reduce((t, k) => t + k.amountNaira / k.unitsReceived!, 0) / last.length, count: last.length };
}

// ——— Input checks ———

/** Units left: ≥ 0, at most one decimal. */
export const unitsError = (s: string) => {
  if (!s.trim()) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return "Enter the units on your meter.";
  return Math.round(n * 10) !== n * 10 ? "Use at most one decimal place." : null;
};

export const futureError = (isoTime: string, now: Date | string = new Date()) =>
  ms(isoTime) > toMs(now) + 60_000 ? "That time is in the future." : null;

// ——— Stored state ———

export type ReminderDay = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun–Sat

export interface MeterState {
  profile: MeterProfile;
  /** Tokens logged in a row without a before-reading. */
  tokenSkips: number;
  /** Weekly "check your meter" reminder; off by default. */
  reminder: { on: boolean; day: ReminderDay; time: string }; // time "HH:MM"
  /** Kept own light hours over the meter's suggestion at this confidence; re-shown once confidence improves. */
  suggestionKeptAt: Confidence | null;
}

export const DEFAULT_METER_STATE: MeterState = {
  profile: {},
  tokenSkips: 0,
  reminder: { on: false, day: 6, time: "09:00" },
  suggestionKeptAt: null,
};

/** Fixed id for the onboarding reading, so redoing onboarding replaces it. */
export const OB_READING_ID = "ob-reading";

const CONF_RANK: Record<Confidence, number> = { rough: 0, good: 1, solid: 2 };
export const confidenceAbove = (a: Confidence | null, b: Confidence | null) =>
  (a ? CONF_RANK[a] : -1) > (b ? CONF_RANK[b] : -1);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function normaliseMeterState(raw: unknown): MeterState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<MeterState>;
  const p = (s.profile && typeof s.profile === "object" ? s.profile : {}) as MeterProfile;
  const r = (s.reminder && typeof s.reminder === "object" ? s.reminder : {}) as Partial<MeterState["reminder"]>;
  return {
    profile: {
      meterDailyAvgKwh: pos(p.meterDailyAvgKwh) ? p.meterDailyAvgKwh : undefined,
      lifetimeKwh: pos(p.lifetimeKwh) ? p.lifetimeKwh : undefined,
      meterStartDate: typeof p.meterStartDate === "string" && /^\d{4}-\d\d-\d\d$/.test(p.meterStartDate) ? p.meterStartDate : undefined,
    },
    tokenSkips: isNum(s.tokenSkips) ? s.tokenSkips : 0,
    reminder: {
      on: r.on === true,
      day: isNum(r.day) && r.day >= 0 && r.day <= 6 ? (Math.round(r.day) as ReminderDay) : DEFAULT_METER_STATE.reminder.day,
      time: typeof r.time === "string" && /^\d\d:\d\d$/.test(r.time) ? r.time : DEFAULT_METER_STATE.reminder.time,
    },
    suggestionKeptAt: s.suggestionKeptAt === "rough" || s.suggestionKeptAt === "good" || s.suggestionKeptAt === "solid" ? s.suggestionKeptAt : null,
  };
}

/** Validate readings from an imported backup. */
export const cleanImportedReadings = (raw: unknown): MeterReading[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((x): x is MeterReading => {
      const r = x as Partial<MeterReading> | null;
      return !!r && typeof r.id === "string" && isNum(r.unitsLeft) && r.unitsLeft >= 0 && isTime(r.takenAt);
    })
    .map((r) => ({
      id: r.id,
      unitsLeft: r.unitsLeft,
      takenAt: r.takenAt,
      context: r.context === "onboarding" || r.context === "before_token" ? r.context : "check_in",
      ...(isNum(r.meterDaysLeft) && r.meterDaysLeft >= 0 ? { meterDaysLeft: r.meterDaysLeft } : {}),
      ...(pos(r.meterDailyAvgKwh) ? { meterDailyAvgKwh: r.meterDailyAvgKwh } : {}),
    }));

/**
 * Weekly reminder (off by default). `banner`: in-app nudge once the last reading is a week old.
 * `notify`: the chosen weekday/time has passed since the last reading (installed app with permission only).
 */
export function reminderDue(state: MeterState, last: MeterReading | null, now: Date, staleDays: number) {
  if (!state.reminder.on) return { banner: false, notify: false };
  const banner = !last || daysSince(last.takenAt, now) >= staleDays;
  const [hh, mm] = state.reminder.time.split(":").map(Number);
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() - state.reminder.day + 7) % 7), hh, mm);
  if (slot > now) slot.setDate(slot.getDate() - 7);
  return { banner, notify: !last || ms(last.takenAt) < slot.getTime() };
}

/** What the Meter screen and its Home card show. */
export function meterSnapshot(readings: MeterReading[], tokens: TokenLoad[], profile: MeterProfile, actualDaily: number | null, now: Date) {
  const last = latestReading(readings);
  if (!last) return null;
  const unitsNow = estimateUnitsNow(last, tokens, actualDaily, now);
  return { last, unitsNow, days: daysLeftRange(unitsNow.units, actualDaily, last, profile, now, tokens) };
}
