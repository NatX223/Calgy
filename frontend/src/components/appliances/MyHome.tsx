"use client";

import { supplyWarning, sumTrio, trio, usageSummary, type Device, type Tariff } from "@/lib/appliances";
import { fU, naira, num, rN } from "@/lib/format";
import Link from "next/link";
import { CATEGORIES } from "@/lib/presets";
import { Eyebrow } from "../ui";

/** ₦ for kWh/day over a period, rounded per the period rule. */
export const costFor = (T: Tariff | null) => (kwhPerDay: number, days: number) =>
  naira(rN(kwhPerDay * days * (T?.value ?? 0), days));

export function QtyBadge({ qty }: { qty: number }) {
  return (
    <span className="h-[22px] shrink-0 rounded-md bg-ink px-[7px] font-mono text-xs leading-[22px] text-card">×{qty}</span>
  );
}

export function MyHome({
  devices,
  T,
  gridHours: g,
  highlight,
  onOpen,
  onAdd,
  onSim,
  onLagos,
  onTariff,
}: {
  devices: Device[];
  T: Tariff | null;
  gridHours: number;
  highlight: string | null;
  onOpen: (d: Device) => void;
  onAdd: () => void;
  onSim: () => void;
  onLagos: () => void;
  onTariff: () => void;
}) {
  const tot = sumTrio(devices);
  const cost = costFor(T);
  const qtyTotal = devices.reduce((a, d) => a + Math.max(1, num(d.qty)), 0);
  const groups = CATEGORIES.map((c) => ({ ...c, items: devices.filter((d) => d.cat === c.id) })).filter(
    (g) => g.items.length,
  );
  const pill = "inline-flex h-8 items-center rounded-full bg-ink-pill px-3 text-[13px] font-medium whitespace-nowrap";

  return (
    <>
      <div className="flex flex-col pt-3 pb-[132px]">
        <h1 className="text-4xl leading-none font-extrabold tracking-[-0.04em]">My Home</h1>
        <p className="mt-2 mb-[22px] text-[15px] leading-[1.45] text-pretty text-muted">
          The devices you run on light, and roughly what they cost.
        </p>

        {devices.length > 0 ? (
          <>
            <div className="flex flex-col gap-[18px] rounded-[22px] bg-ink p-[22px] text-card">
              <Eyebrow className="text-ink-muted">Estimated · per month</Eyebrow>
              {T ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[52px] leading-none font-extrabold tracking-[-0.05em]">~{cost(tot.typ, 30)}</span>
                    <span className="font-mono text-[13px] text-ink-muted">
                      {cost(tot.lo, 30)} – {cost(tot.hi, 30)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 border-t border-ink-line pt-3.5">
                    <span className="text-lg font-bold">~{fU(tot.typ * 30)} units (kWh)</span>
                    <span className="font-mono text-xs text-ink-muted">
                      {fU(tot.lo * 30)} – {fU(tot.hi * 30)} units (kWh)
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[44px] leading-none font-extrabold tracking-[-0.045em]">
                      ~{fU(tot.typ * 30)} units
                    </span>
                    <span className="font-mono text-[13px] text-ink-muted">
                      {fU(tot.lo * 30)} – {fU(tot.hi * 30)} units (kWh)
                    </span>
                  </div>
                  <button type="button" onClick={onTariff} className="h-12 rounded-[14px] bg-fuel text-[15px] font-bold text-ink">
                    Set your tariff to see ₦ →
                  </button>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <span className={pill}>
                  {qtyTotal} device{qtyTotal === 1 ? "" : "s"}
                </span>
                <span className={pill}>~{g}h light a day</span>
                {T && (
                  <button type="button" onClick={onTariff} className={`${pill} gap-1.5 text-card`}>
                    ₦{fU(T.value)}/kWh · {T.source === "Set by you" ? "set by you" : "from tokens"}{" "}
                    <span className="text-fuel">Edit</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-[22px]">
              {groups.map((grp) => (
                <div key={grp.id} className="flex flex-col">
                  <Eyebrow className="border-b-[1.5px] border-ink pb-1.5">{grp.label}</Eyebrow>
                  {grp.items.map((d) => {
                    const w = supplyWarning(d, g);
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
                            {d.qty > 1 && <QtyBadge qty={d.qty} />}
                          </span>
                          <span className={`font-mono text-xs ${w ? "text-fuel-ink" : "text-muted"}`}>
                            {usageSummary(d)}
                            {w ? " · over light hours" : ""}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="text-base font-bold tabular-nums">
                            {T ? "~" + cost(trio(d).typ, 30) : fU(trio(d).typ * 30) + " units"}
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
                <span className="text-xs text-muted">Fans, bulbs, TV, fridge, router, phones, laptop</span>
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
