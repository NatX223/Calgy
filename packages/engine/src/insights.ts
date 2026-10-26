import { daysIn, iso, MONTHS, parseIso, ymKey } from "./format";
import type { Entry } from "./spend";

export type Period = "day" | "week" | "month";

/** Spend (₦) and usage (litres / kWh logged) for one calendar week or month. */
export type Bucket = {
  key: string;
  label: string; // short, for the x-axis
  long: string; // for tooltips and the table
  days: number; // days covered so far (the current period is partial)
  current: boolean;
  fuel: number;
  token: number;
  litres: number;
  kwh: number;
  untracked: number; // entries with no quantity, so usage is undercounted
};

const MON = (d: Date) => MONTHS[d.getMonth()].slice(0, 3);
const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5);

const blank = (b: Pick<Bucket, "key" | "label" | "long" | "days" | "current">): Bucket => ({
  ...b, fuel: 0, token: 0, litres: 0, kwh: 0, untracked: 0,
});

function add(b: Bucket | undefined, e: Entry) {
  if (!b) return;
  const q = e.quantity ?? 0;
  if (e.type === "fuel") {
    b.fuel += e.amount_naira;
    b.litres += q;
  } else {
    b.token += e.amount_naira;
    b.kwh += q;
  }
  if (!q) b.untracked++;
}

/** Monday on or before `d`. */
const weekStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

/** The last `n` calendar months, oldest first, ending with the current one. */
export function monthBuckets(entries: Entry[], n = 6, now = new Date()): Bucket[] {
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(
      blank({
        key: ymKey(d), label: MON(d), long: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        days: i === 0 ? now.getDate() : daysIn(d), current: i === 0,
      }),
    );
  }
  const byKey = new Map(out.map((b) => [b.key, b]));
  entries.forEach((e) => add(byKey.get(e.date.slice(0, 7)), e));
  return out;
}

/** The last `n` Monday-start weeks, oldest first, ending with the current one. */
export function weekBuckets(entries: Entry[], n = 8, now = new Date()): Bucket[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = weekStart(today);
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - 7 * i);
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
    out.push(
      blank({
        key: iso(s), label: `${s.getDate()} ${MON(s)}`, long: `${s.getDate()} ${MON(s)} – ${e.getDate()} ${MON(e)}`,
        days: i === 0 ? dayDiff(s, today) + 1 : 7, current: i === 0,
      }),
    );
  }
  const byKey = new Map(out.map((b) => [b.key, b]));
  entries.forEach((e) => add(byKey.get(iso(weekStart(parseIso(e.date)))), e));
  return out;
}

/** Same bucket, every amount divided by the days it covers. */
export const perDay = (b: Bucket): Bucket => ({
  ...b, fuel: b.fuel / b.days, token: b.token / b.days, litres: b.litres / b.days, kwh: b.kwh / b.days,
});

/** Buckets for a view: months averaged per day, or raw weekly / monthly totals. */
export function bucketsFor(period: Period, entries: Entry[], now = new Date()): Bucket[] {
  if (period === "week") return weekBuckets(entries, 8, now);
  const months = monthBuckets(entries, 6, now);
  return period === "day" ? months.map(perDay) : months;
}

/** Round an axis maximum up to 1 / 2 / 2.5 / 5 × 10ⁿ. */
export function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
