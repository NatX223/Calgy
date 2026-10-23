"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { lagosFlat, type Device } from "@/lib/appliances";
import { loadHome, loadSolar, loadSpend, saveSolar } from "@/lib/db";
import { commas, digits, num } from "@/lib/format";
import {
  breakEvenCopy, computeSolar, normaliseSolar, readSpendSource, sampleHousehold, SAMPLE_SOURCE, systemCopy,
  type BatteryType, type CostMode, type PartKey, type Scope, type SolarSettings, type SpendSource, type Tag,
} from "@/lib/solar";
import { Logo } from "../ui";
import { CostSection, LoadSection, NowSection, SystemSection } from "./SolarInputs";
import { ResultSection, WhatIfSection } from "./SolarResult";

/** Text-input state for the form; numbers are parsed on each render and on save. */
export type SolarForm = {
  tags: Record<string, Tag>;
  scope: Scope;
  battery: BatteryType;
  costMode: CostMode;
  quote: string;
  parts: Partial<Record<PartKey, string>>;
  plan: { deposit: string; monthly: string; months: string };
  genPrice: string;
  genLife: string;
  solarUp: string;
  batLife: { lithium: string; tubular: string };
  edited: boolean; // spend fields overridden by the user
  fuelM: string;
  tokenM: string;
  genUpM: string;
};

const money = (n: number | null | undefined) => (n ? commas(n) : "");

function toForm(s: SolarSettings, src: SpendSource): SolarForm {
  const o = s.spendOverride;
  const a = s.assumptions;
  return {
    tags: s.tags, scope: s.scope, battery: s.battery, costMode: s.costMode,
    quote: money(s.quote),
    parts: Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, commas(v)])),
    plan: { deposit: money(s.plan.deposit), monthly: money(s.plan.monthly), months: String(s.plan.months) },
    genPrice: commas(a.genPrice), genLife: String(a.genLifeYears), solarUp: commas(a.solarUpkeep),
    batLife: { lithium: String(a.batteryLife.lithium), tubular: String(a.batteryLife.tubular) },
    edited: !!o,
    fuelM: money(o ? o.fuel : src.fuel),
    tokenM: money(o ? o.token : src.token),
    genUpM: money(s.genServicing),
  };
}

const n = (s: string | undefined) => num(digits(s));
const toSettings = (f: SolarForm): SolarSettings => ({
  tags: f.tags, scope: f.scope, battery: f.battery, costMode: f.costMode,
  quote: n(f.quote) || null,
  parts: Object.fromEntries(Object.entries(f.parts).map(([k, v]) => [k, n(v)])),
  plan: { deposit: n(f.plan.deposit) || null, monthly: n(f.plan.monthly) || null, months: Math.round(num(f.plan.months)) || 24 },
  assumptions: {
    genPrice: n(f.genPrice), genLifeYears: num(f.genLife), solarUpkeep: n(f.solarUp),
    batteryLife: { lithium: num(f.batLife.lithium), tubular: num(f.batLife.tubular) },
  },
  spendOverride: f.edited ? { fuel: n(f.fuelM), token: n(f.tokenM) } : null,
  genServicing: n(f.genUpM) || null,
});

type Data = { devices: Device[]; src: SpendSource; solar: SolarSettings };

/** Solar Compare: "If I go solar, when do I start winning?" */
export function SolarApp() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadSpend(), loadHome(), loadSolar()]).then(([spend, home, solar]) => {
      if (live) setData({ devices: home.devices, src: readSpendSource(spend.entries, spend.settings), solar });
    });
    return () => {
      live = false;
    };
  }, []);

  if (!data) return <div className="min-h-screen bg-paper" />;
  return <SolarView initial={data} />;
}

export type SolarCtx = ReturnType<typeof useSolar>;

function useSolar(initial: Data) {
  const router = useRouter();
  // "saved" = the household's own data (persisted); "sample" = in-memory demo household.
  const [mode, setMode] = useState<"saved" | "sample">("saved");
  const [devices, setDevices] = useState(initial.devices);
  const [devSource, setDevSource] = useState<"home" | "sample" | "none">(initial.devices.length ? "home" : "none");
  const [src, setSrc] = useState(initial.src);
  const [form, setForm] = useState(() => toForm(initial.solar, initial.src));
  const [fuelPct, setFuelPct] = useState(0);
  const [manual, setManual] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showAssume, setShowAssume] = useState(false);

  const spendRef = useRef<HTMLElement>(null);
  const costRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mode === "saved") saveSolar(toSettings(form));
  }, [form, mode]);

  const set = (p: Partial<SolarForm>) => setForm((f) => ({ ...f, ...p }));
  const scrollTo = (ref: RefObject<HTMLElement | null>) => {
    const el = ref.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: "smooth" });
  };

  const bt = form.battery;
  const m = computeSolar({
    devices, tags: form.tags, scope: form.scope, battery: bt, costMode: form.costMode,
    fuel: n(form.fuelM), token: n(form.tokenM), genServicing: n(form.genUpM), fuelPct,
    quote: n(form.quote),
    parts: Object.fromEntries(Object.entries(form.parts).map(([k, v]) => [k, n(v)])),
    plan: { deposit: n(form.plan.deposit), monthly: n(form.plan.monthly), months: Math.round(num(form.plan.months)) },
    genPrice: n(form.genPrice), genLifeYears: num(form.genLife), solarUpkeep: n(form.solarUp),
    batteryLifeYears: num(form.batLife[bt]),
  });
  const sysCopy = systemCopy(m, bt);
  const be = m.results ? breakEvenCopy(m.results) : null;

  const applyLagos = () => {
    setDevices(lagosFlat());
    setDevSource("sample");
  };

  // Next missing input, checked in order. Replaces the result until everything is in.
  let need: { t: string; b: string; p: string; pf: () => void; s?: string; sf?: () => void } | null = null;
  if (!m.ready) {
    if (!devices.length)
      need = {
        t: "Add your devices to size a system",
        b: "Solar has to be sized to what you run. Add devices in My Home, or start with a typical Lagos flat.",
        p: "Use a typical Lagos flat", pf: applyLagos,
        s: "Go to My Home", sf: () => router.push("/app/home"),
      };
    else if (!m.hasSizing)
      need = {
        t: "Nothing tagged Essential", b: "Tag at least one device as Essential, or switch to Whole home.",
        p: "Switch to Whole home", pf: () => set({ scope: "whole" }),
      };
    else if (!m.hasSpend)
      need = {
        t: "Sizing done. Now add what you spend.", b: "Break-even depends on the fuel and tokens solar would replace.",
        p: "Enter your spend ↑", pf: () => scrollTo(spendRef),
      };
    else if (form.costMode === "quote")
      need = {
        t: "Sizing done. Add a system cost.", b: "Type your installer’s quote, or use Calgy’s estimate for now.",
        p: "Use Calgy’s estimate", pf: () => set({ costMode: "parts" }),
        s: "Enter quote ↑", sf: () => scrollTo(costRef),
      };
    else
      need = {
        t: "Sizing done. Add a system cost.", b: "Enter the deposit and monthly payment from the plan.",
        p: "Enter plan ↑", pf: () => scrollTo(costRef),
      };
  }

  const noData = src.kind === "none" && !devices.length && !manual && !m.curBase;

  return {
    mode, form, set, m, sysCopy, be, need, src, devices, devSource, noData,
    fuelPct, setFuelPct, showHow, setShowHow, showAssume, setShowAssume,
    spendRef, costRef, resultsRef, scrollTo, applyLagos,
    startManual: () => setManual(true),
    trySample: () => {
      setMode("sample");
      setDevices(sampleHousehold());
      setDevSource("sample");
      setSrc(SAMPLE_SOURCE);
      setForm({ ...toForm(normaliseSolar(null), SAMPLE_SOURCE), genUpM: "6,000" });
      setFuelPct(0);
    },
  };
}

function SolarView({ initial }: { initial: Data }) {
  const ctx = useSolar(initial);
  const { noData, be, need, m } = ctx;

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="mx-auto max-w-[600px] px-5 wide:max-w-[1080px]">
        <header className="flex h-[68px] items-center justify-between gap-3">
          <Logo />
          <nav className="flex gap-0.5 rounded-[13px] bg-track p-[3px]">
            <Link href="/app" className="inline-flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold text-ink no-underline">
              Spend
            </Link>
            <Link href="/app/home" className="inline-flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold text-ink no-underline">
              Appliances
            </Link>
            <span
              aria-current="page"
              className="inline-flex h-10 items-center rounded-[10px] bg-card px-3 text-sm font-semibold shadow-[0_1px_2px_rgba(25,23,18,0.12)]"
            >
              Solar
            </span>
          </nav>
        </header>

        <div className="flex flex-col pt-3 pb-[120px] wide:pb-14">
          <h1 className="text-4xl leading-none font-extrabold tracking-[-0.04em]">Go solar?</h1>
          <p className="mt-2 max-w-[520px] text-[15px] leading-[1.45] text-pretty text-muted">
            See when solar would start paying you back, based on what you spend and the devices you run. You can change
            every number.
          </p>

          {noData ? (
            <NoData onManual={ctx.startManual} onSample={ctx.trySample} />
          ) : (
            <div className="mt-6 flex flex-col gap-7 wide:grid wide:grid-cols-[minmax(0,1fr)_420px] wide:items-start">
              <div className="contents wide:flex wide:min-w-0 wide:flex-col wide:gap-7">
                <NowSection ctx={ctx} />
                <LoadSection ctx={ctx} />
                <SystemSection ctx={ctx} />
                <CostSection ctx={ctx} />
              </div>
              <div className="contents wide:flex wide:min-w-0 wide:flex-col wide:gap-7">
                <ResultSection ctx={ctx} />
                <WhatIfSection ctx={ctx} />
              </div>
            </div>
          )}
        </div>
      </div>

      {!noData && (
        <div className="bar-fade pb-safe-bar pointer-events-none fixed inset-x-0 bottom-0 z-20 px-5 pt-[22px] wide:hidden">
          <div className="pointer-events-auto mx-auto grid min-h-16 max-w-[560px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] bg-ink py-2 pr-2 pl-[18px] text-card shadow-[0_10px_24px_-12px_rgba(25,23,18,0.5)]">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[11px] tracking-[0.08em] text-ink-muted uppercase">
                {m.results ? "Break-even" : "Result"}
              </span>
              <span className="truncate text-lg font-extrabold tracking-[-0.02em]">
                {be ? be.bar : need ? need.t.replace(/^Sizing done\. /, "") : ""}
              </span>
            </span>
            <button
              type="button"
              onClick={() => ctx.scrollTo(ctx.resultsRef)}
              className="h-12 rounded-xl bg-fuel px-4 text-[15px] font-bold whitespace-nowrap text-ink"
            >
              See result ↓
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoData({ onManual, onSample }: { onManual: () => void; onSample: () => void }) {
  const steps = [
    { n: 1, href: "/app", t: "Log your fuel and tokens", s: "Or type a monthly estimate here" },
    { n: 2, href: "/app/home", t: "Add your devices in My Home", s: "Fans, fridge, TV, AC: whatever you run" },
  ];
  return (
    <div className="mt-[22px] flex flex-col gap-4 rounded-[22px] border-[1.5px] border-dashed border-line-strong px-[22px] py-7">
      <span className="text-[22px] font-extrabold tracking-[-0.02em]">Two things first</span>
      <span className="text-[15px] leading-normal text-pretty text-muted">
        Calgy needs to know what you spend now and what solar would have to power.
      </span>
      <div className="flex flex-col">
        {steps.map((s) => (
          <Link
            key={s.n}
            href={s.href}
            className="grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line px-0.5 py-2.5 text-ink no-underline"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink font-mono text-sm text-card">{s.n}</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-bold">{s.t}</span>
              <span className="text-[13px] text-muted">{s.s}</span>
            </span>
            <span className="text-lg" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={onManual} className="h-[52px] rounded-[14px] bg-ink px-[18px] text-[15px] font-bold text-card">
          Enter estimates here
        </button>
        <button
          type="button"
          onClick={onSample}
          className="h-[52px] rounded-[14px] border-[1.5px] border-line-strong px-[18px] text-[15px] font-bold"
        >
          Try a sample household
        </button>
      </div>
    </div>
  );
}
