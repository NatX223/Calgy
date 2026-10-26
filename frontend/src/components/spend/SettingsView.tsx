"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { nice, short } from "@calgy/engine/format";
import type { Settings } from "@calgy/engine/spend";
import { Eyebrow, StepButton } from "../ui";

function Card({ children, className = "flex-col gap-2.5" }: { children: ReactNode; className?: string }) {
  return <div className={`flex rounded-[18px] border border-line bg-card p-[18px] ${className}`}>{children}</div>;
}

export function SettingsView({
  entryCount,
  settings: S,
  genLine,
  hours,
  onBack,
  onRedo,
  onHours,
  onHoursAuto,
  onCalibrate,
  onSample,
  onErase,
  demo = false,
}: {
  entryCount: number;
  settings: Settings;
  genLine?: string;
  /** Light hours the numbers use, and where they come from. */
  hours: { value: number | null; source: Settings["gridHoursSource"] } | null;
  onBack: () => void;
  onRedo: () => void;
  onHours: (delta: number) => void;
  onHoursAuto: () => void;
  onCalibrate: (on: boolean) => void;
  onSample: () => void;
  onErase: () => void;
  /** Landing-page demo: no account. */
  demo?: boolean;
}) {
  const [confirmErase, setConfirmErase] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);

  const guess = ((S.fuelWeekly || 0) * 52) / 12 + (S.tokenMonthly || 0);

  return (
    <div className="flex flex-col gap-3.5 pb-10">
      <header className="flex h-16 items-center gap-2">
        <button type="button" onClick={onBack} className="h-11 pr-3 text-base font-semibold">
          ‹ Back
        </button>
      </header>
      <h1 className="mb-1.5 text-[34px] font-extrabold tracking-[-0.035em]">Settings</h1>

      <Card>
        <Eyebrow>Your estimate</Eyebrow>
        <span className="text-base leading-[1.45]">
          {guess
            ? `~${short(nice(guess))} a month from your guesses — fuel ${short(S.fuelWeekly || 0)}/week, tokens ${short(S.tokenMonthly || 0)}/month.`
            : genLine
              ? null
              : "Not set. Takes under a minute."}
        </span>
        {genLine && <span className="font-mono text-[13px] text-muted">Gen: {genLine}</span>}
        <button
          type="button"
          onClick={onRedo}
          className="h-11 self-start rounded-xl border-[1.5px] border-line-strong px-4 text-sm font-semibold"
        >
          {guess || genLine ? "Redo quick estimate" : "Do quick estimate"}
        </button>
      </Card>

      {hours && (
        <Card className="flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-base font-semibold">Hours of light a day</span>
              <span className="text-sm text-muted">
                {hours.source === "user"
                  ? "You set this"
                  : hours.source === "inferred"
                    ? "Worked out from your meter"
                    : "Calgy will work it out from your meter"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <StepButton label="Fewer hours" onClick={() => onHours(-1)} className="bg-track-2 text-xl">
                −
              </StepButton>
              <span className="min-w-16 text-center text-lg font-extrabold" aria-live="polite">
                {hours.value == null ? "—" : `${Math.round(hours.value * 2) / 2} hrs`}
              </span>
              <StepButton label="More hours" onClick={() => onHours(1)} className="bg-track-2 text-xl">
                +
              </StepButton>
            </div>
          </div>
          {hours.source === "user" && (
            <button type="button" onClick={onHoursAuto} className="h-10 self-start text-sm font-semibold text-light">
              Let Calgy work it out instead
            </button>
          )}
        </Card>
      )}

      <Card className="flex-col gap-1.5">
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="flex flex-col gap-1">
            <span className="text-base font-semibold">Match estimates to my meter and fuel</span>
            <span className="text-sm leading-[1.4] text-muted">
              Adjusts device estimates so they add up to what your meter and fuel logs show.
            </span>
          </span>
          <input
            type="checkbox"
            checked={S.calibrate}
            onChange={(e) => onCalibrate(e.target.checked)}
            className="h-6 w-6 shrink-0 accent-light"
          />
        </label>
      </Card>

      {!demo && (
        <Card className="flex-col gap-0 p-0">
          {[
            { href: "/app/settings/account", label: "Account", hint: "Save your data across devices" },
            { href: "/app/settings/reminders", label: "Reminders", hint: "Weekly meter check" },
            { href: "/app/settings/privacy", label: "Data & privacy", hint: "Export, import, delete, sharing" },
          ].map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex min-h-16 items-center justify-between gap-3 px-[18px] py-3 text-ink no-underline ${
                i ? "border-t border-line" : ""
              }`}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold">{l.label}</span>
                <span className="text-sm text-muted">{l.hint}</span>
              </span>
              <span aria-hidden="true" className="text-xl text-muted">
                ›
              </span>
            </Link>
          ))}
        </Card>
      )}

      <Card>
        <Eyebrow>Data · {entryCount} entries</Eyebrow>
        <button
          type="button"
          onClick={() => {
            if (entryCount && !confirmSample) {
              setConfirmSample(true);
              setConfirmErase(false);
              return;
            }
            setConfirmSample(false);
            onSample();
          }}
          className="h-12 rounded-xl border-[1.5px] border-line-strong text-[15px] font-semibold"
        >
          {entryCount ? (confirmSample ? "Tap again to replace with sample" : "Replace with sample data") : "Load sample data"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!confirmErase) {
              setConfirmErase(true);
              setConfirmSample(false);
              return;
            }
            onErase();
          }}
          className={`h-12 rounded-xl border-[1.5px] border-red text-[15px] font-semibold ${
            confirmErase ? "bg-red text-white" : "text-red"
          }`}
        >
          {confirmErase ? `Tap again to erase ${entryCount} entries` : "Erase everything"}
        </button>
      </Card>
      <span className="mt-2 text-center font-mono text-xs text-muted">
        {demo ? "Calgy demo · sample data only" : "Calgy · saved on this device and synced to your account"}
      </span>
    </div>
  );
}
