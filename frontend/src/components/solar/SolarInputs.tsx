"use client";

import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { trio } from "@calgy/engine/appliances";
import { commas, fU, num } from "@calgy/engine/format";
import { money, PANEL_W, runWatts, tagOf, type BatteryType, type PartKey, type Scope } from "@calgy/engine/solar";
import { Chip } from "../ui";
import { QtyBadge } from "../appliances/MyHome";
import type { SolarCtx } from "./SolarApp";

// ——— Shared bits ———

export function Section({
  eyebrow,
  title,
  sectionRef,
  children,
}: {
  eyebrow: string;
  title: string;
  sectionRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section ref={sectionRef} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs tracking-[0.08em] text-muted uppercase">{eyebrow}</span>
        <h2 className="text-2xl leading-[1.1] font-extrabold tracking-[-0.03em]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export const cardClass = "flex flex-col rounded-[22px] border border-line bg-card p-[18px]";
const fieldBox = "flex items-center gap-1 rounded-xl border-[1.5px] border-line bg-paper px-3";
const monoLabel = "font-mono text-[11px] tracking-[0.06em] text-muted uppercase";

/** Two-way control with the selected side in ink (scope, cost mode). */
export function ScopeSwitch({ scope, onChange, tall = true }: { scope: Scope; onChange: (s: Scope) => void; tall?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-track p-1">
      {(
        [
          ["ess", "Essentials only"],
          ["whole", "Whole home"],
        ] as const
      ).map(([k, l]) => (
        <button
          key={k}
          type="button"
          aria-pressed={scope === k}
          onClick={() => onChange(k)}
          className={`rounded-[10px] text-sm font-bold ${tall ? "min-h-12" : "min-h-11"} ${scope === k ? "bg-ink text-card" : "text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Lithium / Tubular, selected side on card (paper). */
export function BatterySwitch({
  battery,
  onChange,
  withLife = false,
  className = "rounded-xl",
}: {
  battery: BatteryType;
  onChange: (b: BatteryType) => void;
  withLife?: boolean;
  className?: string;
}) {
  const opts = [
    ["lithium", "Lithium", "lasts ~8 yrs"],
    ["tubular", "Tubular", "cheaper · ~3 yrs"],
  ] as const;
  return (
    <div className={`grid grid-cols-2 gap-1 bg-track p-1 ${className}`}>
      {opts.map(([k, l, sub]) => (
        <button
          key={k}
          type="button"
          aria-pressed={battery === k}
          onClick={() => onChange(k)}
          className={`flex min-h-11 flex-col items-center justify-center gap-px rounded-[9px] text-sm font-bold ${
            battery === k ? "bg-card" : ""
          }`}
        >
          {l}
          {withLife && <span className="font-mono text-[10px] font-normal whitespace-nowrap text-muted">{sub}</span>}
        </button>
      ))}
    </div>
  );
}

function NairaField({
  label,
  value,
  onChange,
  marker,
  suffix,
  placeholder = "0",
  extra,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  marker?: string;
  suffix?: string;
  placeholder?: string;
  extra?: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {marker && <span className={`h-2.5 w-2.5 rounded-[3px] ${marker}`} />}
        {label}
        {extra}
      </span>
      <span className={`h-[52px] ${fieldBox}`}>
        <span className="text-[17px] font-semibold text-muted">₦</span>
        <input
          inputMode="numeric"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(commas(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-lg font-bold outline-none"
        />
        {suffix && <span className="font-mono text-xs text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

// ——— 01 · Now ———

export function NowSection({ ctx }: { ctx: SolarCtx }) {
  const { form, set, src, m } = ctx;
  const editedOver = form.edited && src.kind !== "none";
  const dot = editedOver ? "bg-fuel" : src.kind === "none" ? "bg-line-strong" : "bg-light";

  return (
    <Section eyebrow="01 · Now" title="Your current cost" sectionRef={ctx.spendRef}>
      <div className={`${cardClass} gap-3.5`}>
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2.5">
          <span className="inline-flex items-center gap-2 font-mono text-xs text-body-2">
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            {editedOver ? "Edited by you" : src.label}
          </span>
          {editedOver && (
            <button
              type="button"
              onClick={() => set({ fuelM: src.fuel ? commas(src.fuel) : "", tokenM: src.token ? commas(src.token) : "", edited: false })}
              className="h-9 rounded-[10px] border-[1.5px] border-line-strong px-3 text-[13px] font-semibold"
            >
              {src.kind === "logs" ? "Use my logs" : "Reset"}
            </button>
          )}
        </div>

        {src.kind === "none" && !m.curBase && (
          <div className="rounded-[14px] bg-fuel-soft px-3.5 py-3 text-sm leading-[1.45]">
            No spend logged yet. Type what you spend in a typical month, or{" "}
            <Link href="/app" className="font-bold text-fuel-ink">
              log it in Spend
            </Link>
            .
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <NairaField label="Generator fuel" marker="bg-fuel" value={form.fuelM} onChange={(v) => set({ fuelM: v, edited: true })} />
          <NairaField label="Prepaid tokens" marker="bg-light" value={form.tokenM} onChange={(v) => set({ tokenM: v, edited: true })} />
        </div>
        <NairaField
          label={<span className="flex-1">Generator servicing, oil, repairs</span>}
          extra={<span className="font-mono text-[11px] font-normal text-muted">OPTIONAL</span>}
          placeholder="e.g. 5,000"
          suffix="/ month"
          value={form.genUpM}
          onChange={(v) => set({ genUpM: v })}
        />

        <div className="flex items-baseline justify-between gap-3 border-t border-track pt-3">
          <span className="text-[15px] font-semibold whitespace-nowrap">On energy now</span>
          <span className="text-[22px] font-extrabold tracking-[-0.03em] tabular-nums">
            ₦{Math.round(m.curBase).toLocaleString("en-NG")}{" "}
            <span className="font-mono text-xs font-normal text-muted">/ month</span>
          </span>
        </div>
      </div>
    </Section>
  );
}

// ——— 02 · Load ———

export function LoadSection({ ctx }: { ctx: SolarCtx }) {
  const { form, set, m, devices, devSource, mode } = ctx;
  const whole = form.scope === "whole";
  const essN = devices.filter((d) => tagOf(form.tags, d) === "ess").length;
  const rows = [...devices].sort((a, b) => trio(b, null).typ - trio(a, null).typ);

  return (
    <Section eyebrow="02 · Load" title="What should solar power?">
      <div className={`${cardClass} gap-3.5`}>
        <ScopeSwitch scope={form.scope} onChange={(scope) => set({ scope })} />

        {devices.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Units a day" value={m.hasSizing ? fU(m.day.typ) : "0"} sub={m.hasSizing ? `${fU(m.day.lo)}–${fU(m.day.hi)} kWh` : "kWh"} />
              <Stat
                label="Peak load"
                value={m.hasSizing ? `~${(Math.round(m.peak / 10) * 10).toLocaleString("en-NG")}W` : "—"}
                sub={whole && m.heavyCount ? "biggest heavy device on" : "everything on at once"}
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-baseline justify-between gap-2.5 border-b-[1.5px] border-ink pb-1.5">
                <span className="font-mono text-xs tracking-[0.08em] text-muted uppercase">From My Home</span>
                <span className="font-mono text-xs text-muted">
                  {whole ? `All ${devices.length} on solar` : `${essN} essential · ${devices.length - essN} heavy`}
                </span>
              </div>
              {rows.map((d) => {
                const t = tagOf(form.tags, d);
                const dim = whole || t === "ess" ? "" : "opacity-45";
                const qty = d.quantity;
                return (
                  <div
                    key={d.id}
                    className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-track px-0.5 py-2"
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-[11px] bg-track-2 text-xl ${dim}`}>{d.icon}</span>
                    <span className={`flex min-w-0 flex-col gap-[3px] ${dim}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[15px] font-semibold">{d.name}</span>
                        {qty > 1 && <QtyBadge qty={qty} />}
                      </span>
                      <span className="font-mono text-xs text-muted">
                        {fU(trio(d, null).typ)} units/day · {Math.round(runWatts(d)).toLocaleString("en-NG")}W
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => set({ tags: { ...form.tags, [d.id]: t === "ess" ? "heavy" : "ess" } })}
                      aria-label={t === "ess" ? `${d.name}: Essential. Tap to mark Heavy` : `${d.name}: Heavy. Tap to mark Essential`}
                      className="flex h-11 items-center px-1"
                    >
                      <span
                        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold whitespace-nowrap ${
                          t === "ess" ? "bg-light-soft text-light" : "bg-fuel-soft text-fuel-ink"
                        }`}
                      >
                        {t === "ess" ? "Essential" : "Heavy"} <span className="text-[11px] opacity-70">⇄</span>
                      </span>
                    </button>
                  </div>
                );
              })}
              <span className="pt-2.5 text-[13px] leading-[1.45] text-pretty text-muted">
                {whole
                  ? "Whole home: solar runs everything, heavy devices included. Tap a tag to change it."
                  : "Essentials only: heavy devices stay on light or generator. Tap a tag to change it."}
              </span>
            </div>
            {devSource === "sample" && mode === "saved" && (
              <span className="font-mono text-xs text-fuel-ink">Using a typical Lagos flat. Your My Home is unchanged.</span>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line-strong px-[18px] py-[22px] text-center">
            <span className="text-lg font-extrabold">No devices yet</span>
            <span className="max-w-[300px] text-sm leading-normal text-pretty text-muted">
              Calgy sizes the system from the devices in My Home.
            </span>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Link
                href="/app/home"
                className="inline-flex h-12 items-center rounded-[14px] bg-ink px-4 text-[15px] font-bold text-card no-underline"
              >
                Add devices
              </Link>
              <button
                type="button"
                onClick={ctx.applyLagos}
                className="h-12 rounded-[14px] border-[1.5px] border-line-strong px-4 text-[15px] font-bold"
              >
                Use a typical Lagos flat
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] bg-paper p-3.5">
      <span className={monoLabel}>{label}</span>
      <span className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.04em]">{value}</span>
      <span className="font-mono text-xs text-muted">{sub}</span>
    </div>
  );
}

// ——— 03 · System ———

export function SystemSection({ ctx }: { ctx: SolarCtx }) {
  const { form, set, m, sysCopy: c, devices, showHow, setShowHow } = ctx;
  const row = "grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3";
  const value = "text-2xl font-extrabold tracking-[-0.03em]";
  const label = (k: string, sub: string) => (
    <span className="flex min-w-0 flex-col gap-[3px]">
      <span className={monoLabel}>{k}</span>
      <span className="text-[13px] leading-[1.4] text-body-2">{sub}</span>
    </span>
  );

  return (
    <Section eyebrow="03 · System" title="Recommended system">
      {m.hasSizing ? (
        <div className={`${cardClass} pt-1.5`}>
          <div className={`${row} border-b border-track`}>
            {label("Inverter", c.invSub)}
            <span className={`${value} whitespace-nowrap`}>{c.invLabel}</span>
          </div>
          <div className="flex flex-col gap-2.5 border-b border-track py-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              {label("Battery", c.batSub)}
              <span className={`${value} text-right`}>{c.batLabel}</span>
            </div>
            <BatterySwitch battery={form.battery} onChange={(battery) => set({ battery })} withLife />
          </div>
          <div className={row}>
            {label("Panels", c.panSub)}
            <span className={`${value} whitespace-nowrap`}>{c.panLabel}</span>
          </div>
          <div className="rounded-[14px] bg-fuel-soft px-3.5 py-3 text-sm leading-[1.45] text-pretty">
            Output drops in rainy season, roughly 30% less from June to September. The savings below already allow for it.
          </div>
          <button
            type="button"
            aria-expanded={showHow}
            onClick={() => setShowHow(!showHow)}
            className="mt-1.5 flex h-12 w-full items-center justify-between text-[15px] font-semibold"
          >
            <span className="whitespace-nowrap">How we sized this</span>
            <span className={`text-sm text-muted transition-transform duration-200 ${showHow ? "rotate-180" : ""}`}>▾</span>
          </button>
          {showHow && (
            <div className="flex flex-col gap-2 rounded-[14px] bg-paper px-3.5 py-3">
              {c.how.map((h) => (
                <div key={h.k} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2.5 text-[13px] leading-[1.45]">
                  <span className={`${monoLabel} pt-0.5`}>{h.k}</span>
                  <span className="text-ink-line">{h.v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[22px] border-[1.5px] border-dashed border-line-strong px-[18px] py-[22px] text-center text-[15px] leading-normal text-muted">
          {!devices.length
            ? "Add devices above and Calgy will size the inverter, battery and panels."
            : "Tag at least one device as Essential, or switch to Whole home."}
        </div>
      )}
    </Section>
  );
}

// ——— 04 · Price ———

const PART_ROWS: { k: PartKey; label: string }[] = [
  { k: "inverter", label: "Inverter" },
  { k: "battery", label: "Batteries" },
  { k: "panels", label: "Panels" },
  { k: "install", label: "Install & extras" },
];

export function CostSection({ ctx }: { ctx: SolarCtx }) {
  const { form, set, m, sysCopy: c } = ctx;
  const mode = form.costMode;
  const plan = { deposit: num(form.plan.deposit), monthly: num(form.plan.monthly), months: Math.round(num(form.plan.months)) };
  const est: Record<PartKey, number> = { ...m.est, install: m.installEst };
  const subs: Record<PartKey, string> = {
    inverter: `${m.sys.kva} kVA hybrid`,
    battery: c.batLabel,
    panels: `${m.sys.panels} × ${PANEL_W}W`,
    install: "Mounting, cables, labour",
  };

  return (
    <Section eyebrow="04 · Price" title="System cost" sectionRef={ctx.costRef}>
      <div className={`${cardClass} gap-3.5`}>
        <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-track p-1">
          {(
            [
              ["quote", "Installer quote"],
              ["parts", "By part"],
              ["plan", "Monthly plan"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={mode === k}
              onClick={() => set({ costMode: k })}
              className={`min-h-12 rounded-[10px] px-1 text-sm leading-[1.15] font-bold ${mode === k ? "bg-ink text-card" : "text-ink"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {mode === "quote" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Installer&apos;s total quote</span>
            <span className="flex h-[60px] items-center gap-1.5 rounded-[14px] border-[1.5px] border-line bg-paper px-3.5">
              <span className="text-[22px] font-semibold text-muted">₦</span>
              <input
                inputMode="numeric"
                placeholder="0"
                value={form.quote}
                onChange={(e) => set({ quote: commas(e.target.value) })}
                className="min-w-0 flex-1 bg-transparent text-2xl font-extrabold outline-none"
              />
            </span>
            <span className="text-[13px] leading-[1.45] text-muted">
              {m.hasSizing
                ? `For the system above, Calgy would expect roughly ${money(m.estTotal * 0.9)}–${money(m.estTotal * 1.15)}.`
                : "The full installed price: inverter, batteries, panels, labour."}
            </span>
          </label>
        )}

        {mode === "parts" && (
          <div className="flex flex-col">
            {PART_ROWS.map(({ k, label }) => {
              const own = form.parts[k] != null;
              return (
                <div
                  key={k}
                  className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_minmax(0,140px)] items-center gap-3 border-b border-track py-2.5"
                >
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <span className="text-[15px] font-semibold">{label}</span>
                    <span className="font-mono text-xs text-muted">{subs[k]}</span>
                    {own ? (
                      <button
                        type="button"
                        onClick={() => {
                          const p = { ...form.parts };
                          delete p[k];
                          set({ parts: p });
                        }}
                        className="h-7 self-start font-mono text-[11px] tracking-[0.04em] text-light uppercase"
                      >
                        Your price · use estimate
                      </button>
                    ) : (
                      <span className="font-mono text-[10px] tracking-[0.06em] text-fuel-ink uppercase">Calgy estimate</span>
                    )}
                  </span>
                  <span className={`h-12 min-w-0 px-2.5 ${fieldBox}`}>
                    <span className="text-[15px] text-muted">₦</span>
                    <input
                      inputMode="numeric"
                      aria-label={`${label} price`}
                      value={own ? form.parts[k] : commas(est[k])}
                      onChange={(e) => set({ parts: { ...form.parts, [k]: commas(e.target.value) } })}
                      className="min-w-0 flex-1 bg-transparent text-right text-base font-bold outline-none"
                    />
                  </span>
                </div>
              );
            })}
            <div className="flex items-baseline justify-between gap-3 pt-3">
              <span className="text-[15px] font-semibold">Total</span>
              <span className="flex flex-col items-end gap-0.5">
                <span className="text-[22px] font-extrabold tracking-[-0.03em]">~{money(m.partsTotal)}</span>
                <span className="font-mono text-xs text-muted">
                  {money(m.partsTotal * 0.9)} – {money(m.partsTotal * 1.15)} by brand
                </span>
              </span>
            </div>
            <span className="pt-2 text-[13px] leading-[1.45] text-pretty text-muted">
              Estimates use typical Lagos prices from Oct 2026. Replace them with real quotes when you have them.
            </span>
          </div>
        )}

        {mode === "plan" && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <NairaField label="Deposit" value={form.plan.deposit} onChange={(v) => set({ plan: { ...form.plan, deposit: v } })} />
              <NairaField label="Each month" value={form.plan.monthly} onChange={(v) => set({ plan: { ...form.plan, monthly: v } })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">For how long</span>
              <div className="flex flex-wrap gap-1.5">
                {[12, 18, 24, 36].map((v) => (
                  <Chip
                    key={v}
                    on={plan.months === v}
                    onClick={() => set({ plan: { ...form.plan, months: String(v) } })}
                    className="h-11 px-4 text-[13px] font-normal"
                  >
                    {v} mo
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-[3px] border-t border-track pt-3">
              <span className="text-[15px] font-bold">
                {plan.monthly && plan.months
                  ? `${money(plan.deposit + plan.monthly * plan.months)} paid in total over ${plan.months} months`
                  : "Enter the deposit and monthly payment"}
              </span>
              {!!(plan.monthly && plan.months && m.hasSizing) && (
                <span className="font-mono text-xs text-muted">vs ~{money(m.estTotal)} buying outright (Calgy estimate)</span>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
