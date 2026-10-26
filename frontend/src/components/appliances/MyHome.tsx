"use client";

import { fromLabel, usageSummary, type Device, type Tariff } from "@calgy/engine/appliances";
import { sumSplits } from "@calgy/engine/calibration";
import { fU, naira, rN } from "@calgy/engine/format";
import { homeSplits, priceHome, supplyNote, toTrio, unitsOf, type Calib, type SimFuel } from "@calgy/engine/home-calibration";
import type { Confidence } from "@calgy/engine/meter";
import type { Settings } from "@calgy/engine/spend";
import Link from "next/link";
import { CATEGORIES } from "@calgy/engine/presets";
import { CalBadges, fH, GenInsightCard, HybridSummary, LightHoursCard, RealityCard } from "../Calibration";
import { Eyebrow } from "../ui";

/** ₦ for kWh/day over a period, rounded per the period rule. */
export const costFor = (T: Tariff | null) => (kwhPerDay: number, days: number) =>
  naira(rN(kwhPerDay * days * (T?.value ?? 0), days));

/** ₦ for ₦/day over a period, rounded per the period rule. */
export const moneyFor = (nairaPerDay: number, days: number) => naira(rN(nairaPerDay * days, days));

export function QtyBadge({ qty }: { qty: number }) {
  return (
    <span className="h-[22px] shrink-0 rounded-md bg-ink px-[7px] font-mono text-xs leading-[22px] text-card">×{qty}</span>
  );
}

export function SourceBadge({ d }: { d: Device }) {
  return (
    <span
      className={`h-5 shrink-0 rounded-[5px] px-1.5 font-mono text-[10px] leading-5 tracking-[0.04em] uppercase ${
        fromLabel(d) ? "bg-light-chip text-ink" : "bg-track text-muted"
      }`}
    >
      {fromLabel(d) ? "From label" : "Typical"}
    </span>
  );
}

const HOURS_SOURCE: Record<Settings["gridHoursSource"], string> = {
  user: "you set",
  inferred: "from your meter",
  none: "assumed",
};

export function MyHome({
  devices,
  T,
  calib,
  fuel,
  hoursSource,
  keptAt,
  onSetHours,
  onKeepHours,
  banner,
  onDismissBanner,
  highlight,
  onOpen,
  onAdd,
  onSim,
  onLagos,
  onTariff,
}: {
  devices: Device[];
  T: Tariff | null;
  calib: Calib;
  fuel: SimFuel;
  hoursSource: Settings["gridHoursSource"];
  keptAt: Confidence | null;
  onSetHours: (h: number) => void;
  onKeepHours: () => void;
  banner: string | null;
  onDismissBanner: () => void;
  highlight: string | null;
  onOpen: (d: Device) => void;
  onAdd: () => void;
  onSim: () => void;
  onLagos: () => void;
  onTariff: () => void;
}) {
  const { household: hh, result: r, enabled } = calib;
  const splits = homeSplits(calib, devices);
  const split = new Map(devices.map((d, i) => [d.id, splits[i]]));
  const tot = sumSplits(splits);
  const units = toTrio(unitsOf(tot));
  const priced = priceHome(calib, fuel, splits);
  const money = priced.totals.naira;
  const rowNaira = new Map(devices.map((d, i) => [d.id, priced.rows[i].naira]));
  const idleNaira = money && priced.totals.idleLitres > 0 ? priced.totals.idleLitres * (fuel.info.nairaPerLitre ?? 0) : 0;
  const qtyTotal = devices.reduce((a, d) => a + Math.max(1, d.quantity), 0);
  const groups = CATEGORIES.map((c) => ({ ...c, items: devices.filter((d) => d.category === c.id) })).filter(
    (g) => g.items.length,
  );
  const pill = "inline-flex h-8 items-center rounded-full bg-ink-pill px-3 text-[13px] font-medium whitespace-nowrap";
  const intro =
    hh === "gen"
      ? "The devices you run on your gen, and roughly what they cost."
      : hh === "hybrid"
        ? "The devices you run on light and gen, and roughly what they cost."
        : "The devices you run on light, and roughly what they cost.";

  return (
    <>
      <div className="flex flex-col pt-3 pb-[132px]">
        <h1 className="text-4xl leading-none font-extrabold tracking-[-0.04em]">My Home</h1>
        <p className="mt-2 mb-[22px] text-[15px] leading-[1.45] text-pretty text-muted">{intro}</p>

        {banner && devices.length > 0 && (
          <div className="mb-3.5 flex items-center gap-2.5 rounded-xl bg-fuel-soft px-3.5 py-2.5 text-sm leading-[1.4]">
            <span className="flex-1">{banner}</span>
            <button type="button" onClick={onDismissBanner} aria-label="Dismiss" className="h-8 w-8 text-sm">
              ✕
            </button>
          </div>
        )}
        {devices.length > 0 ? (
          <>
            <div className="flex flex-col gap-[18px] rounded-[22px] bg-ink p-[22px] text-card">
              <Eyebrow className="text-ink-muted">Estimated · per month</Eyebrow>
              {money ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[52px] leading-none font-extrabold tracking-[-0.05em]">~{moneyFor(money.typical, 30)}</span>
                    <span className="font-mono text-[13px] text-ink-muted">
                      {moneyFor(money.low, 30)} – {moneyFor(money.high, 30)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 border-t border-ink-line pt-3.5">
                    <span className="text-lg font-bold">~{fU(units.typ * 30)} units (kWh)</span>
                    <span className="font-mono text-xs text-ink-muted">
                      {fU(units.lo * 30)} – {fU(units.hi * 30)} units (kWh)
                      {hh === "hybrid" ? ` · ${fU(tot.grid.typical * 30)} light, ${fU(tot.gen.typical * 30)} gen` : ""}
                    </span>
                    {idleNaira > 0 && (
                      <span className="font-mono text-xs text-ink-muted">
                        Includes ~{moneyFor(idleNaira, 30)} just to keep the gen running
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[44px] leading-none font-extrabold tracking-[-0.045em]">
                      ~{fU(units.typ * 30)} units
                    </span>
                    <span className="font-mono text-[13px] text-ink-muted">
                      {fU(units.lo * 30)} – {fU(units.hi * 30)} units (kWh)
                    </span>
                  </div>
                  {hh !== "gen" && calib.tariff == null ? (
                    <button type="button" onClick={onTariff} className="h-12 rounded-[14px] bg-fuel text-[15px] font-bold text-ink">
                      Set your tariff to see ₦ →
                    </button>
                  ) : (
                    <span className="text-sm text-ink-muted">Log a fuel purchase to see what your gen side costs.</span>
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <span className={pill}>
                  {qtyTotal} device{qtyTotal === 1 ? "" : "s"}
                </span>
                {hh !== "gen" && (
                  <span className={pill}>
                    ~{fH(calib.G)}h light a day · {HOURS_SOURCE[hoursSource]}
                  </span>
                )}
                {hh !== "grid" && calib.H ? <span className={pill}>~{fH(calib.H)}h gen a day</span> : null}
                {T && hh !== "gen" && (
                  <button type="button" onClick={onTariff} className={`${pill} gap-1.5 text-card`}>
                    ₦{fU(T.value)}/kWh · {T.source.toLowerCase()}{" "}
                    <span className="text-fuel">Edit</span>
                  </button>
                )}
                <CalBadges r={r} enabled={enabled} />
              </div>
            </div>

            <div className="mt-3.5 flex flex-col gap-3">
              <LightHoursCard r={r} enabled={enabled} keptAt={keptAt} onSet={onSetHours} onKeep={onKeepHours} />
              <RealityCard r={r} enabled={enabled} />
              <HybridSummary
                r={r}
                enabled={enabled}
                gridDaily={tot.grid.typical}
                genDaily={tot.gen.typical}
                gridTariff={calib.tariff}
                genRate={calib.genRate}
              />
              <GenInsightCard r={r} enabled={enabled} gridTariff={calib.tariff} />
            </div>

            <div className="mt-7 flex flex-col gap-[22px]">
              {groups.map((grp) => (
                <div key={grp.id} className="flex flex-col">
                  <Eyebrow className="border-b-[1.5px] border-ink pb-1.5">{grp.label}</Eyebrow>
                  {grp.items.map((d) => {
                    const w = supplyNote(d, calib);
                    const s = split.get(d.id)!;
                    const n = money ? rowNaira.get(d.id) : null;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onOpen(d)}
                        className={`grid min-h-[68px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line px-1 py-3 text-left transition-colors duration-600 hover:bg-track-2 ${
                          highlight === d.id ? "bg-fuel-soft" : ""
                        }`}
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-track text-[22px]">
                          {d.icon}
                        </span>
                        <span className="flex min-w-0 flex-col gap-[3px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-base font-semibold">{d.name}</span>
                            {d.quantity > 1 && <QtyBadge qty={d.quantity} />}
                            <SourceBadge d={d} />
                          </span>
                          <span className={`font-mono text-xs ${w ? "text-fuel-ink" : "text-muted"}`}>
                            {w && <span aria-label="Set longer than your power is on">⚠ </span>}
                            {usageSummary(d)}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="text-base font-bold tabular-nums">
                            {n ? "~" + moneyFor(n.typical, 30) : fU(unitsOf(s).typical * 30) + " units"}
                          </span>
                          <span className="font-mono text-[11px] text-muted">/ month</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <Link
              href="/app/solar"
              className="mt-7 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[18px] border border-line bg-card p-4 text-ink no-underline hover:bg-track-2"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-fuel-soft text-[22px]" aria-hidden="true">
                ☀️
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-bold">Thinking about solar?</span>
                <span className="text-[13px] leading-[1.4] text-muted">
                  See when it would start paying you back, using these devices and your spend.
                </span>
              </span>
              <span className="text-lg" aria-hidden="true">
                →
              </span>
            </Link>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-line-strong px-[22px] py-8 text-center">
            <span className="text-[40px]" aria-hidden="true">
              🔌
            </span>
            <span className="text-[22px] font-extrabold tracking-[-0.02em]">What&apos;s eating your units?</span>
            <span className="max-w-[340px] text-[15px] leading-normal text-pretty text-muted">
              Add the devices in your home and Calgy estimates what each one costs to run on light.
            </span>
            <div className="mt-2 flex w-full max-w-[340px] flex-col gap-2.5">
              <button type="button" onClick={onAdd} className="h-14 rounded-2xl bg-ink text-base font-bold text-card">
                Add your first device
              </button>
              <button
                type="button"
                onClick={onLagos}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl border-[1.5px] border-line-strong px-4 py-2"
              >
                <span className="text-base font-bold">Start with a typical Lagos flat</span>
                <span className="text-xs text-muted">Fans, bulbs, TV, fridge, router, phones, laptop, iron</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {devices.length > 0 && (
        <div className="bar-fade pb-safe-bar fixed inset-x-0 bottom-0 z-20 px-5 pt-[22px]">
          <div className="mx-auto grid max-w-[560px] grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onAdd}
              className="h-[62px] rounded-[18px] bg-light text-lg font-extrabold text-white shadow-[0_6px_18px_rgba(31,122,77,0.25)] active:scale-[.97]"
            >
              + Add device
            </button>
            <button
              type="button"
              onClick={onSim}
              className="h-[62px] rounded-[18px] bg-ink text-lg font-extrabold text-card active:scale-[.97]"
            >
              Open simulator
            </button>
          </div>
        </div>
      )}
    </>
  );
}
