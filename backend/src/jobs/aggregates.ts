// Nightly anonymous aggregates (§10.2), from users who opted in (settings.shareAnonymousData).
// Each user adds at most one value per bucket (the median of their own entries), and a bucket is
// published only when at least AGGREGATE_MIN_CONTRIBUTORS users are in it. No uids, names or times leave.
import { genReady, gridReady } from "@calgy/engine/calibration";
import {
  docToDevice, docToGenerator, docToReading, fuelToEntry, fuelToPurchase, meterFromDoc, settingsFromDoc, tokenToEntry,
} from "@calgy/engine/docs";
import { calibrateHome } from "@calgy/engine/home-calibration";
import {
  COLLECTIONS, LOG_SCHEMAS, type CollectionName, type LogDocs, type UserDoc,
} from "@calgy/shared";
import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { Logger } from "pino";
import { decodeUserDoc } from "../services/user-doc.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Contributor = { doc: UserDoc } & { [K in CollectionName]: LogDocs[K][] };

export type Stat = { median: number; p25: number; p75: number; count: number };
export type AggregateDoc = { windowDays: number | null; buckets: (Record<string, string | number> & Stat)[] };
export type AggregateName = "genBurn" | "fuelPrice" | "tariff" | "presetRatios";

/** Linear-interpolated percentile of sorted values. */
export function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const median = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 0.5);
const valid = (n: number) => Number.isFinite(n) && n > 0;

/** Collects per-user medians per bucket key, then summarises across users. */
class Buckets {
  private readonly users = new Map<string, { labels: Record<string, string>; values: number[] }>();
  private current = new Map<string, { labels: Record<string, string>; values: number[] }>();

  add(labels: Record<string, string>, value: number) {
    if (!valid(value)) return;
    const key = JSON.stringify(labels);
    const b = this.current.get(key) ?? { labels, values: [] };
    b.values.push(value);
    this.current.set(key, b);
  }

  /** Close one user's entries: each bucket gets their median. */
  endUser() {
    for (const [key, b] of this.current) {
      const all = this.users.get(key) ?? { labels: b.labels, values: [] };
      all.values.push(median(b.values));
      this.users.set(key, all);
    }
    this.current = new Map();
  }

  publish(windowDays: number | null, minCount: number): AggregateDoc {
    const buckets = [...this.users.values()]
      .filter((b) => b.values.length >= minCount)
      .map(({ labels, values }) => {
        const s = [...values].sort((a, b) => a - b);
        return { ...labels, median: round(percentile(s, 0.5)), p25: round(percentile(s, 0.25)), p75: round(percentile(s, 0.75)), count: s.length };
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { windowDays, buckets };
  }
}

const within = (iso: string, now: Date, days: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now.getTime() + DAY_MS && t >= now.getTime() - days * DAY_MS;
};

export const WINDOWS = { genBurn: 90, fuelPrice: 14, tariff: 30 } as const;

export function computeAggregates(users: Contributor[], now: Date, minCount: number): Record<AggregateName, AggregateDoc> {
  const genBurn = new Buckets();
  const fuelPrice = new Buckets();
  const tariff = new Buckets();
  const presetRatios = new Buckets();

  for (const u of users) {
    const gens = new Map(u.generators.map((g) => [g.id, g]));
    const onlyGen = u.generators.length === 1 ? u.generators[0] : null;

    for (const p of u.fuelPurchases) {
      const gen = (p.generatorId && gens.get(p.generatorId)) || onlyGen;
      if (p.litres && gen && within(p.purchasedAt, now, WINDOWS.fuelPrice))
        fuelPrice.add({ fuelType: gen.fuelType }, p.amountNaira / p.litres);
      const linked = p.generatorId ? gens.get(p.generatorId) : undefined;
      if (linked && p.litres && p.hoursRun && within(p.purchasedAt, now, WINDOWS.genBurn))
        genBurn.add({ generatorType: linked.typeId ?? "unknown", fuelType: linked.fuelType }, p.litres / p.hoursRun);
    }

    for (const t of u.tokenLoads) {
      if (t.unitsReceived && within(t.loadedAt, now, WINDOWS.tariff)) tariff.add({}, t.amountNaira / t.unitsReceived);
    }

    for (const [presetId, ratio] of presetRatiosOf(u, now)) presetRatios.add({ presetId }, ratio);

    genBurn.endUser();
    fuelPrice.endUser();
    tariff.endUser();
    presetRatios.endUser();
  }

  return {
    genBurn: genBurn.publish(WINDOWS.genBurn, minCount),
    fuelPrice: fuelPrice.publish(WINDOWS.fuelPrice, minCount),
    tariff: tariff.publish(WINDOWS.tariff, minCount),
    presetRatios: presetRatios.publish(null, minCount),
  };
}

/** Calibrated ÷ estimated daily use for each preset device, counting only the sides that calibrated. */
export function presetRatiosOf(u: Contributor, now: Date): [string, number][] {
  if (u.devices.length === 0) return [];
  const devices = u.devices.map(docToDevice);
  const result = calibrateHome(
    {
      settings: settingsFromDoc(u.doc),
      devices,
      entries: [...u.tokenLoads.map(tokenToEntry), ...u.fuelPurchases.map(fuelToEntry)],
      readings: u.meterReadings.map(docToReading),
      meter: meterFromDoc(u.doc),
      generator: u.generators[0] ? docToGenerator(u.generators[0]) : null,
      purchases: u.fuelPurchases.map(fuelToPurchase).filter((p) => p !== null),
    },
    now,
  );
  const grid = gridReady(result);
  const gen = genReady(result);
  if (!grid && !gen) return [];
  return devices.flatMap((d): [string, number][] => {
    const c = result.perDevice[d.id];
    if (!d.presetId || !c) return [];
    const est = (grid ? c.uncalibratedGrid.typical : 0) + (gen ? c.uncalibratedGen.typical : 0);
    const cal = (grid ? c.calibratedGrid : 0) + (gen ? c.calibratedGen : 0);
    return est > 0 ? [[d.presetId, cal / est]] : [];
  });
}

/** Firestore log doc → the shared shape (Timestamps → ISO), or null if it doesn't validate. */
export function decodeLogDoc<K extends CollectionName>(name: K, id: string, data: DocumentData): LogDocs[K] | null {
  const plain = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate().toISOString() : v]));
  const r = LOG_SCHEMAS[name].safeParse({ ...plain, id });
  return r.success ? r.data : null;
}

async function loadContributor(db: Firestore, uid: string, raw: DocumentData): Promise<Contributor> {
  const ref = db.collection("users").doc(uid);
  const out = { doc: decodeUserDoc(raw, uid).doc } as Contributor;
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      const snap = await ref.collection(name).get();
      (out as Record<string, unknown>)[name] = snap.docs.map((d) => decodeLogDoc(name, d.id, d.data())).filter((d) => d !== null);
    }),
  );
  return out;
}

export async function runAggregates(deps: { db: Firestore; log: Logger; minContributors: number }, now = new Date()) {
  const { db, log, minContributors } = deps;
  const snap = await db.collection("users").where("settings.shareAnonymousData", "==", true).get();
  const users: Contributor[] = [];
  for (const d of snap.docs) {
    try {
      users.push(await loadContributor(db, d.id, d.data()));
    } catch (e) {
      log.warn({ err: e }, "aggregate: skipped a contributor");
    }
  }
  const out = computeAggregates(users, now, minContributors);
  const batch = db.batch();
  for (const [name, doc] of Object.entries(out)) {
    batch.set(db.collection("aggregates").doc(name), { ...doc, updatedAt: Timestamp.fromDate(now) });
  }
  await batch.commit();
  log.info(
    { contributors: users.length, buckets: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.buckets.length])) },
    "aggregates run",
  );
}
