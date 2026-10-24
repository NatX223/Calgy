"use client";

import { useState, type ReactNode } from "react";
import {
  CAT_LABEL, canSaveDraft, chargesDown, chargesUp, draftToDevice, drawUnit, fieldErrors, fmtDraw, presetOfDraft,
  visibleFields, type Device, type Draft, type Tariff, type TierKey,
} from "@/lib/appliances";
import { calibrationNotes, sourcesOf, type Side } from "@/lib/calibration";
import { explain, LIMITS, resolveDraw, unusualLabel } from "@/lib/energy";
import { dec, fU, num, trimN } from "@/lib/format";
import { homeSplits, priceHome, splitsOf, supplyNote, toTrio, unitsOf, type Calib, type SimFuel } from "@/lib/home-calibration";
import { Chip, StepButton } from "../ui";
import { CustomSetup, field, LabelFields, Seg, segClass } from "./LabelFields";
import { moneyFor } from "./MyHome";
import { CloseButton } from "./Picker";

const hint = "text-[13px] leading-[1.4] text-muted";

export function DeviceEditor({
  draft: d,
  setDraft,
  calib,
  fuel,
  ctxTotal,
  home,
  onBack,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  setDraft: (p: Partial<Draft>) => void;
  T: Tariff | null;
  calib: Calib;
  fuel: SimFuel;
  /** Typical kWh/day of the context this device joins (My Home or the simulation). */
  ctxTotal: number;
  home: Device[];
  onBack: () => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = presetOfDraft(d);
  const dev = draftToDevice(d);
  const isEdit = d.mode === "edit";
  const split = splitsOf(calib, [{ device: dev, baseId: isEdit ? d.id : null }])[0];
  const dt = toTrio(unitsOf(split));
  // This device's share: light at the tariff plus the fuel its load adds (the gen's idle burn isn't any one device's).
  const money = priceHome(calib, fuel, [split]).rows[0].naira;
  const onLabel = !isEdit && d.step === "label";
  const prev = isEdit ? home.find((x) => x.id === d.id) : undefined;
  const prevTyp = prev ? unitsOf(homeSplits(calib, [prev])[0]).typical : 0;
  // Hours the plain-language explanation caps mains devices at.
  const src = sourcesOf(dev, calib.household);
  const explainHours = !src.includes("gen")
    ? Math.round(calib.G * 2) / 2
    : src.includes("grid")
      ? Math.min(24, calib.G + (calib.H ?? 0))
      : 24;
  const shareBase = ctxTotal - prevTyp + dt.typ;
  const share = shareBase > 0 ? Math.round((dt.typ / shareBase) * 100) : 0;
  const errs = fieldErrors(d);
  const labelOk = !visibleFields(d).some((k) => errs[k]);
  const canSave = canSaveDraft(d);
  const unusual = unusualLabel(dev);

  const title = isEdit
    ? "Edit device"
    : d.isCustom
      ? "Custom device"
      : "Add " + d.name.toLowerCase().replace(/\s*\(.*\)$/, "");

  const back = () => (!isEdit && d.step === "usage" ? setDraft({ step: "label" }) : onBack());

  return (
    <>
      <div className="flex items-center gap-2">
        {(d.fromPicker || (!isEdit && d.step === "usage")) && (
          <button type="button" onClick={back} aria-label="Back" className="h-11 w-11 shrink-0 rounded-xl bg-track-2 text-lg font-semibold">
            ‹
          </button>
        )}
        <span className="min-w-0 flex-1 text-[22px] font-extrabold tracking-[-0.025em]">{title}</span>
        <CloseButton onClick={onClose} />
      </div>

      <div className="flex items-center gap-3">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] bg-track-2 text-[26px]">
          {d.icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            placeholder="Device name"
            aria-label="Device name"
            value={d.name}
            onChange={(e) => setDraft({ name: e.target.value })}
            className={`h-11 px-3 text-base font-semibold outline-none ${field}`}
          />
          <span className="font-mono text-xs text-muted">
            {CAT_LABEL[d.category]}
            {!isEdit && ` · Step ${d.step === "label" ? 2 : 3} of 3`}
          </span>
        </div>
      </div>

      {(isEdit || d.step === "label") && (
        <section className="flex flex-col gap-3">
          <SectionTitle>{isEdit ? "Label values" : "What’s on the label?"}</SectionTitle>
          {d.isCustom && <CustomSetup d={d} setDraft={setDraft} />}
          {p && isEdit && (
            <Seg
              label="Label source"
              options={[["label", "From label"], ["typical", "Use typical"]] as const}
              value={d.typical ? "typical" : "label"}
              onChange={(k) => setDraft({ typical: k === "typical" })}
            />
          )}
          {d.typical && p ? (
            <span className={hint}>
              Using typical values for {p.name.toLowerCase()}: about {fmtDraw(resolveDraw({ ...dev, tierOverride: undefined }).typical)}
              {drawUnit(dev)}
              {dev.usage.profile === "charges" ? " per charge" : ""}. Switch to &ldquo;From label&rdquo; to enter your own.
            </span>
          ) : (
            <LabelFields d={d} setDraft={setDraft} />
          )}
          {unusual && !d.typical && (
            <span className="text-[13px] leading-[1.4] font-medium text-fuel-ink">
              That&apos;s unusual for this device. Double-check the label?
            </span>
          )}
          {p && !isEdit && (
            <button
              type="button"
              onClick={() => setDraft({ typical: true, step: "usage" })}
              className="h-12 rounded-[14px] border-[1.5px] border-line-strong text-[15px] font-bold"
            >
              I don&apos;t know — use typical
            </button>
          )}
        </section>
      )}

      {(isEdit || d.step === "usage") && (
        <section className="flex flex-col gap-3">
          <SectionTitle>{isEdit ? "Usage" : "How you use it"}</SectionTitle>
          <UsageFields d={d} dev={dev} setDraft={setDraft} calib={calib} />
        </section>
      )}

      {isEdit && <TierPicker dev={dev} value={d.tierOverride} onChange={(t) => setDraft({ tierOverride: t })} />}

      {isEdit && (
        <div className="flex flex-col gap-2 border-t border-track pt-3">
          <button
            type="button"
            aria-expanded={d.why}
            onClick={() => setDraft({ why: !d.why })}
            className="flex h-10 items-center justify-between text-[15px] font-semibold"
          >
            <span>How we worked this out</span>
            <span className="font-mono text-[13px] text-muted">{d.why ? "▴" : "▾"}</span>
          </button>
          {d.why && (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.45] text-body-2">
              {[...explain(dev, explainHours), ...calibrationNotes(dev, calib.result, calib.enabled)].map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-[18px] bg-ink px-[18px] py-4 text-card">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-col gap-[3px]">
            <span className="font-mono text-[11px] tracking-[0.08em] text-ink-muted uppercase">
              {money ? "This device · per month" : "This device · units per month"}
            </span>
            <span className="text-3xl leading-none font-extrabold tracking-[-0.04em]">
              {money ? "~" + moneyFor(money.typical, 30) : `~${fU(dt.typ * 30)} units`}
            </span>
            <span className="font-mono text-xs text-ink-muted">
              {money ? `${moneyFor(money.low, 30)} – ${moneyFor(money.high, 30)}` : `${fU(dt.lo * 30)} – ${fU(dt.hi * 30)} units`}
            </span>
          </div>
          <span className="text-sm font-bold text-fuel">
            {dt.typ > 0 ? (isEdit ? `${share}% of your usage` : `would be ${share}% of your usage`) : ""}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-t border-ink-line pt-2.5 font-mono text-xs text-ink-muted">
          <span>~{fU(dt.typ)} units a day</span>
          <span>~{fU(dt.typ * 30)} units a month</span>
          {calib.household === "hybrid" && (
            <span className="col-span-2">
              From light: {fU(split.grid.typical * 30)} units/month · From gen: {fU(split.gen.typical * 30)} units/month
            </span>
          )}
        </div>
      </div>

      {confirmDelete ? (
        <div className="flex flex-col gap-2.5 rounded-[14px] bg-red-soft p-3.5">
          <span className="text-[15px] font-bold">Delete {d.name || "this device"}?</span>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-12 rounded-[14px] border-[1.5px] border-line-strong bg-card text-[15px] font-bold"
            >
              Cancel
            </button>
            <button type="button" autoFocus onClick={onDelete} className="h-12 rounded-[14px] bg-red text-[15px] font-bold text-white">
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2.5">
          {isEdit && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="h-14 rounded-2xl border-[1.5px] border-red px-[18px] text-[15px] font-bold text-red"
            >
              Delete
            </button>
          )}
          {onLabel ? (
            <button
              type="button"
              onClick={() => setDraft({ step: "usage", typical: d.typical })}
              disabled={!labelOk || (d.isCustom && !canSave)}
              className="h-14 flex-1 rounded-2xl bg-ink text-base font-extrabold text-card disabled:opacity-40"
            >
              Next: how you use it
            </button>
          ) : (
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="h-14 flex-1 rounded-2xl bg-light text-base font-extrabold text-white disabled:opacity-40"
            >
              {isEdit ? "Save changes" : d.target === "sim" ? "Add to simulation" : "Add to My Home"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="border-b-[1.5px] border-ink pb-1.5 text-[17px] font-extrabold tracking-[-0.01em]">{children}</span>;
}

/** Step 3 — usage fields for the device's profile. */
const RUNS_ON: { id: "grid" | "gen" | "both"; label: string; sources: Side[] }[] = [
  { id: "grid", label: "Light", sources: ["grid"] },
  { id: "gen", label: "Gen", sources: ["gen"] },
  { id: "both", label: "Both", sources: ["grid", "gen"] },
];

function UsageFields({
  d,
  dev,
  setDraft,
  calib,
}: {
  d: Draft;
  dev: Device;
  setDraft: (p: Partial<Draft>) => void;
  calib: Calib;
}) {
  const p = presetOfDraft(d);
  const u = d.usage;
  const setU = (patch: Partial<Draft["usage"]>) => setDraft({ usage: { ...u, ...patch } });
  const warn = supplyNote(dev, calib);
  const runsOn = sourcesOf(dev, calib.household);
  const kwhBased = dev.rating.method === "kwh_year" || (dev.rating.method === "preset_only" && p?.method === "kwh_year");
  const duty = u.dutyPercent ?? 100;
  const workload = p?.kind === "laptop" || p?.kind === "workload";

  return (
    <>
      {calib.household === "hybrid" && (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">Runs on</span>
          <div role="radiogroup" aria-label="Runs on" className="flex gap-2">
            {RUNS_ON.map((o) => (
              <Chip
                key={o.id}
                on={(runsOn.length === 2 ? "both" : runsOn[0]) === o.id}
                onClick={() => setDraft({ powerSources: o.sources })}
                className="h-11 flex-1 px-3 text-sm"
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {(u.profile === "steady" || u.profile === "cycling") && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold whitespace-nowrap">Hours a day</span>
            <label className={`flex h-11 items-center gap-1 px-3 ${field}`}>
              <input
                inputMode="decimal"
                aria-label="Hours a day"
                value={d.f.hours ?? ""}
                onChange={(e) => {
                  const v = dec(e.target.value);
                  setDraft({ f: { ...d.f, hours: num(v) > 24 ? "24" : v } });
                }}
                className="w-[52px] bg-transparent text-right text-[17px] font-bold outline-none"
              />
              <span className="text-sm text-muted">h</span>
            </label>
          </div>
          <input
            type="range"
            min={0}
            max={24}
            step={0.5}
            aria-label="Hours a day"
            value={num(d.f.hours)}
            onChange={(e) => setDraft({ f: { ...d.f, hours: e.target.value } })}
            className="m-0 h-10 w-full accent-light"
          />
          {p?.help && p.kind !== "workload" && <span className={hint}>{p.help}</span>}
          {warn && <span className="text-[13px] leading-[1.4] font-medium text-fuel-ink">{warn}</span>}
        </div>
      )}

      {u.profile === "charges" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">Charges a day</span>
              <span className="text-[13px] text-muted">0.6 = topping up from 20% to 80%</span>
            </div>
            <div className="flex items-center gap-1">
              <StepButton label="Fewer charges" onClick={() => setU({ chargesPerDay: chargesDown(u.chargesPerDay ?? 0) })}>
                −
              </StepButton>
              <span className="min-w-10 text-center text-lg font-extrabold">{trimN(u.chargesPerDay ?? 0)}</span>
              <StepButton label="More charges" onClick={() => setU({ chargesPerDay: chargesUp(u.chargesPerDay ?? 0) })}>
                +
              </StepButton>
            </div>
          </div>
          {p?.nominal === "phone" && (
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-[15px] font-semibold">Wireless charging</span>
              <input
                type="checkbox"
                checked={!!u.wireless}
                onChange={(e) => setU({ wireless: e.target.checked })}
                className="h-6 w-6 accent-light"
              />
            </label>
          )}
        </>
      )}

      {u.profile === "always_on_battery" && (
        <span className="rounded-xl bg-track-2 px-3.5 py-3 text-sm leading-[1.4]">
          Plugged in all day. Runs on its battery when light goes, and refills when light comes back.
        </span>
      )}

      {workload && (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">How hard do you work it?</span>
          <Seg
            label="Workload"
            options={[["light", "Light"], ["moderate", "Moderate"], ["heavy", "Heavy"]] as const}
            value={u.workload ?? "moderate"}
            onChange={(w) => setU({ workload: w })}
          />
          <span className={hint}>
            {u.workload === "light"
              ? "Browsing, documents."
              : u.workload === "heavy"
                ? "Gaming, rendering, video editing."
                : "Streaming, calls, coding."}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">Quantity</span>
        <div className="flex items-center gap-1">
          <StepButton label="Fewer" onClick={() => setDraft({ quantity: Math.max(LIMITS.quantity[0], d.quantity - 1) })}>
            −
          </StepButton>
          <span className="min-w-10 text-center text-lg font-extrabold">{d.quantity}</span>
          <StepButton label="More" onClick={() => setDraft({ quantity: Math.min(LIMITS.quantity[1], d.quantity + 1) })}>
            +
          </StepButton>
        </div>
      </div>

      {u.profile === "cycling" && !kwhBased && (
        <div className="flex flex-col gap-2 border-t border-track pt-3">
          <button
            type="button"
            aria-expanded={d.adv}
            onClick={() => setDraft({ adv: !d.adv })}
            className="flex h-10 items-center justify-between text-[15px] font-semibold"
          >
            <span>Advanced · running time</span>
            <span className="font-mono text-[13px] text-muted">
              {duty}% {d.adv ? "▴" : "▾"}
            </span>
          </button>
          {d.adv && (
            <>
              <span className="text-[13px] leading-[1.45] text-pretty text-muted">
                Fridges and ACs switch on and off; they don&apos;t draw power the whole time. {duty}% (duty cycle) means
                it&apos;s actually running for about {Math.round((duty / 100) * 60)} minutes of every hour.
              </span>
              <input
                type="range"
                min={LIMITS.dutyPercent[0]}
                max={LIMITS.dutyPercent[1]}
                step={5}
                aria-label="Duty cycle"
                value={duty}
                onChange={(e) => setU({ dutyPercent: +e.target.value })}
                className="m-0 h-10 w-full accent-light"
              />
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Low / Typical / High pin (tap the pinned one again to go back to the full range). */
export function TierPicker({
  dev,
  value,
  onChange,
  compact,
}: {
  dev: Device;
  value: TierKey | undefined;
  onChange: (t: TierKey | undefined) => void;
  compact?: boolean;
}) {
  const r = resolveDraw({ ...dev, tierOverride: undefined });
  const unit = drawUnit(dev) + (dev.usage.profile === "charges" ? "/charge" : "");
  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{dev.usage.profile === "charges" ? "Energy per charge" : "Power draw"}</span>
          <span className={hint}>
            {value ? "Pinned. Tap it again to show the full range." : "Showing the full range. Pin one if you know better."}
          </span>
        </div>
      )}
      <div className={`grid grid-cols-3 gap-1 rounded-xl p-1 ${compact ? "bg-track" : "bg-track-2"}`}>
        {(["low", "typical", "high"] as TierKey[]).map((tk) => (
          <button
            key={tk}
            type="button"
            aria-pressed={value === tk}
            onClick={() => onChange(value === tk ? undefined : tk)}
            className={`flex min-h-12 flex-col items-center justify-center gap-px rounded-[9px] ${segClass(value === tk)}`}
          >
            <span className="text-[13px] font-bold capitalize">{tk}</span>
            <span className="font-mono text-[11px]">
              {fmtDraw(r[tk])}
              {unit}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
