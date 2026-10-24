"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { dec, digits, num, todayIso, trim } from "@/lib/format";
import { unitsError } from "@/lib/meter";
import { Eyebrow } from "../ui";
import { Note, Option } from "./GenOnboarding";
import { Field, obTariff, usesGen, type ObState } from "./Onboarding";

const STEPS = 3;

/** A message, "" for incomplete-but-quiet, or null when Next is allowed. */
export function meterStepError(ob: ObState, step: 1 | 2 | 3): string | null {
  if (step === 1) {
    const u = unitsError(ob.unitsLeft);
    if (u !== null) return u;
    if (num(ob.totalUsed) > 0 && !ob.startDate) return "Add the date you started using this meter.";
    if (ob.startDate && ob.startDate > todayIso()) return "That date is in the future.";
    return null;
  }
  if (step === 3 && ob.hoursMode === "set") {
    if (!ob.hours.trim()) return "";
    return num(ob.hours) > 24 ? "A day only has 24 hours." : null;
  }
  return null;
}

const TITLES = {
  1: { eyebrow: "At your meter", title: "Go to your meter", help: "Type what it shows. We note the time for you." },
  2: { eyebrow: "Your last token", title: "What did your last token give you?", help: "Both numbers are on your token receipt. They tell us your real price per unit." },
  3: { eyebrow: "Hours of light", title: "How many hours of light do you get?", help: "Not sure? Leave it — we'll estimate it from your meter and devices." },
} as const;

const optional = <span className="font-normal text-muted"> · if your meter shows it</span>;

function AtMeter({ ob, set }: { ob: ObState; set: (p: Partial<ObState>) => void }) {
  const [help, setHelp] = useState(false);
  const err = meterStepError(ob, 1);
  return (
    <>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Units left</span>
        <span className="flex items-center gap-2 border-b-2 border-light pb-1">
          <input
            inputMode="decimal"
            autoFocus
            placeholder="0.0"
            aria-label="Units left"
            value={ob.unitsLeft}
            onChange={(e) => set({ unitsLeft: dec(e.target.value) })}
            className="min-w-0 flex-1 bg-transparent p-0 text-[44px] font-extrabold tracking-[-0.035em] outline-none"
          />
          <span className="font-mono text-[15px] text-muted">kWh</span>
        </span>
      </label>
      <button
        type="button"
        onClick={() => setHelp(true)}
        className="-mt-1 self-start text-sm font-semibold text-light underline underline-offset-[3px]"
      >
        Can&apos;t find these?
      </button>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Average daily usage" suffix="kWh" value={ob.dailyKwh} onChange={(v) => set({ dailyKwh: v })} />
        <Field label="Days left" suffix="days" value={ob.daysLeft} onChange={(v) => set({ daysLeft: v })} />
      </div>
      <span className="-mt-2 text-[13px] text-muted">Both optional{optional}.</span>

      <div className="flex flex-col gap-3 rounded-[14px] bg-track-2 p-3.5">
        <Field label="Total used" suffix="kWh" value={ob.totalUsed} onChange={(v) => set({ totalUsed: v })} />
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-sm font-semibold">When did you start using this meter?</span>
          <input
            type="date"
            value={ob.startDate}
            max={todayIso()}
            onChange={(e) => set({ startDate: e.target.value })}
            className="h-[52px] w-full rounded-xl border-[1.5px] border-line bg-card px-3 text-base font-semibold outline-none"
          />
        </label>
        <span className="text-[13px] text-muted">Optional{optional}.</span>
      </div>
      {err && <Note tone="error">{err}</Note>}

      {help && (
        <>
          <div onClick={() => setHelp(false)} aria-hidden="true" className="fixed inset-0 z-40 bg-[rgba(25,23,18,0.45)]" />
          <div role="dialog" aria-modal="true" aria-label="Finding your meter's numbers" className="fixed inset-x-0 bottom-0 z-50">
            <div className="mx-auto flex max-w-[480px] flex-col gap-3 rounded-t-[24px] bg-card px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(25,23,18,0.18)]">
              <div className="mx-auto h-1 w-10 rounded-sm bg-line" />
              <span className="text-[22px] font-extrabold tracking-[-0.025em]">Finding the numbers</span>
              <p className="text-[15px] leading-[1.5] text-pretty text-body-2">
                The balance is usually the default display. On many meters the short code <strong>07</strong> shows it. Codes
                differ by brand — check your meter guide or ask your DisCo.
              </p>
              <button type="button" autoFocus onClick={() => setHelp(false)} className="h-[52px] rounded-[14px] bg-ink text-[15px] font-bold text-card">
                Got it
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function LastToken({ ob, set }: { ob: ObState; set: (p: Partial<ObState>) => void }) {
  const t = obTariff(ob);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" prefix="₦" money value={ob.topupPrice} onChange={(v) => set({ topupPrice: v })} />
        <Field label="Units received" suffix="kWh" value={ob.topupUnits} onChange={(v) => set({ topupUnits: v })} />
      </div>
      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-semibold">Loaded on</span>
        <input
          type="date"
          value={ob.topupDate}
          max={todayIso()}
          onChange={(e) => set({ topupDate: e.target.value || todayIso() })}
          className="h-[52px] w-full rounded-xl border-[1.5px] border-line bg-card px-3 text-base font-semibold outline-none"
        />
      </label>
      <span className={`font-mono text-[13px] ${t ? "text-light" : "text-muted"}`}>
        {t ? `= ₦${trim(t.toFixed(1))} per unit (kWh)` : "Optional, but it's how we know your real price."}
      </span>
    </>
  );
}

function LightHours({ ob, set }: { ob: ObState; set: (p: Partial<ObState>) => void }) {
  const err = meterStepError(ob, 3);
  return (
    <div role="radiogroup" aria-label="Hours of light" className="flex flex-col gap-2.5">
      <Option
        on={ob.hoursMode === "auto"}
        onClick={() => set({ hoursMode: "auto" })}
        title="Let Calgy work it out"
        meta="From your meter readings and devices"
      />
      <Option on={ob.hoursMode === "set"} onClick={() => set({ hoursMode: "set" })} title="I know my hours">
        <label className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5">
          <input
            inputMode="decimal"
            autoFocus
            placeholder="0"
            aria-label="Hours of light a day"
            value={ob.hours}
            onChange={(e) => set({ hours: dec(e.target.value) })}
            className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
          />
          <span className="shrink-0 font-mono text-[13px] text-muted">hours a day</span>
        </label>
        {err && (
          <div className="mt-2">
            <Note tone="error">{err}</Note>
          </div>
        )}
      </Option>
    </div>
  );
}

export function MeterSteps({
  ob,
  setOb,
  hasEstimate,
  onBack,
  onNext,
}: {
  ob: ObState;
  setOb: Dispatch<SetStateAction<ObState>>;
  /** Is there enough for a ₦ estimate (decides the last button's label)? */
  hasEstimate: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = (p: Partial<ObState>) => setOb((s) => ({ ...s, ...p }));
  const t = TITLES[ob.step];
  const blocked = meterStepError(ob, ob.step) !== null;
  const last = ob.step === STEPS;
  const skippable = ob.step === 2 && !num(digits(ob.topupPrice)) && !num(ob.topupUnits);

  return (
    <>
      <div className="flex flex-col pb-[130px]">
        <header className="flex h-16 items-center justify-between">
          <button type="button" onClick={onBack} className="h-11 pr-3 text-base font-semibold">
            ‹ Back
          </button>
          <span className="font-mono text-[13px] text-muted">
            {ob.step} of {STEPS}
          </span>
        </header>
        <div
          role="progressbar"
          aria-label="Meter questions"
          aria-valuemin={1}
          aria-valuemax={STEPS}
          aria-valuenow={ob.step}
          className="grid grid-cols-3 gap-1"
        >
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full ${i < ob.step ? "bg-light" : "bg-line"}`} />
          ))}
        </div>

        <Eyebrow className="mt-7">{t.eyebrow}</Eyebrow>
        <h1 className="mt-2.5 text-[34px] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">{t.title}</h1>
        <p className="mt-2.5 text-base leading-[1.45] text-pretty text-muted">{t.help}</p>

        <div className="mt-6 flex flex-col gap-4">
          {ob.step === 1 && <AtMeter ob={ob} set={set} />}
          {ob.step === 2 && <LastToken ob={ob} set={set} />}
          {ob.step === 3 && <LightHours ob={ob} set={set} />}
        </div>
      </div>

      <div className="bar-fade pb-safe-bar fixed inset-x-0 bottom-0 z-20 px-5 pt-7">
        <div className="mx-auto max-w-[440px]">
          <button
            type="button"
            onClick={onNext}
            disabled={blocked}
            className="h-14 w-full rounded-2xl bg-ink text-base font-bold text-card transition-opacity duration-200 active:scale-[.98] disabled:opacity-40"
          >
            {!last
              ? skippable
                ? "Skip for now →"
                : "Next →"
              : usesGen(ob.source)
                ? "Next: your gen →"
                : hasEstimate
                  ? "See my estimate →"
                  : "Done"}
          </button>
        </div>
      </div>
    </>
  );
}
