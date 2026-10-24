"use client";

import { useState, type ReactNode } from "react";
import { fmtQ, naira, short, trim } from "@/lib/format";
import { bucketsFor, niceCeil, type Bucket, type Period } from "@/lib/insights";
import type { Entry, Settings } from "@/lib/spend";
import { Eyebrow, Marker, Segmented, SplitBar } from "../ui";

const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "Per day" },
  { id: "week", label: "Per week" },
  { id: "month", label: "Per month" },
];

const NOUN: Record<Period, string> = { day: "day", week: "week", month: "month" };

/** ₦ with a decimal for small per-day values, compact otherwise. */
const money = (n: number) => (n < 1000 ? naira(n) : short(n));
const qty = (n: number) => (n > 0 && n < 1 ? trim(n.toFixed(2)) : fmtQ(n));

export function Insights({
  entries,
  settings: S,
  supply,
  onBack,
}: {
  entries: Entry[];
  settings: Settings;
  /** Light hours a day and where the figure comes from. */
  supply?: { hours: number; label: string };
  onBack: () => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const buckets = bucketsFor(period, entries);
  const cur = buckets[buckets.length - 1];
  const prev = buckets[buckets.length - 2];
  const total = (b: Bucket) => b.fuel + b.token;

  // Averages over complete periods since the first one with any logs.
  const first = buckets.findIndex((b) => total(b) > 0);
  const done = first < 0 ? [] : buckets.slice(first, -1);
  const avg = (f: (b: Bucket) => number) => (done.length ? done.reduce((t, b) => t + f(b), 0) / done.length : 0);
  const avgTotal = avg(total);

  const rangeFuel = buckets.reduce((t, b) => t + b.fuel, 0);
  const rangeTok = buckets.reduce((t, b) => t + b.token, 0);
  const rangeT = rangeFuel + rangeTok;
  const fuelPct = rangeT ? Math.round((rangeFuel / rangeT) * 100) : 0;
  const untracked = buckets.reduce((t, b) => t + b.untracked, 0);
  const hasData = rangeT > 0;

  const heroLabel =
    period === "day" ? `Average a day · ${cur.long}` : period === "week" ? "This week so far" : "This month so far";
  let deltaText = "";
  let deltaClass = "text-muted";
  if (period === "day" && total(prev) > 0) {
    // Per-day averages compare fairly even though this month is still running.
    const p = Math.round(((total(cur) - total(prev)) / total(prev)) * 100);
    deltaText =
      p === 0 ? `Level with ${prev.label}` : `${p > 0 ? "↑" : "↓"} ${Math.abs(p)}% vs ${prev.label} · ${money(total(prev))}/day`;
    if (p > 0) deltaClass = "text-red";
    if (p < 0) deltaClass = "text-light";
  } else if (period !== "day") {
    deltaText = [
      total(prev) ? `Last ${NOUN[period]} ${money(total(prev))}` : "",
      avgTotal ? `${done.length}-${NOUN[period]} average ${money(avgTotal)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const unitSuffix = period === "day" ? "/day" : "";

  return (
    <div className="flex flex-col pb-12">
      <header className="flex h-16 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to dashboard"
          className="h-11 w-11 rounded-xl bg-track-2 text-xl font-semibold"
        >
          ‹
        </button>
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Insights</h1>
      </header>

      <div className="mt-2">
        <Segmented label="Group by" options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      <div className="mt-7 flex flex-col">
        <Eyebrow>{heroLabel}</Eyebrow>
        <span className="mt-2.5 text-[56px] leading-none font-extrabold tracking-[-0.05em]">
          {naira(total(cur))}
        </span>
        {deltaText && <span className={`mt-3 text-[15px] font-medium ${deltaClass}`}>{deltaText}</span>}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Tile type="token" label="Light" value={money(cur.token) + unitSuffix} sub={`${qty(cur.kwh)} kWh${unitSuffix}`} />
        <Tile type="fuel" label="Fuel" value={money(cur.fuel) + unitSuffix} sub={`${qty(cur.litres)} L${unitSuffix}`} />
      </div>

      {!hasData ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line-strong px-5 py-7 text-center">
          <span className="text-[17px] font-semibold">No logs to chart yet</span>
          <span className="max-w-[300px] text-sm leading-[1.45] text-pretty text-muted">
            Log a few fuel or token top-ups and your trends show up here.
          </span>
        </div>
      ) : (
        <>
          <Card
            title={period === "day" ? "Spend per day" : `Spend per ${NOUN[period]}`}
            sub={period === "day" ? "Monthly average, last 6 months" : period === "week" ? "Last 8 weeks" : "Last 6 months"}
          >
            <div className="mb-4 flex gap-4">
              <LegendKey type="token" label="Light" />
              <LegendKey type="fuel" label="Fuel" />
            </div>
            <Columns
              buckets={buckets}
              series={[
                { key: "fuel", label: "Fuel", cls: "bg-fuel", get: (b) => b.fuel },
                { key: "token", label: "Light", cls: "bg-light", get: (b) => b.token },
              ]}
              fmt={money}
              tick={short}
              total
            />
            <div className="mt-6 flex flex-col gap-2">
              <SplitBar fuelPct={fuelPct} empty={!rangeT} />
              <span className="font-mono text-xs text-muted">
                Fuel {fuelPct}% · Light {100 - fuelPct}% of {naira(rangeT)} over this range
              </span>
            </div>
          </Card>

          <Card
            title={period === "day" ? "Usage per day" : `Usage per ${NOUN[period]}`}
            sub="From the units and litres you logged"
          >
            <div className="flex flex-col gap-7">
              <div>
                <SeriesTitle type="token" label="Light · kWh" />
                <Columns
                  buckets={buckets}
                  series={[{ key: "kwh", label: "Light", cls: "bg-light", get: (b) => b.kwh }]}
                  fmt={(n) => `${qty(n)} kWh`}
                  tick={qty}
                  height={110}
                />
              </div>
              <div>
                <SeriesTitle type="fuel" label="Fuel · litres" />
                <Columns
                  buckets={buckets}
                  series={[{ key: "litres", label: "Fuel", cls: "bg-fuel", get: (b) => b.litres }]}
                  fmt={(n) => `${qty(n)} L`}
                  tick={qty}
                  height={110}
                />
              </div>
            </div>
            {untracked > 0 && (
              <p className="mt-5 text-[13px] leading-normal text-pretty text-muted">
                {untracked} {untracked === 1 ? "top-up has" : "top-ups have"} no units or litres logged, so usage here
                runs low.
              </p>
            )}
          </Card>

          <UnitCost buckets={buckets} />
        </>
      )}

      <SupplyDay hours={supply?.hours ?? S.gridHours} source={S.source} sub={supply?.label ?? "From the light hours you set"} />

      {hasData && <DataTable buckets={buckets} unitSuffix={unitSuffix} />}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-[20px] bg-card p-5">
      <h2 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
      <p className="mt-0.5 mb-4 text-[13px] text-muted">{sub}</p>
      {children}
    </section>
  );
}

function Tile({ type, label, value, sub }: { type: "fuel" | "token"; label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Marker type={type} />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <span className="text-[22px] font-extrabold tracking-[-0.025em]">{value}</span>
      <span className="font-mono text-xs text-muted">{sub}</span>
    </div>
  );
}

function LegendKey({ type, label }: { type: "fuel" | "token"; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] font-semibold">
      <span className={`h-2.5 w-2.5 rounded-[2px] ${type === "fuel" ? "bg-fuel" : "bg-light"}`} />
      {label}
    </span>
  );
}

function SeriesTitle({ type, label }: { type: "fuel" | "token"; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Marker type={type} />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

type Series = { key: string; label: string; cls: string; get: (b: Bucket) => number };

/**
 * Column chart, stacked when given several series (first series sits on the baseline).
 * Each column is a button: hover or focus shows every series for that period.
 */
function Columns({
  buckets,
  series,
  fmt,
  tick,
  total = false,
  height = 150,
}: {
  buckets: Bucket[];
  series: Series[];
  fmt: (n: number) => string;
  tick: (n: number) => string;
  total?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const sums = buckets.map((b) => series.reduce((t, s) => t + s.get(b), 0));
  const max = niceCeil(Math.max(...sums));
  const ticks = [max, max / 2, 0];
  // Label the latest column and the peak; tooltip and table carry the rest.
  const peak = sums.indexOf(Math.max(...sums));
  const labelled = new Set([buckets.length - 1, peak]);
  const n = buckets.length;

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <div className="relative pt-5 pl-10" style={{ height: height + 20 }}>
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute right-0 left-10 border-t border-line"
            style={{ bottom: (t / max) * height }}
            aria-hidden="true"
          >
            <span className="absolute -left-10 w-8 -translate-y-1/2 text-right font-mono text-[10px] text-muted tabular-nums">
              {tick(t)}
            </span>
          </div>
        ))}

        <div className="relative flex h-full items-end">
          {buckets.map((b, i) => {
            const vals = series.map((s) => s.get(b));
            return (
              <button
                key={b.key}
                type="button"
                aria-label={`${b.long}: ${series.map((s, j) => `${s.label} ${fmt(vals[j])}`).join(", ")}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className={`flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-t-md outline-none ${
                  hover === i ? "bg-track-2/70" : ""
                } focus-visible:ring-2 focus-visible:ring-ink`}
              >
                {labelled.has(i) && sums[i] > 0 && (
                  <span className="mb-1 font-mono text-[10px] font-medium whitespace-nowrap text-ink">
                    {fmt(sums[i])}
                  </span>
                )}
                <span
                  className="flex w-[min(24px,60%)] flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
                  style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}
                >
                  {series.map((s, j) =>
                    vals[j] > 0 ? (
                      <span
                        key={s.key}
                        className={`block w-full ${s.cls} ${b.current ? "opacity-80" : ""}`}
                        style={{ height: Math.max(2, (vals[j] / max) * height) }}
                      />
                    ) : null,
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {hover !== null && (
          <div
            role="presentation"
            className="pointer-events-none absolute top-0 z-10 min-w-[140px] -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-3 py-2.5 text-card shadow-lg"
            style={{ left: `calc(40px + (100% - 40px) * ${Math.min(0.8, Math.max(0.2, (hover + 0.5) / n))})` }}
          >
            <div className="mb-1.5 font-mono text-[11px] text-ink-muted">
              {buckets[hover].long}
              {buckets[hover].current ? " · so far" : ""}
            </div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-[13px]">
                <span className={`h-[2px] w-3 ${s.cls}`} />
                <span className="font-bold tabular-nums">{fmt(s.get(buckets[hover]))}</span>
                <span className="text-ink-muted">{s.label}</span>
              </div>
            ))}
            {total && series.length > 1 && (
              <div className="mt-1 border-t border-ink-line pt-1 text-[13px]">
                <span className="font-bold tabular-nums">{fmt(sums[hover])}</span>{" "}
                <span className="text-ink-muted">total</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex pl-10" aria-hidden="true">
        {buckets.map((b) => (
          <span
            key={b.key}
            className={`min-w-0 flex-1 truncate text-center font-mono text-[10px] ${b.current ? "font-semibold text-ink" : "text-muted"}`}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** ₦/kWh and ₦/L for the latest period that has both, against the range average. */
function UnitCost({ buckets }: { buckets: Bucket[] }) {
  const rate = (money: number, q: number) => (q ? money / q : 0);
  const kwhRates = buckets.map((b) => rate(b.token, b.kwh)).filter(Boolean);
  const lRates = buckets.map((b) => rate(b.fuel, b.litres)).filter(Boolean);
  if (!kwhRates.length && !lRates.length) return null;
  const tot = (k: "token" | "fuel", q: "kwh" | "litres") => {
    const m = buckets.reduce((t, b) => t + (b[q] ? b[k] : 0), 0);
    const u = buckets.reduce((t, b) => t + b[q], 0);
    return rate(m, u);
  };

  return (
    <Card title="What a unit costs you" sub="Average price paid, and how it moved across this range">
      <div className="grid grid-cols-2 gap-3">
        <RateTile type="token" label="Light" unit="kWh" avg={tot("token", "kwh")} rates={kwhRates} />
        <RateTile type="fuel" label="Fuel" unit="L" avg={tot("fuel", "litres")} rates={lRates} />
      </div>
    </Card>
  );
}

function RateTile({
  type,
  label,
  unit,
  avg,
  rates,
}: {
  type: "fuel" | "token";
  label: string;
  unit: string;
  avg: number;
  rates: number[];
}) {
  if (!rates.length)
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Marker type={type} />
          <span className="text-sm font-semibold">{label}</span>
        </div>
        <span className="font-mono text-xs text-muted">Log {unit === "L" ? "litres" : "units"} to see ₦/{unit}</span>
      </div>
    );
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const last = rates[rates.length - 1];
  const pos = hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50;
  const fmtR = (n: number) => "₦" + (n < 100 ? trim(n.toFixed(1)) : Math.round(n).toLocaleString("en-NG"));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Marker type={type} />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <span className="text-[22px] font-extrabold tracking-[-0.025em]">
        {fmtR(avg)}
        <span className="text-sm font-semibold text-muted">/{unit}</span>
      </span>
      {/* Range strip: lowest to highest price paid, dot = latest period. */}
      <div className="relative mt-2 h-2 rounded-full bg-track" aria-hidden="true">
        <span
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${
            type === "fuel" ? "bg-fuel" : "bg-light"
          }`}
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[11px] text-muted">
        <span>{fmtR(lo)}</span>
        <span>{fmtR(hi)}</span>
      </div>
      <span className="font-mono text-[11px] text-muted">Latest {fmtR(last)}</span>
    </div>
  );
}

/** 24 hour cells: grid supply vs the rest of the day. */
function SupplyDay({ hours, source, sub }: { hours: number; source: Settings["source"]; sub: string }) {
  const off = 24 - hours;
  const offLabel = source === "nepa" ? "no light" : "generator or nothing";
  return (
    <Card title="A typical day" sub={sub}>
      <div className="grid grid-cols-12 gap-[3px]" role="img" aria-label={`${hours} hours of NEPA, ${off} hours ${offLabel}`}>
        {Array.from({ length: 24 }, (_, i) => (
          <span
            key={i}
            className={`h-7 rounded-[4px] ${i < hours ? "bg-light" : source === "nepa" ? "bg-track" : "bg-fuel-soft"}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-light" />
          <span className="font-bold">{hours} hrs</span> <span className="text-muted">NEPA</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-[2px] ${source === "nepa" ? "bg-track" : "bg-fuel-soft"}`} />
          <span className="font-bold">{off} hrs</span> <span className="text-muted">{offLabel}</span>
        </span>
      </div>
    </Card>
  );
}

function DataTable({ buckets, unitSuffix }: { buckets: Bucket[]; unitSuffix: string }) {
  return (
    <details className="mt-6 rounded-[20px] bg-card p-5">
      <summary className="cursor-pointer text-[15px] font-semibold">View as table</summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-[13px] tabular-nums">
          <thead className="font-mono text-[11px] text-muted">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Period</th>
              <th className="py-1.5 pr-3 text-right font-medium">Light ₦{unitSuffix}</th>
              <th className="py-1.5 pr-3 text-right font-medium">kWh</th>
              <th className="py-1.5 pr-3 text-right font-medium">Fuel ₦{unitSuffix}</th>
              <th className="py-1.5 text-right font-medium">L</th>
            </tr>
          </thead>
          <tbody>
            {[...buckets].reverse().map((b) => (
              <tr key={b.key} className="border-t border-line">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {b.long}
                  {b.current ? " · so far" : ""}
                </td>
                <td className="py-2 pr-3 text-right">{naira(b.token)}</td>
                <td className="py-2 pr-3 text-right">{qty(b.kwh)}</td>
                <td className="py-2 pr-3 text-right">{naira(b.fuel)}</td>
                <td className="py-2 text-right">{qty(b.litres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
