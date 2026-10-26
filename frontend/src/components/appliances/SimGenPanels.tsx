"use client";

// Simulator panels for the Hybrid and Generator-only tabs.
import { dec, fU, naira, num, rN } from "@calgy/engine/format";
import { lastsDays, type ModeTotals, type SimMode } from "@calgy/engine/sim-modes";
import { Chip, Eyebrow, Marker, SplitBar, StepButton } from "../ui";

export type FuelInfo = {
  /** What the gen is called on screen, e.g. "2.5 kVA" or "Small portable petrol · assumed". */
  label: string;
  assumed: boolean;
  nairaPerLitre: number | null;
  priceSource: string | null;
};

const money = (perDay: number, days: number) => naira(rN(perDay * days, days));
const litresFmt = (l: number) => `${fU(l)} L`;
const daysFmt = (d: number) =>
  !Number.isFinite(d) ? "—" : d < 1 ? `~${Math.max(1, Math.round(d * 24))} hours` : `~${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`;

/** Light / gen hours for this what-if. */
export function HoursWhatIf({
  mode,
  G,
  H,
  hAssumed,
  onG,
  onH,
  changed,
  onReset,
}: {
  mode: SimMode;
  G: number;
  H: number;
  hAssumed: boolean;
  onG: (v: number) => void;
  onH: (v: number) => void;
  changed: boolean;
  onReset: () => void;
}) {
  const row = (label: string, sub: string, v: number, set: (v: number) => void, kind: "token" | "fuel") => (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <Marker type={kind} />
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold">{label}</span>
          <span className="font-mono text-xs text-muted">{sub}</span>
        </span>
      </span>
      <span className="flex items-center gap-1">
        <StepButton label={`Fewer ${label.toLowerCase()}`} onClick={() => set(Math.max(0, v - 1))} className="bg-track">
          −
        </StepButton>
        <span className="min-w-12 text-center text-[17px] font-extrabold">{Math.round(v * 2) / 2}h</span>
        <StepButton label={`More ${label.toLowerCase()}`} onClick={() => set(Math.min(24, v + 1))} className="bg-track">
          +
        </StepButton>
      </span>
    </div>
  );
  return (
    <div className="mt-3.5 flex flex-col gap-3 rounded-[18px] border border-line bg-card px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>What if · hours a day</Eyebrow>
        {changed && (
          <button type="button" onClick={onReset} className="text-[13px] font-semibold text-light">
            Reset hours
          </button>
        )}
      </div>
      {mode !== "gen" && row("Light hours", "From the grid", G, onG, "token")}
      {mode !== "prepaid" && row("Gen hours", hAssumed ? "Assumed until you log fuel with hours" : "From your fuel logs", H, onH, "fuel")}
    </div>
  );
}

/** Results card for the Hybrid and Generator-only tabs. */
export function GenResults({
  mode,
  sim,
  home,
  days,
  perLabel,
  anyMod,
  fuel,
  tariffLabel,
  onTariff,
}: {
  mode: "hybrid" | "gen";
  sim: ModeTotals;
  home: ModeTotals;
  days: number;
  perLabel: string;
  anyMod: boolean;
  fuel: FuelInfo;
  tariffLabel: string | null;
  onTariff: () => void;
}) {
  const units = sim.gridKwh.typical + sim.genKwh.typical;
  const lo = sim.gridKwh.low + sim.genKwh.low;
  const hi = sim.gridKwh.high + sim.genKwh.high;
  const delta = sim.naira && home.naira ? sim.naira.typical - home.naira.typical : null;
  const deltaL = sim.litres.typical - home.litres.typical;
  const pct = home.naira && delta != null && home.naira.typical ? Math.round((delta / home.naira.typical) * 100) : 0;
  const genPct = sim.naira && sim.genNaira && sim.naira.typical ? Math.round((sim.genNaira.typical / sim.naira.typical) * 100) : 0;
  const sign = (n: number) => (n < 0 ? "−" : "+");

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3.5 rounded-[22px] bg-ink px-5 py-[18px] text-card shadow-[0_10px_24px_-12px_rgba(25,23,18,0.5)] wide:static">
      <Eyebrow className="text-[11px] text-ink-muted">
        Estimated · per {perLabel} · {mode === "gen" ? "on your gen" : "light + gen"}
      </Eyebrow>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-end gap-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-4xl leading-none font-extrabold tracking-[-0.045em]">
            ~{sim.naira ? money(sim.naira.typical, days) : litresFmt(sim.litres.typical * days)}
          </span>
          <span className="font-mono text-xs text-ink-muted">
            {sim.naira
              ? `${money(sim.naira.low, days)} – ${money(sim.naira.high, days)}`
              : mode === "gen"
                ? "of fuel · log fuel with litres for ₦"
                : "fuel · add your tariff and fuel price for ₦"}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[22px] leading-[1.05] font-extrabold tracking-[-0.03em]">{fU(units * days)} units</span>
          <span className="font-mono text-xs text-ink-muted">
            {fU(lo * days)} – {fU(hi * days)} kWh
          </span>
        </div>
      </div>

      {mode === "hybrid" && sim.naira && sim.naira.typical > 0 && (
        <div className="flex flex-col gap-2">
          <SplitBar fuelPct={genPct} empty={false} emptyClass="bg-ink-line" />
          <div className="flex flex-wrap justify-between gap-x-4 font-mono text-xs text-ink-muted">
            <span>Light {money(sim.gridNaira!.typical, days)}</span>
            <span>Gen {money(sim.genNaira!.typical, days)}</span>
          </div>
        </div>
      )}

      <span className="font-mono text-xs leading-[1.5] text-ink-muted">
        {fU(sim.litres.typical * days)} L of fuel
        {sim.idleLitres > 0
          ? ` · ${sim.genNaira ? money(sim.idleLitres * (fuel.nairaPerLitre ?? 0), days) : litresFmt(sim.idleLitres * days)} of it just keeps the gen running`
          : ""}
        {sim.loadKw != null && sim.kw ? ` · load ~${fU(sim.loadKw)} of ${fU(sim.kw)} kW` : ""}
      </span>

      {sim.overload && (
        <span className="rounded-[10px] bg-red-soft px-3 py-2 text-sm font-semibold text-ink">
          That&apos;s more than your gen can carry on average. Some devices can&apos;t run together on it.
        </span>
      )}

      {anyMod && (delta != null ? Math.abs(delta) > 1e-6 : Math.abs(deltaL) > 1e-6) && (
        <div
          className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-[15px] font-bold text-ink ${
            (delta ?? deltaL) < 0 ? "bg-light-chip" : "bg-red-soft"
          }`}
        >
          <span>
            {delta != null
              ? `${sign(delta)}${naira(Math.abs(rN(delta * days, days)))} / ${perLabel} (${sign(delta)}${Math.abs(pct)}%)`
              : `${sign(deltaL)}${litresFmt(Math.abs(deltaL * days))} / ${perLabel}`}
          </span>
          <span className="font-medium text-ink-line">vs My Home</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-ink-line pt-2.5 font-mono text-xs text-ink-muted">
        <span>
          Gen: {fuel.label}
          {fuel.nairaPerLitre != null ? ` · ₦${Math.round(fuel.nairaPerLitre).toLocaleString("en-NG")}/L ${fuel.priceSource ?? ""}` : " · no fuel price yet"}
        </span>
        {mode === "hybrid" && (
          <button type="button" onClick={onTariff} className="flex min-h-8 items-center justify-between gap-2.5 text-left">
            <span>{tariffLabel ?? "No tariff yet"}</span>
            <span className="text-[13px] font-bold text-fuel">{tariffLabel ? "Edit" : "Set tariff"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** "How long will my fuel last?" */
export function FuelLife({
  amount,
  setAmount,
  simPerDay,
  homePerDay,
  anyMod,
  nairaPerLitre,
}: {
  amount: string;
  setAmount: (v: string) => void;
  simPerDay: number;
  homePerDay: number;
  anyMod: boolean;
  nairaPerLitre: number | null;
}) {
  const L = num(amount);
  const sim = lastsDays(L, simPerDay);
  const base = lastsDays(L, homePerDay);
  const diff = Number.isFinite(sim) && Number.isFinite(base) ? Math.round(sim) - Math.round(base) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-line bg-card px-5 py-[18px]">
      <span className="text-[17px] font-bold">How long will my fuel last?</span>
      <label className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5">
        <input
          inputMode="decimal"
          placeholder="0"
          aria-label="Litres of fuel"
          value={amount}
          onChange={(e) => setAmount(dec(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-xl font-bold outline-none"
        />
        <span className="font-mono text-[13px] text-muted">litres</span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {[5, 10, 20, 50].map((v) => (
          <Chip key={v} on={L === v} onClick={() => setAmount(String(v))} className="h-10 px-3.5 text-[13px] font-normal">
            {v} L
          </Chip>
        ))}
      </div>
      <span className="text-[34px] font-extrabold tracking-[-0.04em] text-fuel-ink">
        {!L ? "—" : simPerDay > 0 ? daysFmt(sim) : "Lasts and lasts"}
      </span>
      <span className="text-sm text-body-2">
        {L ? `${L} L${nairaPerLitre != null ? ` costs about ${naira(rN(L * nairaPerLitre, 1))}` : ""} at ~${fU(simPerDay)} L a day.` : "Enter litres."}
      </span>
      {anyMod && L > 0 && diff !== 0 && (
        <span className={`text-sm font-semibold ${diff > 0 ? "text-light" : "text-red"}`}>
          {diff > 0
            ? `With your changes, it lasts ${diff} day${diff === 1 ? "" : "s"} longer than My Home (${daysFmt(base)}).`
            : `With your changes, it runs out ${-diff} day${diff === -1 ? "" : "s"} sooner than My Home (${daysFmt(base)}).`}
        </span>
      )}
    </div>
  );
}
