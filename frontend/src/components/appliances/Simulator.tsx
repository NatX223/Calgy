"use client";

import {
  CAT_LABEL, CAT_ORDER, chargesDown, chargesUp, isModified, sumTrio, supplyWarning, trio, usageSummary,
  type Device, type SimRow, type Tariff, type Tier,
} from "@/lib/appliances";
import { commas, dec, digits, fU, naira, num, rN, shortN, trimN } from "@/lib/format";
import { Chip, Eyebrow, StepButton } from "../ui";
import { costFor, QtyBadge } from "./MyHome";

export type SimUi = {
  period: "day" | "week" | "month" | "custom";
  customDays: string;
  sort: "cost" | "category";
  expanded: string | null;
  tokenAmt: string;
  soon: "hybrid" | "gen" | null;
};

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
  gridHours: g,
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
  gridHours: number;
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

  const homeTot = sumTrio(home);
  const onRows = rows.filter((r) => r.on);
  const simTot = sumTrio(onRows);
  const dTyp = simTot.typ - homeTot.typ;
  const pct = homeTot.typ ? Math.round((dTyp / homeTot.typ) * 100) : 0;
  const sign = dTyp < 0 ? "−" : "+";
  const deltaText = T
    ? `${sign}${naira(Math.abs(rN(dTyp * days * tv, days)))} / ${perLabel} (${sign}${Math.abs(pct)}%)`
    : `${sign}${fU(Math.abs(dTyp * days))} units / ${perLabel} (${sign}${Math.abs(pct)}%)`;

  const sorted = [...rows].sort((a, b) =>
    ui.sort === "cost"
      ? Number(b.on) - Number(a.on) || trio(b).typ - trio(a).typ
      : CAT_ORDER[a.cat] - CAT_ORDER[b.cat] || a.name.localeCompare(b.name),
  );

  const warnCount = onRows.filter((r) => supplyWarning(r, g)).length;
  const top = onRows
    .map((r) => ({ r, v: trio(r).typ }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);

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

        <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-track p-1">
          <button type="button" aria-pressed="true" className="min-h-12 rounded-[10px] bg-ink text-sm font-bold text-card">
            Prepaid meter
          </button>
          {(
            [
              ["hybrid", "Hybrid"],
              ["gen", "Generator only"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-disabled="true"
              onClick={() => setUi({ soon: k })}
              className="flex min-h-12 flex-col items-center justify-center gap-px rounded-[10px] text-sm font-semibold text-muted"
            >
              {label}
              <span className="font-mono text-[10px] tracking-[0.06em] text-fuel-ink uppercase">Soon</span>
            </button>
          ))}
        </div>
        {ui.soon && (
          <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-fuel-soft px-3.5 py-2.5 text-sm leading-[1.4]">
            <span className="flex-1">
              {ui.soon === "hybrid"
                ? "Hybrid is coming soon: combine light hours and generator hours to see your real mix."
                : "Generator only is coming soon: see what your devices cost to run on fuel."}
            </span>
            <button type="button" onClick={() => setUi({ soon: null })} aria-label="Dismiss" className="h-8 w-8 text-sm">
              ✕
            </button>
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

              {top.length > 0 && (
                <div className="flex flex-col gap-3 px-0.5 py-1">
                  <Eyebrow>Top consumers</Eyebrow>
                  {top.map((x, i) => {
                    const p = Math.round((x.v / simTot.typ) * 100);
                    return (
                      <div key={x.r.key} className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-2.5 text-sm">
                          <span className="font-semibold">
                            {x.r.icon} {x.r.name}
                            {num(x.r.qty) > 1 ? ` ×${num(x.r.qty)}` : ""}
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
                  {warnCount} device{warnCount > 1 ? "s are" : " is"} set to run longer than your ~{g}h of light a day. On
                  prepaid alone, they can&apos;t.
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
                  g={g}
                  showCat={ui.sort === "category"}
                  amount={T ? "~" + cost(trio(r).typ, days) : fU(trio(r).typ * days) + " u"}
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
  g,
  showCat,
  amount,
  expanded,
  onExpand,
  edit,
  onRemove,
}: {
  r: SimRow;
  home: Device[];
  g: number;
  showCat: boolean;
  amount: string;
  expanded: boolean;
  onExpand: () => void;
  edit: (fn: (r: SimRow) => Partial<SimRow>) => void;
  onRemove: () => void;
}) {
  const w = supplyWarning(r, g);
  const mod = isModified(r, home);
  const unit = r.type === "charging" ? "Wh" : "W";
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
            {num(r.qty) > 1 && <QtyBadge qty={num(r.qty)} />}
            {mod && (
              <span className="h-5 shrink-0 rounded-[5px] bg-fuel-soft px-1.5 font-mono text-[10px] leading-5 tracking-[0.04em] text-fuel-ink uppercase">
                {r.baseId ? "Modified" : "Added"}
              </span>
            )}
          </span>
          <span className={`font-mono text-xs ${w && r.on ? "text-fuel-ink" : "text-muted"}`}>
            {showCat ? CAT_LABEL[r.cat] + " · " : ""}
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
              <StepButton label="Fewer" onClick={() => edit((x) => ({ qty: Math.max(1, num(x.qty) - 1) }))} className="bg-track">
                −
              </StepButton>
              <span className="min-w-9 text-center text-[17px] font-extrabold">{num(r.qty)}</span>
              <StepButton label="More" onClick={() => edit((x) => ({ qty: Math.min(99, num(x.qty) + 1) }))} className="bg-track">
                +
              </StepButton>
            </div>
          </div>

          {r.type === "charging" ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">Charges a day</span>
              <div className="flex items-center gap-1">
                <StepButton label="Fewer charges" onClick={() => edit((x) => ({ charges: chargesDown(num(x.charges)) }))} className="bg-track">
                  −
                </StepButton>
                <span className="min-w-9 text-center text-[17px] font-extrabold">{trimN(num(r.charges))}</span>
                <StepButton label="More charges" onClick={() => edit((x) => ({ charges: chargesUp(num(x.charges)) }))} className="bg-track">
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
                    value={String(r.hours)}
                    onChange={(e) => {
                      const v = dec(e.target.value);
                      edit(() => ({ hours: num(v) > 24 ? 24 : v }));
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
                value={num(r.hours)}
                onChange={(e) => edit(() => ({ hours: +e.target.value }))}
                className="m-0 h-9 w-full accent-light"
              />
            </div>
          )}

          {r.tiers && (
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-track p-1">
              {(["low", "typical", "high"] as Tier[]).map((tk, i) => (
                <button
                  key={tk}
                  type="button"
                  aria-pressed={r.tier === tk}
                  onClick={() => edit(() => ({ tier: tk }))}
                  className={`flex min-h-12 flex-col items-center justify-center gap-px rounded-[9px] ${segClass(r.tier === tk)}`}
                >
                  <span className="text-[13px] font-bold capitalize">{tk}</span>
                  <span className="font-mono text-[11px]">
                    {r.tiers![i]}
                    {unit}
                  </span>
                </button>
              ))}
            </div>
          )}

          {w && <span className="text-[13px] leading-[1.4] text-fuel-ink">{w}</span>}

          <div className="flex flex-wrap gap-2">
            {r.baseId && mod && (
              <button
                type="button"
                onClick={() => {
                  const b = home.find((x) => x.id === r.baseId);
                  if (b) edit(() => ({ ...b, on: true }));
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
