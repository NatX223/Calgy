import { daysIn, iso, num, uid } from "./format";

export type EntryType = "fuel" | "token";

export type Entry = {
  id: string;
  type: EntryType;
  amount_naira: number;
  quantity: number | null; // litres (fuel) or kWh (token)
  unit_price: number | null; // ₦/L or ₦/kWh, 2dp
  date: string; // YYYY-MM-DD
  note: string | null;
  created_at: string; // ISO
};

/** How the home is powered: generator only, prepaid grid only, or both. */
export type PowerSource = "gen" | "nepa" | "hybrid";

export type Settings = {
  onboarded: boolean;
  source: PowerSource;
  fuelWeekly: number;
  tokenMonthly: number;
  gridHours: number;
  dailyKwh: number;
  unitsLeft: number;
  unitsAsOf: string | null; // YYYY-MM-DD the units-left reading was taken
  lastExport: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  source: "nepa",
  fuelWeekly: 0,
  tokenMonthly: 0,
  gridHours: 8,
  dailyKwh: 0,
  unitsLeft: 0,
  unitsAsOf: null,
  lastExport: null,
};

/** Fixed id for the top-up captured during onboarding, so redoing it replaces rather than duplicates. */
export const OB_TOPUP_ID = "ob-topup";

export const unitPrice = (amount: number, qty: number | null) =>
  qty ? Math.round((amount / qty) * 100) / 100 : null;

/** Newest first: by date, then by creation time. */
export const byNewest = (a: Entry, b: Entry) =>
  b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at));

/** Deterministic three months of plausible fuel + token logs ending today. */
export function makeSample(): Entry[] {
  const now = new Date();
  const out: Omit<Entry, "id" | "unit_price" | "created_at">[] = [];
  let seed = 11;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let mo = -2; mo <= 0; mo++) {
    const first = new Date(now.getFullYear(), now.getMonth() + mo, 1);
    const last = mo === 0 ? now.getDate() : daysIn(first);
    for (let d = 1 + Math.floor(rnd() * 2); d <= last; d += 3 + Math.floor(rnd() * 2)) {
      const L = [5, 8, 10, 10, 12, 15][Math.floor(rnd() * 6)];
      const price = Math.round((960 + rnd() * 90 + (mo === -1 ? 40 : 0)) / 5) * 5;
      const amt = Math.round((L * price) / 100) * 100;
      const hasL = rnd() > 0.2;
      out.push({
        type: "fuel",
        amount_naira: amt,
        quantity: hasL ? L : null,
        date: iso(new Date(first.getFullYear(), first.getMonth(), d)),
        note: rnd() > 0.88 ? "Station dry, bought by roadside" : null,
      });
    }
    ([[3, 15000], [14, 10000], [25, 20000]] as const).forEach(([d, amt], i) => {
      if (d > last) return;
      const hasK = !(mo === 0 && i === 1);
      out.push({
        type: "token",
        amount_naira: amt,
        quantity: hasK ? Math.round((amt / 209.5) * 10) / 10 : null,
        date: iso(new Date(first.getFullYear(), first.getMonth(), d)),
        note: null,
      });
    });
  }
  return out.map((e, i) => ({
    id: "s" + i + uid(),
    ...e,
    unit_price: unitPrice(e.amount_naira, e.quantity),
    created_at: e.date + "T12:00:00.000Z",
  }));
}

/** Validate + normalise entries from an imported backup. Drops anything malformed. */
export function cleanImported(raw: unknown[]): Entry[] {
  return raw
    .filter((x): x is Record<string, unknown> => {
      if (!x || typeof x !== "object") return false;
      const r = x as Record<string, unknown>;
      return (
        (r.type === "fuel" || r.type === "token") &&
        num(r.amount_naira) > 0 &&
        typeof r.date === "string" &&
        /^\d{4}-\d\d-\d\d$/.test(r.date)
      );
    })
    .map((x) => {
      const q = num(x.quantity) || null;
      const amt = num(x.amount_naira);
      return {
        id: String(x.id || uid()),
        type: x.type as EntryType,
        amount_naira: amt,
        quantity: q,
        unit_price: unitPrice(amt, q),
        date: x.date as string,
        note: typeof x.note === "string" && x.note ? x.note : null,
        created_at: typeof x.created_at === "string" ? x.created_at : new Date().toISOString(),
      };
    });
}
