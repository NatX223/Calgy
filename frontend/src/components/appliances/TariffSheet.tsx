"use client";

import { useState } from "react";
import type { Tariff } from "@calgy/engine/appliances";
import { commas, dec, digits, fU, num } from "@calgy/engine/format";
import { CloseButton } from "./Picker";

export function TariffSheet({
  derived,
  tariffOverride,
  onClose,
  onUseDerived,
  onSave,
}: {
  derived: Tariff | null;
  tariffOverride: number | null;
  onClose: () => void;
  onUseDerived: () => void;
  onSave: (v: number) => void;
}) {
  const [amt, setAmt] = useState("10,000");
  const [units, setUnits] = useState("");
  const [direct, setDirect] = useState(tariffOverride ? String(tariffOverride) : "");

  const a = num(digits(amt));
  const u = num(units);
  const value = a && u ? a / u : num(direct);
  const box = "flex h-[50px] items-center gap-1 rounded-xl border-[1.5px] border-line px-3";

  return (
    <>
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[22px] font-extrabold tracking-[-0.025em]">Your tariff</span>
        <CloseButton onClick={onClose} />
      </div>
      <span className="-mt-1.5 text-[15px] leading-[1.45] text-body-2">
        What you really pay per unit (kWh). Calgy never assumes a band price.
      </span>

      {derived && (
        <button
          type="button"
          onClick={onUseDerived}
          aria-pressed={!tariffOverride}
          className={`flex min-h-16 items-center justify-between gap-3 rounded-[14px] border-[1.5px] px-4 py-3 text-left ${
            !tariffOverride ? "border-light bg-light-soft" : "border-line-strong"
          }`}
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold">Use my logged tokens</span>
            <span className="text-[13px] text-muted">{derived.source} · per kWh</span>
          </span>
          <span className="text-lg font-extrabold text-light">₦{fU(derived.value)}</span>
        </button>
      )}

      <div className="flex flex-col gap-2.5 rounded-[14px] bg-paper p-4">
        <span className="text-[15px] font-bold">How many units did your last token give you?</span>
        <div className="grid grid-cols-2 gap-2.5">
          <label className={`${box} bg-card`}>
            <span className="text-base text-muted">₦</span>
            <input
              inputMode="numeric"
              aria-label="Token amount"
              value={amt}
              onChange={(e) => setAmt(commas(e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-[17px] font-bold outline-none"
            />
          </label>
          <label className={`${box} bg-card`}>
            <input
              inputMode="decimal"
              placeholder="0"
              aria-label="Units received"
              value={units}
              onChange={(e) => setUnits(dec(e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-[17px] font-bold outline-none"
            />
            <span className="font-mono text-xs text-muted">units</span>
          </label>
        </div>
        <span className={`font-mono text-[13px] ${a && u ? "text-light" : "text-muted"}`}>
          {a && u ? `= ₦${fU(a / u)} per unit (kWh)` : "Units are printed on your token receipt or SMS."}
        </span>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Or type your rate</span>
        <span className={`${box} bg-paper`}>
          <span className="text-base text-muted">₦</span>
          <input
            inputMode="decimal"
            placeholder="0"
            value={direct}
            onChange={(e) => setDirect(dec(e.target.value))}
            className="min-w-0 flex-1 bg-transparent text-[17px] font-bold outline-none"
          />
          <span className="font-mono text-xs text-muted">per kWh</span>
        </span>
      </label>

      <button
        type="button"
        onClick={() => value && onSave(value)}
        disabled={!value}
        className="h-14 rounded-2xl bg-ink text-base font-extrabold text-card disabled:opacity-40"
      >
        {value ? `Use ₦${fU(value)}/kWh` : "Save tariff"}
      </button>
    </>
  );
}
