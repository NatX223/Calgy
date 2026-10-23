"use client";

import {
  CAT_LABEL, chargesDown, chargesUp, supplyWarning, trio, watts,
  type Device, type Draft, type Tariff, type Tier,
} from "@/lib/appliances";
import { dec, fU, num, trimN } from "@/lib/format";
import type { UsageType } from "@/lib/presets";
import { StepButton } from "../ui";
import { costFor } from "./MyHome";
import { CloseButton } from "./Picker";

const TYPE_HELP: Record<UsageType, string> = {
  steady: "Draws power the whole time it’s on — fans, TVs, bulbs.",
  cycling: "Switches itself on and off — fridges, ACs, irons.",
  charging: "You charge it, then use it unplugged — phones, laptops, lamps.",
};

const segClass = (on: boolean) => (on ? "bg-card text-ink" : "bg-transparent text-ink");
const field = "rounded-xl border-[1.5px] border-line bg-paper";

export function DeviceEditor({
  draft: d,
  setDraft,
  T,
  gridHours,
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
  gridHours: number;
  /** Typical kWh/day of the context this device joins (My Home or the simulation). */
  ctxTotal: number;
  home: Device[];
  onBack: () => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const cost = costFor(T);
  const dt = trio(d);
  const isEdit = d.mode === "edit";
  const prevTyp = isEdit ? trio(home.find((x) => x.id === d.id) ?? d).typ : 0;
  const shareBase = ctxTotal - prevTyp + dt.typ;
  const share = shareBase > 0 ? Math.round((dt.typ / shareBase) * 100) : 0;
  const unitW = d.type === "charging" ? "Wh" : "W";
  const warn = supplyWarning(d, gridHours);
  const canSave = num(d.qty) >= 1 && watts(d) > 0;
  const advOpen = d.adv || d.isCustom;
  const duty = num(d.duty);

  const title = isEdit
    ? "Edit device"
    : d.isCustom
      ? "Custom device"
      : "Add " + d.name.toLowerCase().replace(/\s*\(.*\)$/, "");

  return (
    <>
      <div className="flex items-center gap-2">
        {d.fromPicker && (
          <button type="button" onClick={onBack} aria-label="Back" className="h-11 w-11 shrink-0 rounded-xl bg-track-2 text-lg font-semibold">
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
            {CAT_LABEL[d.cat]} · {d.type === "steady" ? "Steady" : d.type === "cycling" ? "Cycles on and off" : "Charging"}
          </span>
        </div>
      </div>

      {d.isCustom && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">How it uses power</span>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-track-2 p-1">
              {(
                [
                  ["steady", "Steady"],
                  ["cycling", "Cycling"],
                  ["charging", "Charging"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={d.type === k}
                  onClick={() => setDraft({ type: k })}
                  className={`h-11 rounded-[9px] text-sm font-bold ${segClass(d.type === k)}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <span className="text-[13px] leading-[1.4] text-muted">{TYPE_HELP[d.type]}</span>
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{d.type === "charging" ? "Energy per full charge" : "Power draw"}</span>
            <span className={`flex h-[52px] items-center gap-1.5 px-3.5 ${field}`}>
              <input
                inputMode="decimal"
                placeholder="0"
                value={String(d.custom ?? "")}
                onChange={(e) => setDraft({ custom: dec(e.target.value) })}
                className="min-w-0 flex-1 bg-transparent text-lg font-bold outline-none"
              />
              <span className="font-mono text-[13px] text-muted">{unitW}</span>
            </span>
            <span className="text-[13px] text-muted">From the label on your device or its charger.</span>
          </label>
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">Quantity</span>
        <div className="flex items-center gap-1">
          <StepButton label="Fewer" onClick={() => setDraft({ qty: Math.max(1, num(d.qty) - 1) })}>
            −
          </StepButton>
          <span className="min-w-10 text-center text-lg font-extrabold">{num(d.qty)}</span>
          <StepButton label="More" onClick={() => setDraft({ qty: Math.min(99, num(d.qty) + 1) })}>
            +
          </StepButton>
        </div>
      </div>

      {d.type === "charging" ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">Charges a day</span>
            <span className="text-[13px] text-muted">0.5 = half a charge</span>
          </div>
          <div className="flex items-center gap-1">
            <StepButton label="Fewer charges" onClick={() => setDraft({ charges: chargesDown(num(d.charges)) })}>
              −
            </StepButton>
            <span className="min-w-10 text-center text-lg font-extrabold">{trimN(num(d.charges))}</span>
            <StepButton label="More charges" onClick={() => setDraft({ charges: chargesUp(num(d.charges)) })}>
              +
            </StepButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold whitespace-nowrap">Hours a day</span>
            <label className={`flex h-11 items-center gap-1 px-3 ${field}`}>
              <input
                inputMode="decimal"
                aria-label="Hours a day"
                value={String(d.hours)}
                onChange={(e) => {
                  const v = dec(e.target.value);
                  setDraft({ hours: num(v) > 24 ? 24 : v });
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
            value={num(d.hours)}
            onChange={(e) => setDraft({ hours: +e.target.value })}
            className="m-0 h-10 w-full accent-light"
          />
          {d.help && <span className="text-[13px] text-muted">{d.help}</span>}
          {warn && <span className="text-[13px] leading-[1.4] font-medium text-fuel-ink">{warn}</span>}
        </div>
      )}

      {d.tiers && (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">{d.type === "charging" ? "Energy per charge" : "Power draw"}</span>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-track-2 p-1">
            {(["low", "typical", "high"] as Tier[]).map((tk, i) => (
              <button
                key={tk}
                type="button"
                aria-pressed={d.tier === tk}
                onClick={() => setDraft({ tier: tk })}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[9px] px-0.5 ${segClass(d.tier === tk)}`}
              >
                <span className="text-[13px] font-bold capitalize">{tk}</span>
                <span className="font-mono text-[11px]">
                  {d.tiers![i].toLocaleString("en-NG")}
                  {unitW}
                </span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={d.tier === "custom"}
              onClick={() => setDraft({ tier: "custom", custom: d.custom || String(d.tiers![1]) })}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[9px] px-0.5 ${segClass(d.tier === "custom")}`}
            >
              <span className="text-[13px] font-bold">Custom</span>
              <span className="font-mono text-[11px]">
                {d.tier === "custom" && num(d.custom) ? num(d.custom) + unitW : "—"}
              </span>
            </button>
          </div>
          {d.tier === "custom" && (
            <span className={`flex h-12 items-center gap-1.5 px-3.5 ${field}`}>
              <input
                inputMode="decimal"
                placeholder="From the label on my device"
                aria-label={d.type === "charging" ? "Energy per charge" : "Power draw"}
                value={String(d.custom ?? "")}
                onChange={(e) => setDraft({ custom: dec(e.target.value) })}
                className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
              />
              <span className="font-mono text-[13px] text-muted">{unitW}</span>
            </span>
          )}
        </div>
      )}

      {d.type === "cycling" && (
        <div className="flex flex-col gap-2 border-t border-track pt-3">
          <button
            type="button"
            aria-expanded={advOpen}
            onClick={() => setDraft({ adv: !d.adv })}
            className="flex h-10 items-center justify-between text-[15px] font-semibold"
          >
            <span>Advanced · duty cycle</span>
            <span className="font-mono text-[13px] text-muted">
              {duty}% {advOpen ? "▴" : "▾"}
            </span>
          </button>
          {advOpen && (
            <>
              <span className="text-[13px] leading-[1.45] text-pretty text-muted">
                Fridges, ACs and irons switch on and off — they don&apos;t pull power the whole time they&apos;re plugged in.{" "}
                {duty}% means it&apos;s actually drawing power for about {Math.round((duty / 100) * 60)} minutes of every
                hour.
              </span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                aria-label="Duty cycle"
                value={duty}
                onChange={(e) => setDraft({ duty: +e.target.value })}
                className="m-0 h-10 w-full accent-light"
              />
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-[18px] bg-ink px-[18px] py-4 text-card">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-col gap-[3px]">
            <span className="font-mono text-[11px] tracking-[0.08em] text-ink-muted uppercase">
              {T ? "This device · per month" : "This device · units per month"}
            </span>
            <span className="text-3xl leading-none font-extrabold tracking-[-0.04em]">
              {T ? "~" + cost(dt.typ, 30) : `~${fU(dt.typ * 30)} units`}
            </span>
            <span className="font-mono text-xs text-ink-muted">
              {T ? `${cost(dt.lo, 30)} – ${cost(dt.hi, 30)}` : `${fU(dt.lo * 30)} – ${fU(dt.hi * 30)} units`}
            </span>
          </div>
          <span className="text-sm font-bold text-fuel">
            {dt.typ > 0 ? (isEdit ? `${share}% of your usage` : `would be ${share}% of your usage`) : ""}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-t border-ink-line pt-2.5 font-mono text-xs text-ink-muted">
          <span>{fU(dt.typ)} units a day</span>
          <span>{fU(dt.typ * 30)} units a month</span>
        </div>
      </div>

      <div className="flex gap-2.5">
        {isEdit && (
          <button
            type="button"
            onClick={onDelete}
            className="h-14 rounded-2xl border-[1.5px] border-red px-[18px] text-[15px] font-bold text-red"
          >
            Delete
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="h-14 flex-1 rounded-2xl bg-light text-base font-extrabold text-white disabled:opacity-40"
        >
          {isEdit ? "Save changes" : d.target === "sim" ? "Add to simulation" : "Add to My Home"}
        </button>
      </div>
    </>
  );
}
