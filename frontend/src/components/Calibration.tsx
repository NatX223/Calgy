"use client";

// Calibration UI shared by My Home, the Meter screen and the gen report (§B8).
import { useState, type ReactNode } from "react";
import {
  genPrompt, genReady, GRID_CULPRITS, gridPrompt, gridReady, type CalibrationResult, type GenResult, type GridResult,
} from "@calgy/engine/calibration";
import { COVERAGE_OK, GEN_OVERSIZED_LOAD, SHARED_METER_COVERAGE } from "@calgy/engine/calibration-constants";
import { fU, naira, trim } from "@calgy/engine/format";
import { KW_PER_KVA } from "@calgy/engine/generator";
import { confidenceAbove, type Confidence } from "@calgy/engine/meter";
import { Eyebrow } from "./ui";

const CONF: Record<Confidence, string> = { rough: "Rough", good: "Good", solid: "Solid" };
/** Hours to the nearest half. */
export const fH = (h: number) => trim((Math.round(h * 2) / 2).toFixed(1));
const pct = (f: number) => `${Math.round(f * 100)}%`;
const rate = (n: number) => naira(n >= 100 ? Math.round(n / 10) * 10 : n);

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-2.5 rounded-[18px] border border-line bg-card p-[18px] ${className}`}>{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-fuel-soft px-3.5 py-2.5 text-sm leading-[1.4] text-pretty text-fuel-ink">{children}</p>;
}

// ——— Badges (§B8.1) ———

export function gridBadge(r: CalibrationResult | null): { text: string; ok: boolean } | null {
  const g = r?.grid;
  if (!g) return null;
  if (g.status === "not_ready")
    return g.actualDailyKwh == null
      ? { text: "Add a meter reading to match your real usage", ok: false }
      : { text: "Add your devices in My Home to match them to your meter", ok: false };
  if (g.status === "mismatch_under" || g.status === "mismatch_over") return { text: "Doesn't match your meter yet", ok: false };
  return { text: `Matched to your meter · ${CONF[g.confidence ?? "rough"]}`, ok: true };
}

export function genBadge(r: CalibrationResult | null): { text: string; ok: boolean } | null {
  const g = r?.gen;
  if (!g) return null;
  if (g.status === "not_ready") return { text: "Log a fuel purchase with hours to match your gen", ok: false };
  if (g.status === "gen_matched") return { text: `Matched to your fuel · ${CONF[g.confidence ?? "rough"]}`, ok: true };
  return { text: "Doesn't match your fuel yet", ok: false };
}

/** Pills for the dark summary cards. */
export function CalBadges({ r, enabled }: { r: CalibrationResult | null; enabled: boolean }) {
  if (!enabled) return null;
  const badges = [gridBadge(r), genBadge(r)].filter((b): b is { text: string; ok: boolean } => !!b);
  return (
    <>
      {badges.map((b) => (
        <span
          key={b.text}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${
            b.ok ? "bg-light-chip text-ink" : "bg-ink-pill text-card"
          }`}
        >
          {b.ok ? "✓" : "○"} {b.text}
        </span>
      ))}
    </>
  );
}

// ——— Estimate vs reality (§B8.2) ———

function meterLine(g: GridResult) {
  const bits: string[] = [];
  if (g.sources.readings != null) bits.push(`${g.validPairs + 1} readings over ${Math.max(1, Math.round(g.spanDays))} days`);
  if (g.sources.meterAvg != null) bits.push("your meter's average");
  if (g.sources.lifetime != null) bits.push("your meter's total since you started");
  return `Your meter: ~${fU(g.actualDailyKwh!)} units/day (${bits.join(" + ")}).`;
}

function gridHowLines(g: GridResult): string[] {
  const out = [meterLine(g)];
  const full = `~${fU(g.fullSupplyKwh)} units/day with 24h of light`;
  if (g.mode === "infer_hours" && g.inferredGridHours) {
    const [lo, hi] = g.inferredGridHours.range;
    out.push(`Your devices would use ${full} → you're likely getting about ${fH(g.inferredGridHours.value)}h (${fH(lo)}–${fH(hi)}h).`);
  } else if (g.mode === "infer_hours") {
    out.push(
      g.status === "mismatch_under"
        ? `Even with 24h of light your devices would only use ${full.replace(" with 24h of light", "")}, so we can't work out your light hours yet.`
        : `Your devices would use more than your meter shows even with very little light, so we can't work out your light hours yet.`,
    );
  } else {
    out.push(`You get about ${fH(g.gridHoursUsed)}h of light, so your devices would use ~${fU(g.coverage! * g.actualDailyKwh!)} units/day.`);
    if (g.t != null) out.push("That's within their normal range, so we picked the point in each range that matches your meter.");
    else if (g.k != null) out.push(`We scaled your devices by ×${Math.round(g.k * 100) / 100} to match${g.k === 2 || g.k === 0.5 ? " (as far as we go)" : ""}.`);
  }
  return out;
}

function genHowLines(g: GenResult): string[] {
  if (g.actualLph == null || g.kw == null) return [];
  const kva = `${trim((g.kw / KW_PER_KVA).toFixed(1))}kVA`;
  const out = [`Your gen burns ~${fU(g.actualLph)} L/hour.`];
  if (g.predictedLph != null && g.deviceGenLoadKw != null)
    out.push(`A healthy ${kva} running your gen devices (~${fU(g.deviceGenLoadKw)} kW) would burn ~${fU(g.predictedLph)} L/hour.`);
  if (g.genHoursRough) out.push("Gen hours a day come from one purchase so far, so treat this as rough.");
  return out;
}

export function RealityCard({ r, enabled }: { r: CalibrationResult | null; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  if (!enabled || !r) return null;
  const g = r.grid;
  const n = r.gen;
  const lines = [...(g && g.actualDailyKwh != null && g.status !== "not_ready" ? gridHowLines(g) : []), ...(n ? genHowLines(n) : [])];

  return (
    <Card>
      <Eyebrow>Estimate vs reality</Eyebrow>

      {g &&
        (gridReady(r) && g.coverage != null ? (
          <>
            <span className="text-base leading-[1.45]">
              Your devices explain <strong>{pct(g.coverage)}</strong> of your meter usage.
            </span>
            {g.coverage < COVERAGE_OK[0] && (
              <Note>
                {gridPrompt("mismatch_under")} Common culprits: {GRID_CULPRITS.join(", ")}.
              </Note>
            )}
            {g.coverage > COVERAGE_OK[1] && <Note>{gridPrompt("mismatch_over")}</Note>}
            {g.coverage < SHARED_METER_COVERAGE && (
              <span className="text-[13px] leading-[1.4] text-muted">If your meter is shared, usage will look higher than your devices.</span>
            )}
          </>
        ) : (
          <span className="text-[15px] leading-[1.45] text-muted">
            {g.actualDailyKwh == null ? gridPrompt("not_ready") : "Add the devices you run on light to compare them with your meter."}
          </span>
        ))}

      {n &&
        (genReady(r) && n.coverage != null ? (
          <>
            <span className="text-base leading-[1.45]">
              Your devices explain <strong>{pct(n.coverage)}</strong> of your gen&apos;s fuel use.
            </span>
            {genPrompt(n) && <Note>{genPrompt(n)}</Note>}
          </>
        ) : n.status === "gen_data_check" ? (
          <Note>{genPrompt(n)}</Note>
        ) : (
          <span className="text-[15px] leading-[1.45] text-muted">
            {n.actualLph == null
              ? genPrompt(n)
              : r.gen?.genHoursPerDay == null
                ? "Log 2 fuel purchases to calibrate your gen side."
                : "Add devices that run on your gen to compare them with its fuel use."}
          </span>
        ))}

      {lines.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-track pt-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-10 items-center justify-between text-[15px] font-semibold"
          >
            <span>How we matched this</span>
            <span className="font-mono text-[13px] text-muted">{open ? "▴" : "▾"}</span>
          </button>
          {open && (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.45] text-body-2">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
              <li className="text-muted">
                The meter only sees grid power, and gen fuel use is modelled — a gen burns more as it ages, so a gap can mean
                gen health, not missing devices. Inverter and battery-bank systems aren&apos;t modelled yet.
              </li>
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ——— Light hours (§B8.3) ———

export function LightHoursCard({
  r,
  enabled,
  keptAt,
  onSet,
  onKeep,
}: {
  r: CalibrationResult | null;
  enabled: boolean;
  /** Confidence when the user last kept their own hours over a suggestion. */
  keptAt: Confidence | null;
  onSet: (hours: number) => void;
  onKeep: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const g = r?.grid;
  if (!enabled || !g || g.status === "not_ready") return null;

  const editor = (
    <div className="flex items-center gap-2">
      <label className="flex h-12 flex-1 items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5">
        <input
          inputMode="decimal"
          autoFocus
          aria-label="Hours of light a day"
          placeholder="0"
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ""))}
          className="min-w-0 flex-1 bg-transparent text-lg font-bold outline-none"
        />
        <span className="font-mono text-[13px] text-muted">h a day</span>
      </label>
      <button
        type="button"
        disabled={!(Number(val) >= 0 && Number(val) <= 24 && val !== "")}
        onClick={() => {
          onSet(Math.min(24, Number(val)));
          setEditing(false);
        }}
        className="h-12 rounded-xl bg-ink px-4 text-[15px] font-bold text-card disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
  const btn = "h-11 flex-1 rounded-xl text-[15px] font-bold";

  if (g.mode === "infer_hours") {
    const inf = g.inferredGridHours;
    return (
      <Card>
        <Eyebrow>Your light hours</Eyebrow>
        <span className="text-base leading-[1.45]">
          {inf ? (
            <>
              You&apos;re getting about <strong>{fH(inf.value)}h of light a day</strong> ({fH(inf.range[0])}–{fH(inf.range[1])}h).
            </>
          ) : (
            "We couldn't work out your light hours yet."
          )}
        </span>
        {editing ? (
          editor
        ) : (
          <div className="flex gap-2">
            {inf && (
              <button type="button" onClick={() => onSet(Math.round(inf.value * 2) / 2)} className={`${btn} bg-ink text-card`}>
                That&apos;s right
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setVal(inf ? fH(inf.value) : "");
                setEditing(true);
              }}
              className={`${btn} border-[1.5px] border-line-strong`}
            >
              {inf ? "Not quite" : "Set my hours"}
            </button>
          </div>
        )}
      </Card>
    );
  }

  const s = g.suggestedGridHours;
  if (!s || (keptAt && !confidenceAbove(g.confidence, keptAt))) return null;
  return (
    <Card>
      <Eyebrow>Your light hours</Eyebrow>
      <span className="text-base leading-[1.45]">
        Your meter suggests about <strong>{fH(s.value)}h</strong>, but you set <strong>{fH(g.gridHoursUsed)}h</strong>. Update?
      </span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onSet(Math.round(s.value * 2) / 2)} className={`${btn} bg-ink text-card`}>
          Use {fH(s.value)}h
        </button>
        <button type="button" onClick={onKeep} className={`${btn} border-[1.5px] border-line-strong`}>
          Keep {fH(g.gridHoursUsed)}h
        </button>
      </div>
    </Card>
  );
}

// ——— Generator insight (§B5.5, B8.4) ———

export function GenInsightCard({ r, enabled, gridTariff }: { r: CalibrationResult | null; enabled: boolean; gridTariff: number | null }) {
  const g = r?.gen;
  if (!enabled || !g || g.inferredLoadKw == null || g.loadPercent == null || g.status === "gen_data_check") return null;
  const rough = g.genHoursRough || g.confidence === "rough";
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>Your gen, matched to your fuel</Eyebrow>
        {rough && <span className="font-mono text-xs text-muted">Rough</span>}
      </div>
      <span className="text-[22px] leading-[1.15] font-extrabold tracking-[-0.02em]">
        Your gen runs at about <span className="text-fuel-ink">{pct(g.loadPercent)} load</span>
      </span>
      {g.loadPercent < GEN_OVERSIZED_LOAD && (
        <Note>Your gen is much bigger than what you run on it. A smaller gen or an inverter would cut fuel use.</Note>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-track pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-muted">Real cost per unit</span>
          <span className="text-lg font-extrabold">{g.nairaPerKwh != null ? `${rate(g.nairaPerKwh)}/unit` : "—"}</span>
          {gridTariff != null && <span className="font-mono text-xs text-muted">vs {rate(gridTariff)}/unit from light</span>}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-muted">Gen energy</span>
          <span className="text-lg font-extrabold">{g.genKwhPerDay != null ? `~${fU(g.genKwhPerDay)} units/day` : "—"}</span>
          {g.genHoursPerDay != null && <span className="font-mono text-xs text-muted">~{fH(g.genHoursPerDay)}h of gen a day</span>}
        </div>
      </div>
    </Card>
  );
}

// ——— Hybrid summary (§B6) ———

export function HybridSummary({
  r,
  enabled,
  gridDaily,
  genDaily,
  gridTariff,
  genRate,
}: {
  r: CalibrationResult | null;
  enabled: boolean;
  gridDaily: number;
  genDaily: number;
  gridTariff: number | null;
  genRate: number | null;
}) {
  if (!enabled || !r || r.household !== "hybrid" || !r.grid) return null;
  const parts = [
    `Light ~${fH(r.grid.gridHoursUsed)}h/day`,
    r.genHoursUsed ? `Gen ~${fH(r.genHoursUsed)}h/day` : null,
    `Grid ${fU(gridDaily)} units/day`,
    `Gen ${fU(genDaily)} units/day`,
  ].filter(Boolean);
  return (
    <Card>
      <Eyebrow>Light and gen</Eyebrow>
      <span className="text-[15px] leading-[1.5]">{parts.join(" · ")}</span>
      {genRate != null && gridTariff != null && (
        <span className="text-[15px] leading-[1.45] font-semibold">
          Gen costs {rate(genRate)}/unit vs {rate(gridTariff)}/unit from light.
        </span>
      )}
    </Card>
  );
}
