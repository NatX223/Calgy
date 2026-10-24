"use client";

import type { RefObject } from "react";
import { commas, dec, digits, fromLocalInput, naira, nowLocalInput, num, todayIso, trim } from "@/lib/format";
import { futureError, unitsError } from "@/lib/meter";
import { byNewest, type Entry, type EntryType } from "@/lib/spend";
import { Chip, Eyebrow } from "../ui";
import { Note } from "./GenOnboarding";

export type SheetState = {
  shown: boolean;
  mode: "new" | "edit";
  id: string | null;
  type: EntryType;
  amount: string;
  qty: string;
  hours: string; // gen hours, fuel only
  date: string;
  note: string;
  /** Token: units on the meter just before loading (new tokens only). */
  before: string;
  skipBefore: boolean;
  /** Token: when it was loaded (datetime-local value). */
  loadedAt: string;
  /** Left untouched, a new token is stamped with the exact save time (the input only has minutes). */
  loadedAtEdited: boolean;
};

/** Blocking problem with the token-only fields, or null. */
export const tokenFieldsError = (sh: SheetState, askBefore: boolean) =>
  sh.type !== "token"
    ? null
    : (askBefore && !sh.skipBefore && sh.before.trim() ? unitsError(sh.before) : null) ??
      (sh.loadedAt ? futureError(fromLocalInput(sh.loadedAt)) : null);

export function LogSheet({
  sheet: sh,
  setSheet,
  entries,
  showHours,
  askMeter = false,
  nudge = false,
  beforeRef,
  amountRef,
  onClose,
  onSave,
  onDelete,
}: {
  sheet: SheetState;
  setSheet: (p: Partial<SheetState>) => void;
  entries: Entry[];
  /** Ask how long the fuel ran the gen (once a generator is set up). */
  showHours: boolean;
  /** Prepaid homes: ask for the meter before a new token, and nudge after repeated skips. */
  askMeter?: boolean;
  nudge?: boolean;
  beforeRef?: RefObject<HTMLInputElement | null>;
  amountRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const isFuel = sh.type === "fuel";
  const amt = num(digits(sh.amount));
  const q = num(sh.qty);
  const askBefore = !isFuel && sh.mode === "new" && askMeter;
  const tokErr = tokenFieldsError(sh, askBefore);

  const lastOf = entries.filter((e) => e.type === sh.type && e.id !== sh.id).sort(byNewest)[0];
  const chips: { label: string; v: number }[] = [];
  if (lastOf) chips.push({ label: "Last " + naira(lastOf.amount_naira), v: lastOf.amount_naira });
  [5000, 10000, 20000]
    .filter((v) => !lastOf || v !== lastOf.amount_naira)
    .forEach((v) => chips.push({ label: naira(v), v }));

  const derived =
    amt && q
      ? isFuel
        ? `= ₦${Math.round(amt / q).toLocaleString("en-NG")} per litre`
        : `= ₦${trim((amt / q).toFixed(1))}/kWh · your effective tariff`
      : isFuel
        ? "Add litres to track your pump price"
        : "Add units received to work out your real tariff";
  const derivedClass = amt && q ? (isFuel ? "text-fuel-ink" : "text-light") : "text-muted";
  const accent = isFuel ? "bg-fuel text-ink" : "bg-light text-white";

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-[rgba(25,23,18,0.45)] transition-opacity duration-250 ${
          sh.shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sh.mode === "edit" ? "Edit entry" : isFuel ? "Log fuel" : "Log token"}
        inert={!sh.shown}
        className={`ease-sheet fixed inset-x-0 bottom-0 z-50 transition-transform duration-320 ${
          sh.shown ? "pointer-events-auto translate-y-0" : "pointer-events-none translate-y-[110%]"
        }`}
      >
        <div className="mx-auto grid max-h-[92vh] max-w-[480px] grid-cols-1 content-start gap-[18px] overflow-auto rounded-t-[24px] bg-card px-5 pt-2.5 pb-[calc(18px+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(25,23,18,0.18)]">
          <div className="mx-auto h-1 w-10 rounded-sm bg-line" />
          <div className="-mt-1.5 flex items-center justify-between">
            <span className="text-[22px] font-extrabold tracking-[-0.025em]">
              {sh.mode === "edit" ? "Edit entry" : isFuel ? "Log fuel" : "Log token"}
            </span>
            <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 rounded-xl bg-track-2 text-lg">
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-track-2 p-1">
            <button
              type="button"
              onClick={() => setSheet({ type: "fuel" })}
              aria-pressed={isFuel}
              className={`h-11 rounded-[10px] text-[15px] font-bold text-ink ${isFuel ? "bg-fuel" : ""}`}
            >
              Fuel
            </button>
            <button
              type="button"
              onClick={() => setSheet({ type: "token" })}
              aria-pressed={!isFuel}
              className={`h-11 rounded-[10px] text-[15px] font-bold ${isFuel ? "text-ink" : "bg-light text-white"}`}
            >
              Token
            </button>
          </div>

          {askBefore &&
            (sh.skipBefore ? (
              <button
                type="button"
                onClick={() => setSheet({ skipBefore: false })}
                className="-my-1 self-start text-sm font-semibold text-light"
              >
                + Add what the meter shows before loading
              </button>
            ) : (
              <div className="flex flex-col gap-2 rounded-[14px] bg-light-soft p-3.5">
                <span className="text-[15px] font-bold">Before you load it, what does the meter show?</span>
                <div className="flex items-center gap-2">
                  <span className="flex h-[52px] flex-1 items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-card px-3.5">
                    <input
                      ref={beforeRef}
                      inputMode="decimal"
                      placeholder="0.0"
                      aria-label="Units left before loading"
                      value={sh.before}
                      onChange={(e) => setSheet({ before: dec(e.target.value) })}
                      className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
                    />
                    <span className="font-mono text-[13px] text-muted">kWh left</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSheet({ skipBefore: true, before: "" })}
                    className="h-[52px] shrink-0 px-2 text-sm font-semibold text-muted"
                  >
                    Skip this time
                  </button>
                </div>
                {nudge && (
                  <span className="text-[13px] text-body-2">One number before loading makes your estimates much more accurate.</span>
                )}
              </div>
            ))}

          <div className="flex flex-col gap-2.5">
            <Eyebrow>Amount paid</Eyebrow>
            <div
              className={`flex items-center gap-2 border-b-2 pb-1 ${isFuel ? "border-fuel" : "border-light"}`}
            >
              <span className="text-[40px] font-bold text-muted">₦</span>
              <input
                ref={amountRef}
                inputMode="numeric"
                placeholder="0"
                aria-label="Amount paid"
                value={sh.amount}
                onChange={(e) => setSheet({ amount: commas(e.target.value) })}
                className="min-w-0 flex-1 bg-transparent p-0 text-[44px] font-extrabold tracking-[-0.035em] outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <Chip key={c.label} on={amt === c.v} onClick={() => setSheet({ amount: commas(c.v) })} className="h-11 px-3.5 text-[13px]">
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-sm font-semibold">
                {isFuel ? "Litres" : "Units received"} <span className="font-normal text-muted">· optional</span>
              </span>
              <span className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={sh.qty}
                  onChange={(e) => setSheet({ qty: dec(e.target.value) })}
                  className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
                />
                <span className="font-mono text-[13px] text-muted">{isFuel ? "L" : "kWh"}</span>
              </span>
            </label>
            {isFuel ? (
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-sm font-semibold">Date</span>
                <input
                  type="date"
                  value={sh.date}
                  max={todayIso()}
                  onChange={(e) => setSheet({ date: e.target.value || todayIso() })}
                  className="h-[52px] w-full rounded-xl border-[1.5px] border-line bg-paper px-3 text-base font-semibold outline-none"
                />
              </label>
            ) : (
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-sm font-semibold">Loaded at</span>
                <input
                  type="datetime-local"
                  value={sh.loadedAt}
                  max={nowLocalInput()}
                  onChange={(e) => setSheet({ loadedAt: e.target.value || nowLocalInput(), loadedAtEdited: true })}
                  className="h-[52px] w-full min-w-0 rounded-xl border-[1.5px] border-line bg-paper px-2 text-[15px] font-semibold outline-none"
                />
              </label>
            )}
          </div>
          <span className={`-mt-1.5 font-mono text-[13px] ${derivedClass}`}>{derived}</span>

          {isFuel && showHours && (
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-sm font-semibold">
                Hours it ran the gen <span className="font-normal text-muted">· optional</span>
              </span>
              <span className="flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={sh.hours}
                  onChange={(e) => setSheet({ hours: dec(e.target.value) })}
                  className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
                />
                <span className="font-mono text-[13px] text-muted">hours</span>
              </span>
              <span className="text-[13px] text-muted">
                {q ? "Sharpens your gen cost per hour." : "Add litres too so this counts toward your gen numbers."}
              </span>
            </label>
          )}

          <input
            placeholder="Note (optional) — e.g. station dry, bought by roadside"
            aria-label="Note"
            value={sh.note}
            onChange={(e) => setSheet({ note: e.target.value })}
            className="h-12 rounded-xl border-[1.5px] border-line bg-paper px-3.5 text-[15px] outline-none"
          />

          {tokErr && <Note tone="error">{tokErr}</Note>}

          <div className="flex gap-2.5">
            {sh.mode === "edit" && (
              <button
                type="button"
                onClick={onDelete}
                className="h-[58px] rounded-2xl border-[1.5px] border-red px-[18px] text-base font-bold text-red"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!amt || tokErr !== null}
              className={`h-[58px] flex-1 rounded-2xl text-[17px] font-extrabold transition-opacity duration-200 disabled:opacity-40 ${accent}`}
            >
              {sh.mode === "edit" ? "Save changes" : amt ? `Save ${naira(amt)}` : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
