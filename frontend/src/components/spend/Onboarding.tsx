"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { commas, dec, digits, nice, num, short } from "@/lib/format";
import { computeActualDaily, daysLeftRange } from "@/lib/meter";
import type { PowerSource } from "@/lib/spend";
import { Eyebrow, Logo, Marker, Segmented, SplitBar } from "../ui";

export type ObState = {
  source: PowerSource;
  fuel: string; // ₦/week, legacy: gen costs now come from the generator questions
  /** Meter questions: 1 at the meter, 2 last token, 3 hours of light. */
  step: 1 | 2 | 3;
  unitsLeft: string;
  dailyKwh: string; // the meter's own average, if it shows one
  daysLeft: string;
  totalUsed: string;
  startDate: string; // YYYY-MM-DD, needed with totalUsed
  topupDate: string;
  topupPrice: string;
  topupUnits: string;
  hoursMode: "auto" | "set";
  hours: string;
  /** The reading saved from these answers, so going back and forth updates it instead of adding another. */
  readingId?: string;
};

const DAYS_PER_MONTH = 365 / 12;
const trim1 = (n: number) => String(Math.round(n * 10) / 10);
export const usesGrid = (s: PowerSource) => s !== "gen";
export const usesGen = (s: PowerSource) => s !== "nepa";

/** ₦/kWh from the last top-up, or 0 if either side is missing. */
export const obTariff = (ob: ObState) => {
  const units = num(ob.topupUnits);
  return units ? num(digits(ob.topupPrice)) / units : 0;
};

/** The meter answers as a profile (the meter's average and lifetime figures). */
export const obProfile = (ob: ObState) => ({
  meterDailyAvgKwh: num(ob.dailyKwh) || undefined,
  lifetimeKwh: num(ob.totalUsed) && ob.startDate ? num(ob.totalUsed) : undefined,
  meterStartDate: num(ob.totalUsed) && ob.startDate ? ob.startDate : undefined,
});

/** Daily kWh from what the meter shows (no readings yet). */
export const obDaily = (ob: ObState) => computeActualDaily([], [], obProfile(ob), new Date()).value ?? 0;

/** Rough monthly split from the onboarding answers. */
export function obMonthly(ob: ObState) {
  const fuelM = usesGen(ob.source) ? (num(digits(ob.fuel)) * 52) / 12 : 0;
  const tokenM = usesGrid(ob.source) ? obDaily(ob) * DAYS_PER_MONTH * obTariff(ob) : 0;
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

function MeterIntro({ hybrid }: { hybrid: boolean }) {
  return (
    <Section type="token" title="Your prepaid meter">
      <span className="text-base leading-[1.45] text-pretty text-muted">
        Next: 3 quick questions at your meter — units left, your last token and your hours of light.
        {hybrid ? " Then 4 about your gen." : ""}
      </span>
    </Section>
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
  const gen = usesGen(ob.source);
  const grid = usesGrid(ob.source);

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
          {grid && <MeterIntro hybrid={gen} />}
          {gen && !grid && <GenIntro />}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,#F2EEE4_70%,rgba(242,238,228,0))] px-5 pt-7 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[440px] items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">
              {grid ? "At your meter" : "Under a minute"}
            </span>
            <span className="text-2xl font-extrabold tracking-[-0.03em]">
              {grid && gen ? "7 questions" : grid ? "3 questions" : "4 questions"}
            </span>
          </div>
          <button
            type="button"
            onClick={onSeeEstimate}
            className="h-14 rounded-2xl bg-ink px-[22px] text-base font-bold text-card active:scale-[.97]"
          >
            {grid ? "Next: your meter →" : "Next: your gen →"}
          </button>
        </div>
      </div>
    </>
  );
}

export function Reveal({ ob, onStart, onAdjust }: { ob: ObState; onStart: () => void; onAdjust: () => void }) {
  const { fuelM, tokenM, monthly } = obMonthly(ob);
  const fuelPct = monthly ? Math.round((fuelM / monthly) * 100) : 0;
  const auto = ob.hoursMode === "auto";
  const h = num(ob.hours);
  const daily = obDaily(ob);
  const left = num(ob.unitsLeft);
  const now = new Date().toISOString();
  const days =
    left > 0
      ? daysLeftRange(left, null, {
          id: "", unitsLeft: left, takenAt: now, context: "onboarding",
          meterDaysLeft: ob.daysLeft.trim() ? num(ob.daysLeft) : undefined, meterDailyAvgKwh: num(ob.dailyKwh) || undefined,
        }, obProfile(ob), now)
      : null;
  const fmtU = (n: number) => trim1(n);
  const gridLine = auto
    ? `Using roughly ${fmtU(daily)} units a day. Add your devices and Calgy works out your hours of light from your meter.`
    : !usesGen(ob.source)
    ? `About ${h} hours of light a day, using roughly ${fmtU(daily)} units.`
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
      {usesGrid(ob.source) && days && (
        <p className="mt-3 text-base leading-[1.45] text-pretty">
          Your {fmtU(left)} units left should last about {days.low === days.high ? days.low : `${days.low}–${days.high}`} days — plan
          your next top-up around then.
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
