"use client";

import type { Dispatch, SetStateAction } from "react";
import { commas, digits, nice, num, short } from "@/lib/format";
import { Chip, Eyebrow, Logo, Marker, SplitBar } from "../ui";

export type ObState = { fuel: string; token: string; hours: number };

function MoneyBlock({
  type,
  title,
  suffix,
  value,
  onChange,
  chips,
}: {
  type: "fuel" | "token";
  title: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  chips: number[];
}) {
  const cur = num(digits(value));
  return (
    <div className="flex flex-col gap-3 border-t border-line py-5">
      <div className="flex items-center gap-2.5">
        <Marker type={type} />
        <span className="text-[17px] font-semibold">{title}</span>
      </div>
      <label className="flex h-[60px] items-center gap-1.5 rounded-[14px] border-[1.5px] border-line bg-card px-4">
        <span className="text-2xl font-semibold text-muted">₦</span>
        <input
          inputMode="numeric"
          placeholder="0"
          aria-label={title}
          value={value}
          onChange={(e) => onChange(commas(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-[26px] font-bold tracking-[-0.01em] outline-none"
        />
        <span className="shrink-0 font-mono text-[13px] whitespace-nowrap text-muted">{suffix}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {chips.map((v) => (
          <Chip key={v} on={cur === v} onClick={() => onChange(commas(v))}>
            {short(v)}
          </Chip>
        ))}
      </div>
    </div>
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
  const monthly = (num(digits(ob.fuel)) * 52) / 12 + num(digits(ob.token));

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
          Three rough numbers. Guesses are fine — your real logs will replace them.
        </p>

        <MoneyBlock
          type="fuel"
          title="Generator fuel"
          suffix="/ week"
          value={ob.fuel}
          onChange={(v) => setOb((s) => ({ ...s, fuel: v }))}
          chips={[5000, 10000, 20000, 40000]}
        />
        <MoneyBlock
          type="token"
          title="Prepaid meter tokens"
          suffix="/ month"
          value={ob.token}
          onChange={(v) => setOb((s) => ({ ...s, token: v }))}
          chips={[5000, 10000, 20000, 30000]}
        />

        <div className="flex flex-col gap-1.5 border-y border-line py-5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="ob-hours" className="text-[17px] font-semibold">
              Hours of light a day
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
            onChange={(e) => setOb((s) => ({ ...s, hours: +e.target.value }))}
            className="m-0 h-11 w-full accent-light"
          />
          <div className="flex justify-between font-mono text-xs text-muted">
            <span>0 · none</span>
            <span>24 · steady</span>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,#F2EEE4_70%,rgba(242,238,228,0))] px-5 pt-7 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[440px] items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">Rough monthly</span>
            <span className="text-2xl font-extrabold tracking-[-0.03em]">
              {monthly ? "~" + short(nice(monthly)) : "₦0"}
            </span>
          </div>
          <button
            type="button"
            onClick={onSeeEstimate}
            className="h-14 rounded-2xl bg-ink px-[22px] text-base font-bold text-card active:scale-[.97]"
          >
            See my estimate →
          </button>
        </div>
      </div>
    </>
  );
}

export function Reveal({ ob, onStart, onAdjust }: { ob: ObState; onStart: () => void; onAdjust: () => void }) {
  const fuelM = (num(digits(ob.fuel)) * 52) / 12;
  const tokenM = num(digits(ob.token));
  const monthly = fuelM + tokenM;
  const fuelPct = monthly ? Math.round((fuelM / monthly) * 100) : 0;
  const h = ob.hours;
  const gridLine =
    h >= 20
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
