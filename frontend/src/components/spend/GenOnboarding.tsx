"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { commas, dec, digits, MONTHS, naira, num, parseIso, todayIso } from "@/lib/format";
import {
  burnWarning, dateError, fmt1, GEN_TYPES, genType, HOUR_CHIPS, hoursError, naira10, naira100, NOT_SURE_TYPE,
  priceWarning, ratingError, sizeLabel, typeForProfile,
  type FuelType, type GeneratorProfile, type GenSizeSource, type GenSummary, type RatingUnit,
} from "@/lib/generator";
import { Chip, Eyebrow, Logo, Segmented } from "../ui";
import { Field } from "./Onboarding";

export type GenStep = 1 | 2 | 3 | 4;

/** A fuel entry already in the spend log, offered as the starting purchase. */
export type GenPrefill = { id: string; amount: number; litres: number | null; date: string };

export type GenDraft = {
  step: GenStep;
  sizeSource: GenSizeSource | null;
  typeId: string;
  rating: string;
  unit: RatingUnit;
  fuelType: FuelType;
  amount: string;
  date: string;
  litres: string;
  hours: string;
  /** Spend-log entry this purchase is saved as. */
  entryId: string;
  prefill: GenPrefill | null;
  /** null until the user answers "is this your last purchase?" */
  prefillUsed: boolean | null;
};

export const STEPS = 4;

/** Profile fields from the draft's size answers (capacity is resolved by the caller). */
export const draftSize = (g: GenDraft) => ({
  sizeSource: g.sizeSource ?? "not_sure",
  typeId: g.sizeSource === "entered" ? undefined : g.typeId || NOT_SURE_TYPE,
  ratingValue: g.sizeSource === "entered" ? num(g.rating) : undefined,
  ratingUnit: g.sizeSource === "entered" ? g.unit : undefined,
});

/** Hard validation per step: a message, "" for incomplete-but-quiet, or null when Next is allowed. */
export function stepError(g: GenDraft, step: GenStep): string | null {
  if (step === 1) {
    if (!g.sizeSource) return "";
    if (g.sizeSource === "entered") return num(g.rating) > 0 ? ratingError(num(g.rating), g.unit) : "";
    return null;
  }
  if (step === 2) {
    if (g.prefill && g.prefillUsed === null) return "";
    return dateError(g.date) ?? (num(digits(g.amount)) > 0 ? null : "");
  }
  if (step === 3) return num(g.litres) > 0 ? null : "";
  const h = num(g.hours);
  return h > 0 ? hoursError(h) : "";
}

const shortDate = (s: string) => {
  const d = parseIso(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};

const FUELS: { id: FuelType; label: string }[] = [
  { id: "petrol", label: "Petrol" },
  { id: "diesel", label: "Diesel" },
];
const UNITS: { id: RatingUnit; label: string }[] = [
  { id: "kVA", label: "kVA" },
  { id: "kW", label: "kW" },
];

export function Option({
  on,
  onClick,
  title,
  meta,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: ReactNode;
  meta?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-[14px] border-[1.5px] bg-card ${on ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line"}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={onClick}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 rounded-full border-[1.5px] ${on ? "border-ink bg-ink shadow-[inset_0_0_0_4px_var(--color-card)]" : "border-line-strong"}`}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">{title}</span>
          {meta && <span className="font-mono text-xs text-muted">{meta}</span>}
        </span>
      </button>
      {on && children && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export function Note({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl px-3.5 py-2.5 text-sm leading-[1.4] text-pretty ${
        tone === "error" ? "bg-red-soft text-red" : "bg-fuel-soft text-fuel-ink"
      }`}
    >
      {children}
    </p>
  );
}

function SizeStep({ g, set }: { g: GenDraft; set: (p: Partial<GenDraft>) => void }) {
  const err = stepError(g, 1);
  return (
    <>
      <div role="radiogroup" aria-label="Generator size" className="flex flex-col gap-2.5">
        {GEN_TYPES.map((t) => (
          <Option
            key={t.id}
            on={g.sizeSource === "card" && g.typeId === t.id}
            onClick={() => set({ sizeSource: "card", typeId: t.id, fuelType: t.fuel })}
            title={t.label}
            meta={`~${t.kvaLow}–${t.kvaHigh} kVA · ${t.fuel === "diesel" ? "Diesel" : "Petrol"}`}
          />
        ))}
        <Option
          on={g.sizeSource === "entered"}
          onClick={() => set({ sizeSource: "entered" })}
          title="Enter rating"
          meta="From the sticker or manual"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_120px] items-end gap-2.5">
            <Field label="Rating" value={g.rating} onChange={(v) => set({ rating: v })} />
            <Segmented label="Rating unit" options={UNITS} value={g.unit} onChange={(unit) => set({ unit })} />
          </div>
        </Option>
        <Option
          on={g.sizeSource === "not_sure"}
          onClick={() => set({ sizeSource: "not_sure", typeId: NOT_SURE_TYPE })}
          title="Not sure"
          meta={`We'll assume ${genType(NOT_SURE_TYPE)!.label.toLowerCase()}`}
        />
      </div>
      {err && <Note tone="error">{err}</Note>}

      <div className="mt-2 flex flex-col gap-2.5">
        <span className="text-sm font-semibold">Fuel</span>
        <Segmented label="Fuel type" options={FUELS} value={g.fuelType} onChange={(fuelType) => set({ fuelType })} />
      </div>
    </>
  );
}

function PurchaseStep({ g, set, onUsePrefill }: { g: GenDraft; set: (p: Partial<GenDraft>) => void; onUsePrefill: () => void }) {
  const p = g.prefill;
  if (p && g.prefillUsed !== false) {
    return (
      <div className="flex flex-col gap-4 rounded-[18px] border border-line bg-card p-[18px]">
        <Eyebrow>From your spend log</Eyebrow>
        <div className="flex flex-col gap-1">
          <span className="text-[34px] leading-none font-extrabold tracking-[-0.035em]">{naira(p.amount)}</span>
          <span className="font-mono text-[13px] text-muted">
            {p.litres ? `${fmt1(p.litres)} L · ` : ""}
            {shortDate(p.date)}
          </span>
        </div>
        <span className="text-base leading-[1.45] text-pretty">Is this your last fuel purchase?</span>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onUsePrefill}
            className="h-[52px] rounded-[14px] bg-ink text-[15px] font-bold text-card"
          >
            Yes, use it
          </button>
          <button
            type="button"
            onClick={() => set({ prefillUsed: false, amount: "", litres: "", date: todayIso() })}
            className="h-[52px] rounded-[14px] border-[1.5px] border-line-strong text-[15px] font-bold"
          >
            No, a different one
          </button>
        </div>
      </div>
    );
  }

  const dErr = dateError(g.date);
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <Eyebrow>Amount paid</Eyebrow>
        <div className="flex items-center gap-2 border-b-2 border-fuel pb-1">
          <span className="text-[40px] font-bold text-muted">₦</span>
          <input
            inputMode="numeric"
            placeholder="0"
            aria-label="Amount paid"
            autoFocus
            value={g.amount}
            onChange={(e) => set({ amount: commas(e.target.value) })}
            className="min-w-0 flex-1 bg-transparent p-0 text-[44px] font-extrabold tracking-[-0.035em] outline-none"
          />
        </div>
      </div>
      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-semibold">Date you bought it</span>
        <input
          type="date"
          value={g.date}
          max={todayIso()}
          onChange={(e) => set({ date: e.target.value })}
          className="h-[52px] w-full rounded-xl border-[1.5px] border-line bg-card px-3 text-base font-semibold outline-none"
        />
      </label>
      {dErr && <Note tone="error">{dErr}</Note>}
    </>
  );
}

function LitresStep({ g, set }: { g: GenDraft; set: (p: Partial<GenDraft>) => void }) {
  const amt = num(digits(g.amount));
  const L = num(g.litres);
  const warn = priceWarning(amt, L);
  return (
    <>
      <Field label="Litres" suffix="L" value={g.litres} onChange={(v) => set({ litres: v })} />
      <span className="-mt-2 text-sm text-muted">Check your receipt or the pump.</span>
      {amt > 0 && L > 0 && (
        <span className="font-mono text-[13px] text-fuel-ink">= {naira10(amt / L)} per litre</span>
      )}
      {warn && <Note tone="warn">{warn}</Note>}
    </>
  );
}

function HoursStep({ g, set }: { g: GenDraft; set: (p: Partial<GenDraft>) => void }) {
  const h = num(g.hours);
  const err = stepError(g, 4);
  const warn = err ? null : burnWarning(num(g.litres), h, typeForProfile(draftSize(g)));
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {HOUR_CHIPS.map((c) => (
          <Chip key={c} on={h === c} onClick={() => set({ hours: String(c) })} className="h-11 min-w-14 px-4 text-sm">
            {c}h
          </Chip>
        ))}
      </div>
      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-semibold">Or type it</span>
        <span className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-card px-3.5">
          <input
            inputMode="decimal"
            placeholder="0"
            aria-label="Hours"
            value={g.hours}
            onChange={(e) => set({ hours: dec(e.target.value) })}
            className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
          />
          <span className="shrink-0 font-mono text-[13px] text-muted">hours</span>
        </span>
      </label>
      {err && <Note tone="error">{err}</Note>}
      {warn && <Note tone="warn">{warn}</Note>}
    </>
  );
}

const TITLES: Record<GenStep, { eyebrow: string; title: string; help?: string }> = {
  1: { eyebrow: "Your gen", title: "How big is your gen?", help: "Check the sticker on your gen. It usually says kVA." },
  2: { eyebrow: "Last fuel purchase", title: "What did you pay for your last fuel?" },
  3: { eyebrow: "Last fuel purchase", title: "How many litres was that?" },
  4: { eyebrow: "Gen hours", title: "How many hours did that fuel run the gen?" },
};

export function GenSteps({
  g,
  setG,
  sizeOnly = false,
  onBack,
  onNext,
}: {
  g: GenDraft;
  setG: Dispatch<SetStateAction<GenDraft>>;
  /** Editing just the size from the report: one step, then save. */
  sizeOnly?: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = (p: Partial<GenDraft>) => setG((s) => ({ ...s, ...p }));
  const t = TITLES[g.step];
  const blocked = stepError(g, g.step) !== null;
  const usePrefill = () => {
    const p = g.prefill!;
    setG((s) => ({
      ...s,
      prefillUsed: true,
      entryId: p.id,
      amount: commas(p.amount),
      litres: p.litres ? String(p.litres) : "",
      date: p.date,
      step: p.litres ? 4 : 3,
    }));
  };

  return (
    <>
      <div className="flex flex-col pb-[130px]">
        <header className="flex h-16 items-center justify-between">
          <button type="button" onClick={onBack} className="h-11 pr-3 text-base font-semibold">
            ‹ Back
          </button>
          {sizeOnly ? <Logo /> : <span className="font-mono text-[13px] text-muted">{g.step} of {STEPS}</span>}
        </header>
        {!sizeOnly && (
          <div
            role="progressbar"
            aria-label="Generator questions"
            aria-valuemin={1}
            aria-valuemax={STEPS}
            aria-valuenow={g.step}
            className="grid grid-cols-4 gap-1"
          >
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className={`h-1.5 rounded-full ${i < g.step ? "bg-fuel" : "bg-line"}`} />
            ))}
          </div>
        )}

        <Eyebrow className="mt-7">{t.eyebrow}</Eyebrow>
        <h1 className="mt-2.5 text-[34px] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">{t.title}</h1>
        {t.help && <p className="mt-2.5 text-base leading-[1.45] text-pretty text-muted">{t.help}</p>}

        <div className="mt-6 flex flex-col gap-4">
          {g.step === 1 && <SizeStep g={g} set={set} />}
          {g.step === 2 && <PurchaseStep g={g} set={set} onUsePrefill={usePrefill} />}
          {g.step === 3 && <LitresStep g={g} set={set} />}
          {g.step === 4 && <HoursStep g={g} set={set} />}
        </div>
      </div>

      {!(g.step === 2 && g.prefill && g.prefillUsed === null) && (
        <div className="bar-fade pb-safe-bar fixed inset-x-0 bottom-0 z-20 px-5 pt-7">
          <div className="mx-auto max-w-[440px]">
            <button
              type="button"
              onClick={onNext}
              disabled={blocked}
              className="h-14 w-full rounded-2xl bg-ink text-base font-bold text-card transition-opacity duration-200 active:scale-[.98] disabled:opacity-40"
            >
              {sizeOnly ? "Save gen size" : g.step === STEPS ? "See my gen cost →" : "Next →"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[18px] border border-line bg-card p-4">
      <Eyebrow>{label}</Eyebrow>
      <span className="text-[26px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">{value}</span>
      {sub && <span className="font-mono text-xs text-muted">{sub}</span>}
    </div>
  );
}

/** The gen numbers: used as the onboarding reveal and as the "Your gen" view afterwards. */
export function GenReport({
  gen,
  summary: s,
  meterTariff,
  calibratedPerKwh = null,
  insight,
  header,
  onUpdateSize,
  children,
}: {
  gen: GeneratorProfile;
  summary: GenSummary;
  meterTariff: number | null;
  /** Real ₦/kWh once fuel use is matched to device load; replaces the rough range. */
  calibratedPerKwh?: number | null;
  insight?: ReactNode;
  header: ReactNode;
  onUpdateSize: () => void;
  children?: ReactNode;
}) {
  const basis = `Based on ${s.count === 1 ? "one fuel purchase" : `${s.count} fuel purchases`}${s.rough ? " (rough)" : ""}`;
  return (
    <div className="flex flex-1 flex-col pb-7">
      {header}
      <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-muted">
          {sizeLabel(gen)} · {gen.fuelType === "diesel" ? "Diesel" : "Petrol"}
        </span>
        <button
          type="button"
          onClick={onUpdateSize}
          className={`text-[13px] font-semibold underline underline-offset-[3px] ${gen.sizeSource === "not_sure" ? "text-light" : "text-muted"}`}
        >
          Update gen size
        </button>
      </div>
      <h1 className="mt-3 text-[38px] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
        {s.nairaPerHour != null ? (
          <>
            Your gen costs about <span className="text-fuel-ink">{naira10(s.nairaPerHour)} an hour</span>
          </>
        ) : (
          "Add gen hours to a fuel log to see your hourly cost"
        )}
      </h1>
      <span className="mt-3 font-mono text-xs text-muted">{basis}</span>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat label="Per hour of gen" value={s.nairaPerHour != null ? naira10(s.nairaPerHour) : "—"} />
        <Stat label="Litres per hour" value={s.litresPerHour != null ? `${fmt1(s.litresPerHour)} L` : "—"} />
      </div>

      <div className="mt-3 flex flex-col gap-1.5 rounded-[20px] bg-ink p-[22px] text-card">
        <Eyebrow className="text-ink-muted">{calibratedPerKwh != null ? "Per unit (kWh) · matched to your devices" : "Per unit (kWh)"}</Eyebrow>
        <span className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.035em] tabular-nums">
          {calibratedPerKwh != null ? `~${naira10(calibratedPerKwh)}` : `${naira10(s.perKwhLow)}–${naira10(s.perKwhHigh)}`}
          <span className="text-lg font-semibold text-ink-muted"> per unit</span>
        </span>
        {meterTariff != null && (
          <span className="mt-1 font-mono text-[13px] text-ink-muted">
            vs <span className="font-semibold text-light-chip">{naira10(meterTariff)} per unit</span> from your meter
          </span>
        )}
      </div>

      {insight && <div className="mt-3">{insight}</div>}

      <div className="mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-line bg-card px-4 py-3.5">
        <span className="text-[15px] font-semibold">Price per litre you paid</span>
        <span className="text-xl font-extrabold tracking-[-0.02em] tabular-nums">{naira10(s.pricePerLitre)}</span>
      </div>

      {s.monthly ? (
        <div className="mt-3 flex flex-col gap-1.5 rounded-[18px] border border-line bg-card p-4">
          <Eyebrow>Monthly cost</Eyebrow>
          <span className="text-[30px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">
            ~{naira100(s.monthly.spend)}
            <span className="text-base font-semibold text-muted"> a month</span>
          </span>
          <span className="font-mono text-xs text-muted">
            {s.monthly.hours != null ? `~${Math.round(s.monthly.hours)} gen hours · ` : ""}
            fuel every ~{fmt1(s.monthly.intervalDays)} days
          </span>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1 rounded-[18px] border-[1.5px] border-dashed border-line-strong px-4 py-4">
          <Eyebrow>Monthly cost · locked</Eyebrow>
          <span className="text-[15px] leading-[1.45] text-pretty text-muted">
            {s.count >= 2
              ? "Log a purchase on a different day to see your monthly cost."
              : "Log your next fuel purchase to see your monthly cost."}
          </span>
        </div>
      )}

      {s.capped && (
        <div className="mt-3">
          <Note tone="warn">
            Your numbers suggest the gen ran harder than its size allows. Hours may be higher than entered.
          </Note>
        </div>
      )}

      <div className="min-h-8 flex-1" />
      {children}
    </div>
  );
}
