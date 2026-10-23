"use client";

import { commas, dec, digits, num, trimN } from "@/lib/format";
import { money } from "@/lib/solar";
import type { SolarCtx } from "./SolarApp";
import { BatterySwitch, cardClass, ScopeSwitch, Section } from "./SolarInputs";

const TONE_BG = { good: "bg-light-chip", warn: "bg-fuel-soft", bad: "bg-red-soft" } as const;
const darkLabel = "font-mono text-[11px] tracking-[0.06em] text-ink-muted uppercase";

// ——— 05 · Result ———

export function ResultSection({ ctx }: { ctx: SolarCtx }) {
  const { m, be, need, sysCopy } = ctx;
  const R = m.results;

  return (
    <Section eyebrow="05 · Result" title="When solar starts winning" sectionRef={ctx.resultsRef}>
      <div className="flex flex-col gap-[18px] rounded-[22px] bg-ink px-5 py-[22px] text-card" aria-live="polite">
        {R && be ? <Result ctx={ctx} /> : need && (
          <>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-xs tracking-[0.08em] text-ink-muted uppercase">Break-even</span>
              <span className="text-2xl leading-[1.15] font-extrabold tracking-[-0.03em] text-pretty">{need.t}</span>
              <span className="text-sm leading-normal text-pretty text-ink-muted">{need.b}</span>
            </div>
            {m.hasSizing && (
              <div className="flex flex-wrap gap-2">
                {[`${m.sys.kva} kVA`, sysCopy.batLabel, sysCopy.panLabel].map((c) => (
                  <span key={c} className="inline-flex h-8 items-center rounded-full bg-ink-pill px-3 text-[13px] font-medium whitespace-nowrap">
                    {c}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={need.pf} className="h-[50px] rounded-[14px] bg-fuel px-[18px] text-[15px] font-bold text-ink">
                {need.p}
              </button>
              {need.s && (
                <button
                  type="button"
                  onClick={need.sf}
                  className="h-[50px] rounded-[14px] border-[1.5px] border-body-2 px-[18px] text-[15px] font-bold text-card"
                >
                  {need.s}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

function Result({ ctx }: { ctx: SolarCtx }) {
  const { m, be, form } = ctx;
  const R = m.results!;
  const b = be!;
  const solarUp = num(digits(form.solarUp));
  const batLifeY = num(form.batLife[form.battery]);
  const still = R.typ.residual + solarUp;
  const plan = { monthly: num(digits(form.plan.monthly)), months: Math.round(num(form.plan.months)) };
  const T5 = R.typ.totals.y5;
  const T10 = R.typ.totals.y10;
  const mx = Math.max(T10.now, T10.solar, 1);
  const savOk = R.typ.savingsMonthly > 0;

  const batteryNote =
    batLifeY >= 10
      ? "no battery swap"
      : batLifeY >= 5
        ? `a new battery every ${trimN(batLifeY)} years`
        : `new batteries every ${trimN(batLifeY)} years`;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs tracking-[0.08em] text-ink-muted uppercase">Break-even</span>
        <span className="leading-none font-extrabold tracking-[-0.05em]" style={{ fontSize: b.size }}>
          {b.main}
        </span>
        <span className="font-mono text-[13px] text-ink-muted">{b.range}</span>
      </div>
      <div className={`rounded-xl px-3.5 py-3 text-[15px] leading-[1.45] font-semibold text-pretty text-ink ${TONE_BG[b.tone]}`}>
        {b.verdict}
      </div>
      {!m.hasFuel && m.curBase < 25000 && (
        <div className="rounded-xl border-[1.5px] border-fuel px-3.5 py-3 text-sm leading-[1.45] text-pretty text-fuel-soft">
          You only buy tokens, and not many, so solar has little to replace. That&apos;s why payback is so slow.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5 border-t border-ink-line pt-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className={darkLabel}>Saved / month</span>
          <span className={`text-2xl leading-[1.05] font-extrabold tracking-[-0.03em] ${savOk ? "text-light-chip" : "text-red-soft"}`}>
            ~{money(R.typ.savingsMonthly)}
          </span>
          <span className="font-mono text-xs text-ink-muted">
            {money(R.bad.savingsMonthly)} – {money(R.good.savingsMonthly)} · of {money(m.cur)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={darkLabel}>Still spent / month</span>
          <span className="text-2xl leading-[1.05] font-extrabold tracking-[-0.03em]">~{money(still)}</span>
          <span className="font-mono text-xs text-ink-muted">
            {m.whole ? "rainy-season top-ups + upkeep" : "heavy devices + upkeep"}
          </span>
        </div>
      </div>

      {form.costMode === "plan" && (
        <div className="flex flex-col gap-1 rounded-[14px] bg-ink-pill p-3.5">
          <span className="text-[17px] leading-[1.3] font-bold">
            {money(plan.monthly)}/month plan vs {money(m.cur)} you spend now
          </span>
          <span className="text-[13px] leading-[1.45] text-pretty text-ink-muted">
            During the plan you&apos;d pay about {money(plan.monthly + still)} a month all-in, including what you still
            spend on light and fuel. After month {plan.months}, about {money(still)}.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-ink-line pt-3.5">
        {(
          [
            ["Over 5 years", T5],
            ["Over 10 years", T10],
          ] as const
        ).map(([label, t]) => {
          const saves = t.now >= t.solar;
          return (
            <div key={label} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2.5">
                <span className="text-[15px] font-bold whitespace-nowrap">{label}</span>
                <span className={`text-sm font-bold ${saves ? "text-light-chip" : "text-red-soft"}`}>
                  {saves ? `Solar saves ${money(t.now - t.solar)}` : `Solar costs ${money(t.solar - t.now)} more`}
                </span>
              </div>
              <Bar label="Now" pct={(t.now / mx) * 100} value={money(t.now)} color="bg-fuel" />
              <Bar label="Solar" pct={(t.solar / mx) * 100} value={money(t.solar)} color="bg-light-chip" />
            </div>
          );
        })}
        <span className="text-xs leading-normal text-pretty text-ink-muted">
          Solar includes {batteryNote}, an inverter swap at year 8 and {money(solarUp)}/month upkeep. Now includes{" "}
          {m.hasFuel ? `fuel and a new generator every ${trimN(num(form.genLife))} years` : "your tokens"}. Today&apos;s
          prices.
        </span>
      </div>
    </>
  );
}

function Bar({ label, pct, value, color }: { label: string; pct: number; value: string; color: string }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2.5">
      <span className="font-mono text-xs text-ink-muted">{label}</span>
      <span className="h-3 overflow-hidden rounded-[3px] bg-ink-pill">
        <span className={`block h-full transition-[width] duration-300 ${color}`} style={{ width: `${Math.round(pct)}%` }} />
      </span>
      <span className="min-w-16 text-right font-mono text-[13px]">{value}</span>
    </div>
  );
}

// ——— 06 · What if ———

export function WhatIfSection({ ctx }: { ctx: SolarCtx }) {
  const { form, set, m, src, fuelPct, setFuelPct, showAssume, setShowAssume } = ctx;
  const fuel = num(digits(form.fuelM));
  const bt = form.battery;
  const pctClass = fuelPct > 0 ? "text-red" : fuelPct < 0 ? "text-light" : "text-ink";

  const assume = [
    { label: "New generator costs", value: form.genPrice, unit: "", money: true, on: (v: string) => set({ genPrice: commas(v) }) },
    { label: "Generator lasts", value: form.genLife, unit: "yrs", money: false, on: (v: string) => set({ genLife: dec(v).slice(0, 4) }) },
    { label: "Solar upkeep", value: form.solarUp, unit: "/mo", money: true, on: (v: string) => set({ solarUp: commas(v) }) },
    {
      label: bt === "lithium" ? "Lithium battery lasts" : "Tubular batteries last",
      value: form.batLife[bt],
      unit: "yrs",
      money: false,
      on: (v: string) => set({ batLife: { ...form.batLife, [bt]: dec(v).slice(0, 4) } }),
    },
  ];

  return (
    <Section eyebrow="06 · What if" title="Push the numbers">
      <div className={`${cardClass} gap-[18px]`}>
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="fuel-pct" className="text-[15px] font-semibold">
              Fuel price
            </label>
            <span className={`text-xl font-extrabold tracking-[-0.02em] ${pctClass}`}>
              {fuelPct === 0 ? "Today" : (fuelPct > 0 ? "+" : "−") + Math.abs(fuelPct) + "%"}
            </span>
          </div>
          <input
            id="fuel-pct"
            type="range"
            min={-20}
            max={50}
            step={5}
            value={fuelPct}
            onChange={(e) => setFuelPct(+e.target.value)}
            className="m-0 h-10 w-full accent-fuel"
          />
          <div className="flex justify-between font-mono text-[11px] text-muted">
            <span>−20%</span>
            <span>today</span>
            <span>+50%</span>
          </div>
          <span className="mt-1 font-mono text-xs text-body-2">
            {m.hasFuel
              ? `${money(fuel)} fuel → ${money(fuel * m.fm)} a month` +
                (src.avgL ? ` · ~₦${Math.round(src.avgL * m.fm).toLocaleString("en-NG")}/L` : "")
              : "No fuel spend entered, so this won’t change anything."}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold">Solar powers</span>
          <ScopeSwitch scope={form.scope} onChange={(scope) => set({ scope })} tall={false} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold">Battery</span>
          <BatterySwitch battery={bt} onChange={(battery) => set({ battery })} className="rounded-[14px]" />
        </div>

        <div className="flex flex-col border-t border-track pt-1.5">
          <button
            type="button"
            aria-expanded={showAssume}
            onClick={() => setShowAssume(!showAssume)}
            className="flex h-12 w-full items-center justify-between text-[15px] font-semibold"
          >
            <span>Assumptions</span>
            <span className={`text-sm text-muted transition-transform duration-200 ${showAssume ? "rotate-180" : ""}`}>▾</span>
          </button>
          {showAssume && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {assume.map((a) => (
                  <label key={a.label} className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-[13px] leading-[1.3] font-semibold">{a.label}</span>
                    <span className="flex h-12 items-center gap-1 rounded-xl border-[1.5px] border-line bg-paper px-2.5">
                      {a.money && <span className="text-[15px] text-muted">₦</span>}
                      <input
                        inputMode="decimal"
                        value={a.value}
                        onChange={(e) => a.on(e.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none"
                      />
                      <span className="font-mono text-[11px] text-muted">{a.unit}</span>
                    </span>
                  </label>
                ))}
              </div>
              <span className="pt-2.5 text-xs leading-normal text-pretty text-muted">
                Sun: 4.5 hours a day, 75% after losses. Batteries cover 60% of daily use (after dark). Inverter replaced at
                year 8.
              </span>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
