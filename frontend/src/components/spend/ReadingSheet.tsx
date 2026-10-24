"use client";

import type { RefObject } from "react";
import { dec, fromLocalInput, nowLocalInput } from "@/lib/format";
import { futureError, unitsError } from "@/lib/meter";
import { Note } from "./GenOnboarding";

export type ReadingSheetState = {
  shown: boolean;
  mode: "new" | "edit";
  id: string | null;
  units: string;
  daysLeft: string;
  avg: string;
  /** Show the optional "days left" / "average" fields. */
  more: boolean;
  /** Show the time picker ("Taken earlier?"). */
  earlier: boolean;
  takenAt: string; // datetime-local value
};

export const closedReadingSheet: ReadingSheetState = {
  shown: false, mode: "new", id: null, units: "", daysLeft: "", avg: "", more: false, earlier: false, takenAt: "",
};

export const readingSheetError = (r: ReadingSheetState) =>
  unitsError(r.units) ?? (r.takenAt ? futureError(fromLocalInput(r.takenAt)) : null);

const box = "flex h-[52px] items-center gap-1.5 rounded-xl border-[1.5px] border-line bg-paper px-3.5";

export function ReadingSheet({
  sheet: r,
  setSheet,
  unitsRef,
  onClose,
  onSave,
  onDelete,
}: {
  sheet: ReadingSheetState;
  setSheet: (p: Partial<ReadingSheetState>) => void;
  unitsRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const err = readingSheetError(r);
  const edit = r.mode === "edit";

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-[rgba(25,23,18,0.45)] transition-opacity duration-250 ${
          r.shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={edit ? "Edit meter reading" : "Log meter reading"}
        inert={!r.shown}
        className={`ease-sheet fixed inset-x-0 bottom-0 z-50 transition-transform duration-320 ${
          r.shown ? "pointer-events-auto translate-y-0" : "pointer-events-none translate-y-[110%]"
        }`}
      >
        <div className="mx-auto grid max-h-[92vh] max-w-[480px] grid-cols-1 content-start gap-[18px] overflow-auto rounded-t-[24px] bg-card px-5 pt-2.5 pb-[calc(18px+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(25,23,18,0.18)]">
          <div className="mx-auto h-1 w-10 rounded-sm bg-line" />
          <div className="-mt-1.5 flex items-center justify-between">
            <span className="text-[22px] font-extrabold tracking-[-0.025em]">{edit ? "Edit reading" : "Log meter reading"}</span>
            <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 rounded-xl bg-track-2 text-lg">
              ✕
            </button>
          </div>

          <label className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold">Units left on the meter</span>
            <span className="flex items-center gap-2 border-b-2 border-light pb-1">
              <input
                ref={unitsRef}
                inputMode="decimal"
                placeholder="0.0"
                aria-label="Units left"
                value={r.units}
                onChange={(e) => setSheet({ units: dec(e.target.value) })}
                className="min-w-0 flex-1 bg-transparent p-0 text-[44px] font-extrabold tracking-[-0.035em] outline-none"
              />
              <span className="font-mono text-[15px] text-muted">kWh</span>
            </span>
          </label>

          {r.more ? (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["daysLeft", "Days left", "days"],
                  ["avg", "Daily average", "kWh"],
                ] as const
              ).map(([k, label, unit]) => (
                <label key={k} className="flex min-w-0 flex-col gap-2">
                  <span className="text-sm font-semibold">
                    {label} <span className="font-normal text-muted">· optional</span>
                  </span>
                  <span className={box}>
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      value={r[k]}
                      onChange={(e) => setSheet({ [k]: dec(e.target.value) })}
                      className="min-w-0 flex-1 bg-transparent p-0 text-lg font-bold outline-none"
                    />
                    <span className="font-mono text-[13px] text-muted">{unit}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <button type="button" onClick={() => setSheet({ more: true })} className="-mt-2 self-start text-sm font-semibold text-light">
              + Meter also shows days left or an average?
            </button>
          )}

          {r.earlier ? (
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-sm font-semibold">Taken at</span>
              <input
                type="datetime-local"
                value={r.takenAt}
                max={nowLocalInput()}
                onChange={(e) => setSheet({ takenAt: e.target.value || nowLocalInput() })}
                className="h-[52px] w-full rounded-xl border-[1.5px] border-line bg-paper px-3 text-base font-semibold outline-none"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setSheet({ earlier: true, takenAt: r.takenAt || nowLocalInput() })}
              className="-mt-2 self-start text-sm font-semibold text-muted underline underline-offset-[3px]"
            >
              Taken earlier?
            </button>
          )}

          {err && <Note tone="error">{err}</Note>}

          <div className="flex gap-2.5">
            {edit && (
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
              disabled={err !== null}
              className="h-[58px] flex-1 rounded-2xl bg-light text-[17px] font-extrabold text-white transition-opacity duration-200 disabled:opacity-40"
            >
              {edit ? "Save changes" : "Save reading"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
