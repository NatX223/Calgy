"use client";

import {
  adapterMaxW, CAT_ICON, draftRating, fieldErrors, fmtDraw, placeholder, presetOfDraft,
  type Draft, type FieldKey, type LabelMethod, type UsageProfile,
} from "@calgy/engine/appliances";
import { ADAPTER_TYPICAL_FACTOR } from "@calgy/engine/energy-constants";
import { dec } from "@calgy/engine/format";
import { CATEGORIES } from "@calgy/engine/presets";
import type { ReactNode } from "react";
import { Chip } from "../ui";

export const field = "rounded-xl border-[1.5px] border-line bg-paper";
export const segClass = (on: boolean) => (on ? "bg-card text-ink" : "bg-transparent text-ink");
const linkBtn = "self-start text-[13px] font-semibold text-light underline underline-offset-2";
const hint = "text-[13px] leading-[1.4] text-muted";

export function Seg<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [K, string])[];
  value: K;
  onChange: (k: K) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-track-2 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map(([k, l]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`min-h-10 rounded-[9px] px-1 text-[13px] font-bold ${segClass(value === k)}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function NumField({
  d,
  setF,
  k,
  label,
  unit,
  errors,
  optional,
}: {
  d: Draft;
  setF: (k: FieldKey, v: string) => void;
  k: FieldKey;
  label: string;
  unit: ReactNode;
  errors: Partial<Record<FieldKey, string>>;
  optional?: boolean;
}) {
  const err = errors[k];
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-sm font-semibold">
        {label}
        {optional && <span className="font-normal text-muted"> · optional</span>}
      </span>
      <span className={`flex h-[52px] items-center gap-1.5 px-3.5 ${field} ${err ? "border-red" : ""}`}>
        <input
          inputMode="decimal"
          placeholder={placeholder(d, k)}
          value={d.f[k] ?? ""}
          aria-invalid={!!err}
          onChange={(e) => setF(k, dec(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-lg font-bold outline-none placeholder:font-semibold placeholder:text-line-strong"
        />
        <span className="font-mono text-[13px] text-muted">{unit}</span>
      </span>
      {err && <span className="text-[13px] font-medium text-red">{err}</span>}
    </label>
  );
}

const METHOD_OPTIONS = [
  ["watts", "Watts (W)"],
  ["volts_amps", "Volts × amps"],
  ["battery", "Battery"],
  ["hp_btu", "HP / BTU"],
  ["kwh_year", "kWh / year"],
] as const;

const PROFILE_OPTIONS = [
  ["steady", "Steady", "Draws power the whole time it’s on: fans, TVs, bulbs."],
  ["cycling", "Cycling", "Switches itself on and off: fridges, ACs, irons."],
  ["charges", "Charges", "You charge it, then use it unplugged: phones, lamps."],
  ["always_on_battery", "Always on", "Plugged in all day with a battery inside, like a MiFi."],
] as const;

/** Custom device: category, label method and usage profile. Battery ⇔ charges/always-on. */
export function CustomSetup({ d, setDraft }: { d: Draft; setDraft: (p: Partial<Draft>) => void }) {
  const setMethod = (m: LabelMethod) => {
    const u = { ...d.usage };
    if (m === "battery" && (u.profile === "steady" || u.profile === "cycling")) u.profile = "charges";
    if (m !== "battery" && (u.profile === "charges" || u.profile === "always_on_battery")) u.profile = "steady";
    if (m === "kwh_year") {
      u.profile = "cycling";
      setDraft({ method: m, usage: u, f: { ...d.f, hours: "24" } });
      return;
    }
    setDraft({ method: m, usage: u });
  };
  const setProfile = (pr: UsageProfile) => {
    const battery = pr === "charges" || pr === "always_on_battery";
    const method: LabelMethod = battery ? "battery" : d.method === "battery" ? "watts" : d.method;
    setDraft({ usage: { ...d.usage, profile: pr, chargesPerDay: d.usage.chargesPerDay ?? 1 }, method });
  };
  const prof = PROFILE_OPTIONS.find((x) => x[0] === d.usage.profile)!;

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Category</span>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              on={d.category === c.id}
              onClick={() => setDraft({ category: c.id, icon: CAT_ICON[c.id] })}
              className="h-9 px-3 font-sans text-[13px] font-semibold"
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">What&apos;s on its label?</span>
        <div className="flex flex-wrap gap-1.5">
          {METHOD_OPTIONS.map(([k, l]) => (
            <Chip key={k} on={d.method === k} onClick={() => setMethod(k)} className="h-9 px-3 font-sans text-[13px] font-semibold">
              {l}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">How it uses power</span>
        <Seg options={PROFILE_OPTIONS.map(([k, l]) => [k, l] as const)} value={d.usage.profile} onChange={setProfile} />
        <span className={hint}>{prof[2]}</span>
      </div>
      {d.method === "hp_btu" && (
        <Seg
          label="Device type"
          options={[["ac_cooling", "Air conditioner"], ["motor", "Motor / pump"]] as const}
          value={d.hpKind}
          onChange={(k) => setDraft({ hpKind: k })}
        />
      )}
    </>
  );
}

/** Step 2 — "What's on the label?" Only the fields for the current method. */
export function LabelFields({ d, setDraft }: { d: Draft; setDraft: (p: Partial<Draft>) => void }) {
  const p = presetOfDraft(d);
  const errors = fieldErrors(d);
  const setF = (k: FieldKey, v: string) => setDraft({ f: { ...d.f, [k]: v }, typical: false });
  const ampsToggle = (
    <button
      type="button"
      onClick={() => setDraft({ ampsIsMilli: !d.ampsIsMilli })}
      aria-label={`Unit: ${d.ampsIsMilli ? "milliamps" : "amps"}. Switch`}
      className="rounded-md bg-track px-2 py-1 font-mono text-xs font-bold text-ink"
    >
      {d.ampsIsMilli ? "mA" : "A"} ⇄
    </button>
  );
  const adapterLine = () => {
    const max = adapterMaxW(draftRating({ ...d, method: "volts_amps", typical: false }));
    if (!max) return null;
    return (
      <span className="font-mono text-[13px] text-body-2">
        Max {fmtDraw(max)}W · typical use ~{fmtDraw(max * ADAPTER_TYPICAL_FACTOR[1])}W
      </span>
    );
  };
  const nf = (k: FieldKey, label: string, unit: ReactNode, optional?: boolean) => (
    <NumField d={d} setF={setF} k={k} label={label} unit={unit} errors={errors} optional={optional} />
  );

  let body: ReactNode = null;
  switch (d.method) {
    case "watts":
      body =
        p?.kind === "microwave" ? (
          <>
            <div className="flex gap-2.5">
              {nf("watts", "Input W", "W")}
              {nf("outputW", "Output W", "W")}
            </div>
            <span className={hint}>
              Microwaves often show cooking (output) power. Use input if both are there; only output? We&apos;ll work
              out the input.
            </span>
          </>
        ) : (
          <>
            {nf("watts", "Power", "W")}
            <span className={hint}>{p?.help && p.kind === "workload" ? p.help : "Usually on a sticker at the back or bottom."}</span>
            {p?.fallback && (
              <button type="button" className={linkBtn} onClick={() => setDraft({ method: "kwh_year" })}>
                I have the energy label (kWh/year)
              </button>
            )}
          </>
        );
      break;
    case "volts_amps": {
      const laptop = p?.kind === "laptop";
      body = (
        <>
          <div className="flex gap-2.5">
            {nf("volts", laptop ? "Charger V" : "Volts", "V", laptop)}
            {nf("amps", laptop ? "Charger A" : "Amps", ampsToggle, laptop)}
          </div>
          <span className={hint}>
            Use the line with ⎓ (output), not 100–240V.
            {laptop ? " We use it to cap the estimate; how hard you work the laptop matters more." : ""}
          </span>
          {!laptop && adapterLine()}
        </>
      );
      break;
    }
    case "battery": {
      const mifi = d.usage.profile === "always_on_battery";
      body = (
        <>
          <div className="flex items-end gap-2.5">
            {d.battUnit === "mAh" ? nf("mAh", "Battery", "mAh") : nf("wh", "Battery", "Wh")}
            <div className="w-[120px] shrink-0">
              <Seg
                label="Battery unit"
                options={[["mAh", "mAh"], ["Wh", "Wh"]] as const}
                value={d.battUnit}
                onChange={(u) => setDraft({ battUnit: u })}
              />
            </div>
          </div>
          <span className={hint}>On the battery, the back of the device or in Settings → About.</span>
          {mifi && (
            <>
              {nf("batteryLifeHours", "How long does it last on battery?", "h", true)}
              <span className={hint}>When light goes, how many hours until it switches off?</span>
              <div className="flex gap-2.5">
                {nf("volts", "Adapter V", "V", true)}
                {nf("amps", "Adapter A", ampsToggle, true)}
              </div>
              <span className={hint}>
                The rating on the body or adapter is a maximum, not what it uses. Battery life gives a better estimate.
              </span>
            </>
          )}
          <div className="flex flex-col gap-2 border-t border-track pt-2">
            <button
              type="button"
              aria-expanded={d.adv}
              onClick={() => setDraft({ adv: !d.adv })}
              className="flex h-9 items-center justify-between text-sm font-semibold"
            >
              <span>Advanced · battery voltage</span>
              <span className="font-mono text-[13px] text-muted">{d.adv ? "▴" : "▾"}</span>
            </button>
            {d.adv && (
              <>
                {nf("nominalVolts", "Nominal voltage", "V")}
                <span className={hint}>Most phone and power bank cells are 3.7–3.85V. Only change this if the label says so.</span>
              </>
            )}
          </div>
        </>
      );
      break;
    }
    case "hp_btu": {
      const ac = d.hpKind === "ac_cooling";
      body =
        d.hpMode === "rated" ? (
          <>
            {nf("ratedW", "Rated power input", "W")}
            <span className={hint}>On the label it may say &ldquo;Rated input power&rdquo; or &ldquo;Power input&rdquo;.</span>
            <button type="button" className={linkBtn} onClick={() => setDraft({ hpMode: ac ? "btu" : "hp" })}>
              {ac ? "I only see HP / BTU" : "I only see HP"}
            </button>
          </>
        ) : (
          <>
            {ac && (
              <Seg
                label="Capacity unit"
                options={[["btu", "BTU"], ["hp", "HP"]] as const}
                value={d.hpMode === "hp" ? "hp" : "btu"}
                onChange={(m) => setDraft({ hpMode: m })}
              />
            )}
            {d.hpMode === "hp" ? nf("hp", ac ? "Cooling capacity" : "Motor power", "HP") : nf("btu", "Cooling capacity", "BTU")}
            <span className={hint}>
              {ac
                ? "HP and BTU describe cooling, not electricity. We convert it to the power it draws."
                : "Motors draw more than their HP because they lose some power as heat."}
            </span>
            <button type="button" className={linkBtn} onClick={() => setDraft({ hpMode: "rated" })}>
              I can see the rated power input (W)
            </button>
          </>
        );
      break;
    }
    case "kwh_year":
      body = (
        <>
          {nf("kwhPerYear", "Energy use", "kWh/yr")}
          <span className={hint}>Look for the energy label (stars); it shows kWh per year.</span>
          {p?.fallback && (
            <button
              type="button"
              className={linkBtn}
              onClick={() => setDraft({ method: "watts", usage: { ...d.usage, dutyPercent: p.fallback!.duty } })}
            >
              No energy label?
            </button>
          )}
        </>
      );
      break;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {body}
      {p?.label.hpKind === "ac_cooling" && (
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">Inverter AC</span>
            <span className={hint}>Says &ldquo;inverter&rdquo; on the label or remote</span>
          </span>
          <input
            type="checkbox"
            checked={!!d.usage.inverter}
            onChange={(e) =>
              setDraft({ usage: { ...d.usage, inverter: e.target.checked, dutyPercent: e.target.checked ? 50 : 70 } })
            }
            className="h-6 w-6 accent-light"
          />
        </label>
      )}
    </div>
  );
}
