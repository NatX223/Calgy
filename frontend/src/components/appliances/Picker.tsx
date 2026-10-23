"use client";

import { CAT_LABEL } from "@/lib/appliances";
import { CATEGORIES, PRESETS, type Preset } from "@/lib/presets";
import { Chip } from "../ui";

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className="h-11 w-11 shrink-0 rounded-xl bg-track-2 text-base">
      ✕
    </button>
  );
}

export function Picker({
  target,
  q,
  cat,
  setPick,
  onClose,
  onPick,
  onCustom,
}: {
  target: "home" | "sim";
  q: string;
  cat: string;
  setPick: (p: { q?: string; cat?: string }) => void;
  onClose: () => void;
  onPick: (p: Preset) => void;
  onCustom: (name: string) => void;
}) {
  const qq = q.trim().toLowerCase();
  const presets = PRESETS.filter(
    (p) =>
      (cat === "all" || p.cat === cat) &&
      (!qq || p.name.toLowerCase().includes(qq) || CAT_LABEL[p.cat].toLowerCase().includes(qq)),
  );
  const chips = [{ id: "all", label: "All" }, ...CATEGORIES.filter((c) => c.id !== "other")];

  return (
    <>
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[22px] font-extrabold tracking-[-0.025em]">
          {target === "sim" ? "Add to simulation" : "Add device"}
        </span>
        <CloseButton onClick={onClose} />
      </div>
      <label className="flex h-[52px] items-center gap-2.5 rounded-[14px] border-[1.5px] border-line bg-paper px-3.5">
        <span className="text-base text-muted" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          placeholder="Search fan, freezer, AC…"
          aria-label="Search devices"
          value={q}
          onChange={(e) => setPick({ q: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>
      <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5">
        {chips.map((c) => (
          <Chip
            key={c.id}
            on={cat === c.id}
            onClick={() => setPick({ cat: c.id })}
            className="h-10 shrink-0 px-3.5 font-sans text-sm font-semibold whitespace-nowrap"
          >
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-col">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="grid min-h-[60px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-track px-0.5 py-2 text-left hover:bg-paper"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-track-2 text-xl">{p.icon}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{p.name}</span>
              <span className="font-mono text-xs text-muted">
                {p.type === "charging"
                  ? `~${p.tiers[1]}Wh per charge`
                  : `~${p.tiers[1].toLocaleString("en-NG")}W${p.type === "cycling" ? " · cycles on/off" : ""}`}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-lg font-semibold text-card"
            >
              +
            </span>
          </button>
        ))}
        {presets.length === 0 && (
          <span className="px-0.5 pt-[18px] pb-1.5 text-sm text-muted">
            No preset for “{q.trim()}”. Add it as a custom device below.
          </span>
        )}
        <button
          type="button"
          onClick={() => onCustom(q.trim())}
          className="mt-2.5 grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-line-strong px-3 py-2.5 text-left"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-track-2 text-xl">🔌</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold">Custom device</span>
            <span className="text-[13px] text-muted">Not listed? Use the watts on its label.</span>
          </span>
        </button>
      </div>
    </>
  );
}
