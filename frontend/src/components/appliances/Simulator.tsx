"use client";

import {
  CAT_LABEL, CAT_ORDER, chargesDown, chargesUp, isModified, toDevice, usageSummary,
  type Device, type SimRow, type Tariff,
} from "@/lib/appliances";
import { genReady, predictedLph, sumSplits, type GenSpec, type Household } from "@/lib/calibration";
import { ASSUMED_HYBRID_GEN_HOURS, DEFAULT_GRID_HOURS } from "@/lib/calibration-constants";
import { LIMITS } from "@/lib/energy";
import { commas, dec, digits, fU, naira, num, rN, shortN, trimN } from "@/lib/format";
import { splitsOf, supplyNote, toTrio, type Calib } from "@/lib/home-calibration";
import { costMode, type SimMode } from "@/lib/sim-modes";
import { Chip, Eyebrow, StepButton } from "../ui";
import { TierPicker } from "./DeviceEditor";
import { costFor, QtyBadge } from "./MyHome";
import { FuelLife, GenResults, HoursWhatIf, type FuelInfo } from "./SimGenPanels";

export type SimUi = {
  period: "day" | "week" | "month" | "custom";
  customDays: string;
  sort: "cost" | "category";
  expanded: string | null;
  tokenAmt: string;
  /** Tab; null = the one matching the household. */
  mode: SimMode | null;
  /** What-if light / gen hours; null = the household's. */
  simG: number | null;
  simH: number | null;
  fuelAmt: string;
};

const TABS: [SimMode, string][] = [
  ["prepaid", "Prepaid meter"],
  ["hybrid", "Hybrid"],
  ["gen", "Generator only"],
];

const PERIODS = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["custom", "Custom"],
] as const;

const segClass = (on: boolean) => (on ? "bg-card text-ink" : "bg-transparent text-ink");

export function Simulator({
  home,
  rows,
  T,
  calib,
  fuel,
  ui,
  setUi,
  simEdit,
  removeRow,
  anyMod,
  onAdd,
  onTariff,
  onGoHome,
  onLagos,
  onReset,
  onAskSave,
}: {
  home: Device[];
  rows: SimRow[];
  T: Tariff | null;
  calib: Calib;
  /** The home's gen (or a typical one when none is set up) and its fuel price. */
  fuel: { spec: GenSpec; info: FuelInfo };
  ui: SimUi;
  setUi: (p: Partial<SimUi>) => void;
  simEdit: (key: string, fn: (r: SimRow) => Partial<SimRow>) => void;
  removeRow: (key: string) => void;
  anyMod: boolean;
  onAdd: () => void;
  onTariff: () => void;
  onGoHome: () => void;
  onLagos: () => void;
  onReset: () => void;
  onAskSave: () => void;
}) {
  const tv = T?.value ?? 0;
  const cost = costFor(T);
  const days =
    ui.period === "day" ? 1 : ui.period === "week" ? 7 : ui.period === "month" ? 30 : Math.max(1, Math.round(num(ui.customDays)) || 1);
  const perLabel = ui.period === "custom" ? `${days} day${days > 1 ? "s" : ""}` : ui.period;

  const hh = calib.household;
  const mode: SimMode = ui.mode ?? (hh === "grid" ? "prepaid" : hh);
  // Baseline hours (My Home's); the steppers change them as what-ifs, never the saved ones.
  const baseG = hh === "gen" ? DEFAULT_GRID_HOURS : calib.G;
  const hAssumed = calib.result?.gen?.genHoursPerDay == null;
  const baseH = !hAssumed && calib.H ? calib.H : mode === "gen" ? DEFAULT_GRID_HOURS : ASSUMED_HYBRID_GEN_HOURS;
  const G = ui.simG ?? baseG;
  const H = ui.simH ?? baseH;
  const homeIn = home.map((d) => ({ device: d, baseId: d.id }));
  const rowIn = rows.map((r) => ({ device: toDevice(r), baseId: r.baseId }));
  const onRows = rows.filter((r) => r.on);

  // Prepaid tab: grid-side units. A gen-only home gets a plain "what if I were on prepaid" view.
  const pc: Calib = hh === "gen" ? { ...calib, result: null, household: "grid", G: DEFAULT_GRID_HOURS } : calib;
  const g = Math.round(G * 2) / 2;
  const homeS = splitsOf(pc, homeIn);
  const rowS = splitsOf(pc, rowIn, { G, H: pc.H });
  const rowUnits = new Map(rows.map((r, i) => [r.key, toTrio(rowS[i].grid)]));
  const trio = (r: SimRow) => rowUnits.get(r.key)!;
  const homeTot = toTrio(sumSplits(homeS).grid);
  const onS = rowS.filter((_, i) => rows[i].on);
  const simTot = toTrio(sumSplits(onS).grid);

  // Gen-side what-if on the prepaid tab of a hybrid home: fuel from the burn model at the new device load.
  const ppl = fuel.info.nairaPerLitre;
  const genFuelDelta =
    hh === "hybrid" && calib.enabled && genReady(calib.result) && calib.H && ppl
      ? (predictedLph(fuel.spec, sumSplits(onS).gen.typical / calib.H) - predictedLph(fuel.spec, sumSplits(homeS).gen.typical / calib.H)) *
        calib.H *
        ppl *
        30
      : 0;

  // Hybrid and Generator-only tabs: light at the tariff, gen side in fuel.
  const modeHh: Household = mode === "gen" ? "gen" : "hybrid";
  const prices = { tariff: T?.value ?? null, nairaPerLitre: ppl };
  const genHome = costMode(splitsOf(calib, homeIn, { G: baseG, H: baseH }, modeHh), home.map(() => true), baseH, fuel.spec, prices);
  const genSim = costMode(splitsOf(calib, rowIn, { G, H }, modeHh), rows.map((r) => r.on), H, fuel.spec, prices);
  const genRow = new Map(rows.map((r, i) => [r.key, genSim.rows[i]]));
  const supply = { household: mode === "prepaid" ? pc.household : modeHh, G, H };
  /** What a row is sorted and ranked by on this tab. */
  const rowVal = (r: SimRow) => {
    if (mode === "prepaid") return trio(r).typ;
    const m = genRow.get(r.key)!;
    return m.naira?.typical ?? (mode === "gen" ? m.litres.typical : m.units.typical);
  };
  const rowAmount = (r: SimRow) => {
    if (mode === "prepaid") return T ? "~" + cost(trio(r).typ, days) : fU(trio(r).typ * days) + " u";
    const m = genRow.get(r.key)!;
    if (m.naira) return "~" + naira(rN(m.naira.typical * days, days));
    return mode === "gen" ? `${fU(m.litres.typical * days)} L` : fU(m.units.typical * days) + " u";
  };
  const dTyp = simTot.typ - homeTot.typ;
  const pct = homeTot.typ ? Math.round((dTyp / homeTot.typ) * 100) : 0;
  const sign = dTyp < 0 ? "−" : "+";
  const deltaText = T
    ? `${sign}${naira(Math.abs(rN(dTyp * days * tv, days)))} / ${perLabel} (${sign}${Math.abs(pct)}%)`
    : `${sign}${fU(Math.abs(dTyp * days))} units / ${perLabel} (${sign}${Math.abs(pct)}%)`;

  const sorted = [...rows].sort((a, b) =>
    ui.sort === "cost"
      ? Number(b.on) - Number(a.on) || rowVal(b) - rowVal(a)
      : CAT_ORDER[a.category] - CAT_ORDER[b.category] || a.name.localeCompare(b.name),
  );

  const warnCount = onRows.filter((r) => supplyNote(r, supply)).length;
  const ranked = onRows.map((r) => ({ r, v: rowVal(r) })).filter((x) => x.v > 0);
  const rankedTotal = ranked.reduce((t, x) => t + x.v, 0);
  const top = ranked.sort((a, b) => b.v - a.v).slice(0, 3);

  // Token life
  const tokA = num(digits(ui.tokenAmt));
  const unitsBought = tv ? tokA / tv : 0;
  const daysFmt = (d: number) =>
    !Number.isFinite(d)
      ? "—"
      : d < 1
        ? `~${Math.max(1, Math.round(d * 24))} hours`
        : `~${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`;
  const tokTyp = simTot.typ ? unitsBought / simTot.typ : Infinity;
  const tokBase = homeTot.typ ? unitsBought / homeTot.typ : Infinity;
  const tokDiff = Number.isFinite(tokTyp) && Number.isFinite(tokBase) ? Math.round(tokTyp) - Math.round(tokBase) : 0;
  const showTokCompare = anyMod && tokA > 0 && tokDiff !== 0 && Number.isFinite(tokTyp);

  return (
    <>
      <div className="flex flex-col pt-3 pb-[132px]">
        <h1 className="text-4xl leading-none font-extrabold tracking-[-0.04em]">Simulator</h1>
        <p className="mt-2 mb-[18px] text-[15px] leading-[1.45] text-pretty text-muted">
          Switch things off, change hours, see the cost move. My Home stays untouched until you save.
        </p>

        <div role="tablist" aria-label="How the home is powered" className="grid grid-cols-3 gap-1 rounded-[14px] bg-track p-1">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              onClick={() => setUi({ mode: k, simG: null, simH: null })}
              className={`min-h-12 rounded-[10px] text-sm ${mode === k ? "bg-ink font-bold text-card" : "font-semibold text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode !== "prepaid" && fuel.info.assumed && (
          <div className="mt-2 rounded-xl bg-fuel-soft px-3.5 py-2.5 text-sm leading-[1.4]">
            No gen set up yet, so this assumes a typical small petrol gen. Add yours in Spend for real numbers.
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <div className="flex gap-1 rounded-[14px] bg-track p-1">
            {PERIODS.map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={ui.period === k}
                onClick={() => setUi({ period: k })}
                className={`h-10 rounded-[10px] px-3.5 text-sm font-semibold ${segClass(ui.period === k)}`}
              >
                {l}
              </button>
            ))}
          </div>
          {ui.period === "custom" && (
            <label className="flex h-12 items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-card px-3">
              <input
                inputMode="numeric"
                aria-label="Number of days"
                value={ui.customDays}
                onChange={(e) => setUi({ customDays: digits(e.target.value).slice(0, 3) })}
                className="w-12 bg-transparent text-right text-[17px] font-bold outline-none"
              />
              <span className="text-sm text-muted">days</span>
            </label>
          )}
        </div>

        {rows.length > 0 && (
          <HoursWhatIf
            mode={mode}
            G={G}
            H={H}
            hAssumed={hAssumed}
            onG={(v) => setUi({ simG: v })}
            onH={(v) => setUi({ simH: v })}
            changed={ui.simG != null || ui.simH != null}
            onReset={() => setUi({ simG: null, simH: null })}
          />
        )}

        {rows.length === 0 ? (
          <div className="mt-[22px] flex flex-col items-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-line-strong px-[22px] py-8 text-center">
            <span className="text-xl font-extrabold">Nothing to simulate yet</span>
            <span className="max-w-[320px] text-[15px] leading-normal text-muted">
              Add your devices to My Home first, or start with a typical Lagos flat.
            </span>
            <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
              <button type="button" onClick={onGoHome} className="h-[50px] rounded-[14px] bg-ink px-[18px] text-[15px] font-bold text-card">
                Go to My Home
              </button>
              <button
                type="button"
                onClick={onLagos}
                className="h-[50px] rounded-[14px] border-[1.5px] border-line-strong px-[18px] text-[15px] font-bold"
              >
                Lagos flat quick-start
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-[18px] flex flex-col gap-4 wide:grid wide:grid-cols-[380px_minmax(0,1fr)] wide:items-start wide:gap-8">
            <div className="contents wide:sticky wide:top-4 wide:flex wide:flex-col wide:gap-4">
              {mode !== "prepaid" ? (
                <>
                  <GenResults
                    mode={mode}
                    sim={genSim.totals}
                    home={genHome.totals}
                    days={days}
                    perLabel={perLabel}
                    anyMod={anyMod || ui.simG != null || ui.simH != null}
                    fuel={fuel.info}
                    tariffLabel={T ? `₦${fU(tv)}/kWh · ${T.source}` : null}
                    onTariff={onTariff}
                  />
                  <FuelLife
                    amount={ui.fuelAmt}
                    setAmount={(v) => setUi({ fuelAmt: v })}
                    simPerDay={genSim.totals.litres.typical}
                    homePerDay={genHome.totals.litres.typical}
                    anyMod={anyMod || ui.simG != null || ui.simH != null}
                    nairaPerLitre={ppl}
                  />
                </>
              ) : (
                <>
              {/* Results */}
              <div className="sticky top-0 z-10 flex flex-col gap-3.5 rounded-[22px] bg-ink px-5 py-[18px] text-card shadow-[0_10px_24px_-12px_rgba(25,23,18,0.5)] wide:static">
                <Eyebrow className="text-[11px] text-ink-muted">Estimated · per {perLabel}</Eyebrow>
                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-end gap-3.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-4xl leading-none font-extrabold tracking-[-0.045em]">
                      ~{T ? cost(simTot.typ, days) : fU(simTot.typ * days)}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">
                      {T ? `${cost(simTot.lo, days)} – ${cost(simTot.hi, days)}` : "units (kWh) · set tariff for ₦"}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[22px] leading-[1.05] font-extrabold tracking-[-0.03em]">
                      {T ? `${fU(simTot.typ * days)} units` : `${fU(simTot.lo * days)}–${fU(simTot.hi * days)}`}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">
                      {T ? `${fU(simTot.lo * days)} – ${fU(simTot.hi * days)} kWh` : "range, units"}
                    </span>
                  </div>
                </div>
                {anyMod && Math.abs(dTyp) > 1e-9 && (
                  <div
                    className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-[15px] font-bold text-ink ${
                      dTyp < 0 ? "bg-light-chip" : "bg-red-soft"
                    }`}
                  >
                    <span>{deltaText}</span>
                    <span className="font-medium text-ink-line">vs My Home</span>
                  </div>
                )}
                {anyMod && Math.abs(genFuelDelta) >= 50 && (
                  <span className={`text-sm font-semibold ${genFuelDelta < 0 ? "text-light-chip" : "text-fuel"}`}>
                    {genFuelDelta < 0
                      ? `Your changes also save ~${naira(rN(-genFuelDelta, 30))}/month in gen fuel.`
                      : `Your changes also add ~${naira(rN(genFuelDelta, 30))}/month in gen fuel.`}
                  </span>
                )}
                {onRows.length === 0 && (
                  <span className="text-sm text-ink-muted">Everything&apos;s switched off — nothing drawing from the meter.</span>
                )}
                <button
                  type="button"
                  onClick={onTariff}
                  className="flex min-h-10 items-center justify-between gap-2.5 border-t border-ink-line pt-2.5 text-left text-card"
                >
                  <span className="font-mono text-xs text-ink-muted">
                    {T ? `₦${fU(tv)}/kWh · ${T.source}` : "No tariff yet — showing units only"}
                  </span>
                  <span className="text-[13px] font-bold text-fuel">{T ? "Edit" : "Set tariff"}</span>
                </button>
              </div>

              {/* Token life */}
              <div className="flex flex-col gap-3 rounded-[22px] border border-line bg-card px-5 py-[18px]">
                <span className="text-[17px] font-bold">How long will my token last?</span>
                <label className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5">
                  <span className="text-xl font-semibold text-muted">₦</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="Token amount"
                    value={ui.tokenAmt}
                    onChange={(e) => setUi({ tokenAmt: commas(e.target.value) })}
                    className="min-w-0 flex-1 bg-transparent text-xl font-bold outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[5000, 10000, 20000, 50000].map((v) => (
                    <Chip key={v} on={tokA === v} onClick={() => setUi({ tokenAmt: commas(v) })} className="h-10 px-3.5 text-[13px] font-normal">
                      {shortN(v)}
                    </Chip>
                  ))}
                </div>
                {T ? (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-[34px] font-extrabold tracking-[-0.04em] text-light">
                        {!tokA ? "—" : simTot.typ ? daysFmt(tokTyp) : "Lasts and lasts"}
                      </span>
                      <span className="font-mono text-xs text-muted">
                        {tokA && simTot.typ
                          ? `${daysFmt(unitsBought / simTot.hi).replace("~", "")} – ${daysFmt(unitsBought / simTot.lo).replace("~", "")}`
                          : ""}
                      </span>
                    </div>
                    <span className="text-sm text-body-2">
                      {tokA ? `${naira(tokA)} buys about ${fU(unitsBought)} units at your tariff.` : "Enter a token amount."}
                    </span>
                    {showTokCompare && (
                      <span className={`text-sm font-semibold ${tokDiff > 0 ? "text-light" : "text-red"}`}>
                        {tokDiff > 0
                          ? `With your changes, it lasts ${tokDiff} day${tokDiff === 1 ? "" : "s"} longer than My Home (${daysFmt(tokBase)}).`
                          : `With your changes, it runs out ${-tokDiff} day${tokDiff === -1 ? "" : "s"} sooner than My Home (${daysFmt(tokBase)}).`}
                      </span>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={onTariff} className="h-[46px] rounded-xl bg-fuel text-[15px] font-bold text-ink">
                    Set your tariff to work this out
                  </button>
                )}
              </div>
                </>
              )}

              {top.length > 0 && (
                <div className="flex flex-col gap-3 px-0.5 py-1">
                  <Eyebrow>Top consumers</Eyebrow>
                  {top.map((x, i) => {
                    const p = Math.round((x.v / rankedTotal) * 100);
                    return (
                      <div key={x.r.key} className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-2.5 text-sm">
                          <span className="font-semibold">
                            {x.r.icon} {x.r.name}
                            {x.r.quantity > 1 ? ` ×${x.r.quantity}` : ""}
                          </span>
                          <span className="font-mono text-muted">{p}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-[3px] bg-track">
                          <div
                            className={`h-full transition-[width] duration-300 ${i === 0 ? "bg-ink" : i === 1 ? "bg-light" : "bg-fuel"}`}
                            style={{ width: `${p}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col">
              {warnCount > 0 && (
                <div className="mb-3.5 rounded-[14px] bg-fuel-soft px-3.5 py-3 text-sm leading-[1.4] font-medium">
                  {supply.household === "hybrid"
                    ? `${warnCount} device${warnCount > 1 ? "s are" : " is"} set to run longer than your light and gen hours together.`
                    : supply.household === "gen"
                      ? `${warnCount} device${warnCount > 1 ? "s are" : " is"} set to run longer than your ~${Math.round(H * 2) / 2}h of gen a day.`
                      : `${warnCount} device${warnCount > 1 ? "s are" : " is"} set to run longer than your ~${g}h of light a day. On prepaid alone, they can't.`}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 border-b-[1.5px] border-ink pb-2">
                <span className="text-[19px] font-bold">
                  Devices{" "}
                  <span className="font-mono text-[13px] font-normal text-muted">
                    {onRows.length} of {rows.length} on
                  </span>
                </span>
                <div className="flex gap-0.5 rounded-[10px] bg-track p-[3px]">
                  {(
                    [
                      ["cost", "By cost"],
                      ["category", "By category"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={ui.sort === k}
                      onClick={() => setUi({ sort: k })}
                      className={`h-9 rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap ${segClass(ui.sort === k)}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {sorted.map((r) => (
                <SimRowView
                  key={r.key}
                  r={r}
                  home={home}
                  warn={supplyNote(r, supply)}
                  showCat={ui.sort === "category"}
                  amount={rowAmount(r)}
                  expanded={ui.expanded === r.key}
                  onExpand={() => setUi({ expanded: ui.expanded === r.key ? null : r.key })}
                  edit={(fn) => simEdit(r.key, fn)}
                  onRemove={() => removeRow(r.key)}
                />
              ))}
              <button
                type="button"
                onClick={onAdd}
                className="mt-3.5 h-[52px] rounded-[14px] border-[1.5px] border-dashed border-line-strong text-[15px] font-bold hover:bg-track-2"
              >
                + Add device to simulation
              </button>
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="bar-fade pb-safe-bar fixed inset-x-0 bottom-0 z-20 px-5 pt-[22px]">
          <div className="mx-auto grid max-w-[560px] grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2.5">
            <button
              type="button"
              onClick={onReset}
              disabled={!anyMod}
              className="h-[58px] rounded-2xl border-[1.5px] border-line-strong bg-paper text-[15px] font-bold disabled:opacity-40"
            >
              Reset to My Home
            </button>
            <button
              type="button"
              onClick={onAskSave}
              disabled={!anyMod}
              className="h-[58px] rounded-2xl bg-ink text-[15px] font-bold text-card disabled:opacity-40"
            >
              Save as My Home
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SimRowView({
  r,
  home,
  warn: w,
  showCat,
  amount,
  expanded,
  onExpand,
  edit,
  onRemove,
}: {
  r: SimRow;
  home: Device[];
  warn: string;
  showCat: boolean;
  amount: string;
  expanded: boolean;
  onExpand: () => void;
  edit: (fn: (r: SimRow) => Partial<SimRow>) => void;
  onRemove: () => void;
}) {
  const mod = isModified(r, home);
  const u = r.usage;
  const setUsage = (patch: Partial<SimRow["usage"]>) => edit((x) => ({ usage: { ...x.usage, ...patch } }));
  const dim = r.on ? "" : "opacity-40";

  return (
    <div className={`flex flex-col border-b border-line ${expanded ? "bg-track-2" : ""}`}>
      <div className="grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={r.on}
          aria-label={r.on ? `Switch off ${r.name}` : `Switch on ${r.name}`}
          onClick={() => edit((x) => ({ on: !x.on }))}
          className="flex h-11 w-[52px] items-center justify-center"
        >
          <span className={`relative h-[26px] w-11 rounded-full transition-colors duration-200 ${r.on ? "bg-light" : "bg-line-strong"}`}>
            <span
              className={`absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                r.on ? "translate-x-[18px]" : ""
              }`}
            />
          </span>
        </button>
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          className={`flex min-w-0 flex-col gap-[3px] py-1 text-left ${dim}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-lg">{r.icon}</span>
            <span className="truncate text-base font-semibold">{r.name}</span>
            {r.quantity > 1 && <QtyBadge qty={r.quantity} />}
            {mod && (
              <span className="h-5 shrink-0 rounded-[5px] bg-fuel-soft px-1.5 font-mono text-[10px] leading-5 tracking-[0.04em] text-fuel-ink uppercase">
                {r.baseId ? "Modified" : "Added"}
              </span>
            )}
          </span>
          <span className={`font-mono text-xs ${w && r.on ? "text-fuel-ink" : "text-muted"}`}>
            {showCat ? CAT_LABEL[r.category] + " · " : ""}
            {usageSummary(r)}
          </span>
        </button>
        <button type="button" onClick={onExpand} tabIndex={-1} className={`flex items-center gap-2 py-1 ${dim}`}>
          <span className="text-base font-bold tabular-nums">{amount}</span>
          <span className={`text-sm text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▾</span>
        </button>
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-3.5 pt-1 pr-1 pb-[18px] pl-[68px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Quantity</span>
            <div className="flex items-center gap-1">
              <StepButton label="Fewer" onClick={() => edit((x) => ({ quantity: Math.max(LIMITS.quantity[0], x.quantity - 1) }))} className="bg-track">
                −
              </StepButton>
              <span className="min-w-9 text-center text-[17px] font-extrabold">{r.quantity}</span>
              <StepButton label="More" onClick={() => edit((x) => ({ quantity: Math.min(LIMITS.quantity[1], x.quantity + 1) }))} className="bg-track">
                +
              </StepButton>
            </div>
          </div>

          {u.profile === "always_on_battery" ? (
            <span className="text-[13px] text-muted">Always on · runs on its battery when light goes.</span>
          ) : u.profile === "charges" ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">Charges a day</span>
              <div className="flex items-center gap-1">
                <StepButton label="Fewer charges" onClick={() => setUsage({ chargesPerDay: chargesDown(u.chargesPerDay ?? 0) })} className="bg-track">
                  −
                </StepButton>
                <span className="min-w-9 text-center text-[17px] font-extrabold">{trimN(u.chargesPerDay ?? 0)}</span>
                <StepButton label="More charges" onClick={() => setUsage({ chargesPerDay: chargesUp(u.chargesPerDay ?? 0) })} className="bg-track">
                  +
                </StepButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Hours a day</span>
                <label className="flex h-10 items-center gap-1 rounded-[10px] border-[1.5px] border-line bg-card px-2.5">
                  <input
                    inputMode="decimal"
                    aria-label={`Hours a day for ${r.name}`}
                    value={r.hoursText ?? String(u.hoursPerDay ?? 0)}
                    onChange={(e) => {
                      const v = dec(e.target.value);
                      const h = Math.min(24, num(v));
                      edit((x) => ({ hoursText: num(v) > 24 ? "24" : v, usage: { ...x.usage, hoursPerDay: h } }));
                    }}
                    className="w-11 bg-transparent text-right text-base font-bold outline-none"
                  />
                  <span className="text-[13px] text-muted">h</span>
                </label>
              </div>
              <input
                type="range"
                min={0}
                max={24}
                step={0.5}
                aria-label={`Hours a day for ${r.name}`}
                value={u.hoursPerDay ?? 0}
                onChange={(e) => edit((x) => ({ hoursText: undefined, usage: { ...x.usage, hoursPerDay: +e.target.value } }))}
                className="m-0 h-9 w-full accent-light"
              />
            </div>
          )}

          <TierPicker dev={r} value={r.tierOverride} onChange={(t) => edit(() => ({ tierOverride: t }))} compact />

          {w && <span className="text-[13px] leading-[1.4] text-fuel-ink">{w}</span>}

          <div className="flex flex-wrap gap-2">
            {r.baseId && mod && (
              <button
                type="button"
                onClick={() => {
                  const b = home.find((x) => x.id === r.baseId);
                  if (b) edit(() => ({ ...b, on: true, hoursText: undefined }));
                }}
                className="h-10 rounded-[10px] border-[1.5px] border-line-strong px-3.5 text-[13px] font-semibold"
              >
                Reset to My Home
              </button>
            )}
            {!r.baseId && (
              <button
                type="button"
                onClick={onRemove}
                className="h-10 rounded-[10px] border-[1.5px] border-red px-3.5 text-[13px] font-semibold text-red"
              >
                Remove from simulation
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
