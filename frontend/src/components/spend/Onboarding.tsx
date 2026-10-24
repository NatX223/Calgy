"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { commas, dec, digits, fmtQ, nice, num, short, todayIso, trim } from "@/lib/format";
import type { PowerSource } from "@/lib/spend";
import { Eyebrow, Logo, Marker, Segmented, SplitBar } from "../ui";

export type ObState = {
  source: PowerSource;
  fuel: string; // ₦/week, legacy: gen costs now come from the generator questions
  dailyKwh: string;
  unitsLeft: string;
  topupDate: string;
  topupPrice: string;
  topupUnits: string;
  hours: number;
};

const DAYS_PER_MONTH = 365 / 12;
export const usesGrid = (s: PowerSource) => s !== "gen";
export const usesGen = (s: PowerSource) => s !== "nepa";

/** ₦/kWh from the last top-up, or 0 if either side is missing. */
export const obTariff = (ob: ObState) => {
  const units = num(ob.topupUnits);
  return units ? num(digits(ob.topupPrice)) / units : 0;
};

/** Rough monthly split from the onboarding answers. */
export function obMonthly(ob: ObState) {
  const fuelM = usesGen(ob.source) ? (num(digits(ob.fuel)) * 52) / 12 : 0;
  const tokenM = usesGrid(ob.source) ? num(ob.dailyKwh) * DAYS_PER_MONTH * obTariff(ob) : 0;
  return { fuelM, tokenM, monthly: fuelM + tokenM };
}

const TABS: { id: PowerSource; label: string }[] = [
  { id: "gen", label: "Gen" },
  { id: "nepa", label: "NEPA" },
  { id: "hybrid", label: "Hybrid" },
];

function Section({ type, title, children }: { type: "fuel" | "token"; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line py-5">
      <div className="flex items-center gap-2.5">
        <Marker type={type} />
        <span className="text-[17px] font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function Field({
  label,
  prefix,
  suffix,
  value,
  onChange,
  money = false,
}: {
  label: string;
  prefix?: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  money?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-card px-3.5">
        {prefix && <span className="text-lg font-semibold text-muted">{prefix}</span>}
        <input
          inputMode={money ? "numeric" : "decimal"}
          placeholder="0"
          value={value}
          onChange={(e) => onChange(money ? commas(e.target.value) : dec(e.target.value))}
          className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
        />
        {suffix && <span className="shrink-0 font-mono text-[13px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

function NepaQuestions({ ob, setOb }: { ob: ObState; setOb: Dispatch<SetStateAction<ObState>> }) {
  const set = (p: Partial<ObState>) => setOb((s) => ({ ...s, ...p }));
  const tariff = obTariff(ob);
  const daily = num(ob.dailyKwh);
  const left = num(ob.unitsLeft);

  return (
    <>
      <Section type="token" title="Your prepaid meter">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Average daily use" suffix="kWh" value={ob.dailyKwh} onChange={(v) => set({ dailyKwh: v })} />
          <Field label="Units left" suffix="kWh" value={ob.unitsLeft} onChange={(v) => set({ unitsLeft: v })} />
        </div>
        {daily > 0 && left > 0 && (
          <span className="font-mono text-[13px] text-muted">≈ {fmtQ(left / daily)} days left on the meter</span>
        )}
      </Section>

      <Section type="token" title="Last token top-up">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price paid" prefix="₦" money value={ob.topupPrice} onChange={(v) => set({ topupPrice: v })} />
          <Field label="Units received" suffix="kWh" value={ob.topupUnits} onChange={(v) => set({ topupUnits: v })} />
        </div>
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-sm font-semibold">Date</span>
          <input
            type="date"
            value={ob.topupDate}
            max={todayIso()}
            onChange={(e) => set({ topupDate: e.target.value || todayIso() })}
            className="h-[52px] w-full rounded-xl border-[1.5px] border-line bg-card px-3 text-base font-semibold outline-none"
          />
        </label>
        {tariff > 0 && (
          <span className="font-mono text-[13px] text-muted">₦{trim(tariff.toFixed(1))}/kWh on that top-up</span>
        )}
      </Section>

      <div className="flex flex-col gap-1.5 border-y border-line py-5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="ob-hours" className="text-[17px] font-semibold">
            Light hours a day
          </label>
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{ob.hours} hrs</span>
        </div>
        <span className="text-sm text-muted">NEPA supply on a typical day</span>
        <input
          id="ob-hours"
          type="range"
          min={0}
          max={24}
          step={1}
          value={ob.hours}
          onChange={(e) => set({ hours: +e.target.value })}
          className="m-0 h-11 w-full accent-light"
        />
        <div className="flex justify-between font-mono text-xs text-muted">
          <span>0 · none</span>
          <span>24 · steady</span>
        </div>
      </div>
    </>
  );
}

function GenIntro() {
  return (
    <Section type="fuel" title="Generator">
      <span className="text-base leading-[1.45] text-pretty text-muted">
        Next: 4 quick questions about your gen and your last fuel purchase. Have the receipt handy if you kept it.
      </span>
    </Section>
  );
}

export function Onboarding({
  ob,
  setOb,
  onSkip,
  onSeeEstimate,
}: {
  ob: ObState;
  setOb: Dispatch<SetStateAction<ObState>>;
  onSkip: () => void;
  onSeeEstimate: () => void;
}) {
  const { tokenM } = obMonthly(ob);
  const gen = usesGen(ob.source);

  return (
    <>
      <div className="flex flex-col pb-[150px]">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <button type="button" onClick={onSkip} className="h-11 px-1 text-[15px] font-medium text-muted">
            Skip for now
          </button>
        </header>
        <Eyebrow className="mt-5">Quick estimate · under a minute</Eyebrow>
        <h1 className="mt-2.5 mb-3 text-[40px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
          What is light really costing you?
        </h1>
        <p className="mb-6 text-base leading-[1.45] text-pretty text-muted">
          Tell us how you get power. Guesses are fine — your real logs will replace them.
        </p>

        <Segmented
          label="How you get power"
          options={TABS}
          value={ob.source}
          onChange={(source) => setOb((s) => ({ ...s, source }))}
        />
        <div className="mt-4">
          {usesGrid(ob.source) && <NepaQuestions ob={ob} setOb={setOb} />}
          {usesGen(ob.source) && <GenIntro />}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,#F2EEE4_70%,rgba(242,238,228,0))] px-5 pt-7 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[440px] items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">
              {gen ? (usesGrid(ob.source) ? "Light, monthly" : "Under a minute") : "Rough monthly"}
            </span>
            <span className="text-2xl font-extrabold tracking-[-0.03em]">
              {gen && !usesGrid(ob.source) ? "4 questions" : tokenM ? "~" + short(nice(tokenM)) : "₦0"}
            </span>
          </div>
          <button
            type="button"
            onClick={onSeeEstimate}
            className="h-14 rounded-2xl bg-ink px-[22px] text-base font-bold text-card active:scale-[.97]"
          >
            {gen ? "Next: your gen →" : "See my estimate →"}
          </button>
        </div>
      </div>
    </>
  );
}

export function Reveal({ ob, onStart, onAdjust }: { ob: ObState; onStart: () => void; onAdjust: () => void }) {
  const { fuelM, tokenM, monthly } = obMonthly(ob);
  const fuelPct = monthly ? Math.round((fuelM / monthly) * 100) : 0;
  const h = ob.hours;
  const daily = num(ob.dailyKwh);
  const left = num(ob.unitsLeft);
  const gridLine = !usesGen(ob.source)
    ? `About ${h} hours of light a day, using roughly ${fmtQ(daily)} kWh.`
    : h >= 20
      ? `With about ${h} hours of light a day, your generator should be a small slice — watch for it creeping up.`
      : h === 0
        ? "With no reliable grid supply, your generator is doing all the work."
        : `With about ${h} hours of light a day, your generator could be covering up to ${24 - h} hours.`;

  return (
    <div className="flex flex-1 flex-col pb-7">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <Eyebrow className="mt-6">Your rough estimate</Eyebrow>
      <div className="mt-3.5 text-[52px] leading-none font-extrabold tracking-[-0.045em]">
        {short(nice(monthly * 0.85))}–{short(nice(monthly * 1.15))}
      </div>
      <div className="mt-2.5 text-lg text-muted">a month on fuel and light</div>

      <div className="mt-7 flex flex-col gap-1.5 rounded-[20px] bg-ink p-[22px] text-card">
        <Eyebrow className="text-ink-muted">Over a year, that&apos;s</Eyebrow>
        <span className="text-4xl leading-[1.05] font-extrabold tracking-[-0.035em]">
          {short(nice(monthly * 12 * 0.85))} – {short(nice(monthly * 12 * 1.15))}
        </span>
      </div>

      <div className="mt-7">
        <SplitBar fuelPct={fuelPct} empty={!monthly} />
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Marker type="fuel" />
            <span className="text-sm font-semibold">Fuel</span>
            <span className="font-mono text-[13px] text-muted">{fuelPct}%</span>
          </div>
          <span className="text-xl font-extrabold tracking-[-0.02em]">~{short(nice(fuelM))}/mo</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Marker type="token" />
            <span className="text-sm font-semibold">Light</span>
            <span className="font-mono text-[13px] text-muted">{monthly ? 100 - fuelPct : 0}%</span>
          </div>
          <span className="text-xl font-extrabold tracking-[-0.02em]">~{short(nice(tokenM))}/mo</span>
        </div>
      </div>

      <p className="mt-7 text-base leading-[1.45] text-pretty">{gridLine}</p>
      {usesGrid(ob.source) && daily > 0 && left > 0 && (
        <p className="mt-3 text-base leading-[1.45] text-pretty">
          Your {fmtQ(left)} kWh left should last about {fmtQ(left / daily)} days — plan your next top-up around then.
        </p>
      )}
      <p className="mt-3 text-sm leading-normal text-pretty text-muted">
        A ballpark from your guesses, give or take 15%. Log real top-ups and Calgy swaps this for what you actually
        spend.
      </p>
      <div className="min-h-8 flex-1" />
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onStart}
          className="h-[58px] rounded-2xl bg-ink text-[17px] font-bold text-card active:scale-[.98]"
        >
          Start logging
        </button>
        <button type="button" onClick={onAdjust} className="h-12 text-[15px] font-medium text-muted">
          Adjust my numbers
        </button>
      </div>
    </div>
  );
}
