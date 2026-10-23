"use client";

import { useRef, useState, type ReactNode } from "react";
import { nice, short } from "@/lib/format";
import type { Settings } from "@/lib/spend";
import { Eyebrow, StepButton } from "../ui";

function Card({ children, className = "flex-col gap-2.5" }: { children: ReactNode; className?: string }) {
  return <div className={`flex rounded-[18px] border border-line bg-card p-[18px] ${className}`}>{children}</div>;
}

export function SettingsView({
  entryCount,
  settings: S,
  onBack,
  onRedo,
  onHours,
  onExport,
  onImport,
  onSample,
  onErase,
}: {
  entryCount: number;
  settings: Settings;
  onBack: () => void;
  onRedo: () => void;
  onHours: (delta: number) => void;
  onExport: () => void;
  onImport: (f: File) => void;
  onSample: () => void;
  onErase: () => void;
}) {
  const [confirmErase, setConfirmErase] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const guess = ((S.fuelWeekly || 0) * 52) / 12 + (S.tokenMonthly || 0);
  const daysSince = S.lastExport ? Math.floor((new Date().getTime() - new Date(S.lastExport).getTime()) / 864e5) : null;

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
            : "Not set. Takes under a minute."}
        </span>
        <button
          type="button"
          onClick={onRedo}
          className="h-11 self-start rounded-xl border-[1.5px] border-line-strong px-4 text-sm font-semibold"
        >
          {guess ? "Redo quick estimate" : "Do quick estimate"}
        </button>
      </Card>

      <Card className="items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold">Hours of light a day</span>
          <span className="text-sm text-muted">Typical NEPA supply</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StepButton label="Fewer hours" onClick={() => onHours(-1)} className="bg-track-2 text-xl">
            −
          </StepButton>
          <span className="min-w-16 text-center text-lg font-extrabold" aria-live="polite">
            {S.gridHours} hrs
          </span>
          <StepButton label="More hours" onClick={() => onHours(1)} className="bg-track-2 text-xl">
            +
          </StepButton>
        </div>
      </Card>

      <Card className="flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow>Backup</Eyebrow>
          <span className="font-mono text-xs text-muted">
            {daysSince === null ? "No backup yet" : daysSince === 0 ? "Backed up today" : `Last: ${daysSince}d ago`}
          </span>
        </div>
        <span className="text-[15px] leading-[1.45] text-pretty">
          Your logs live only in this browser. Clearing it, or switching phones, wipes them — download a copy now and
          then.
        </span>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onExport} className="h-[52px] rounded-[14px] bg-ink text-[15px] font-bold text-card">
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-[52px] rounded-[14px] border-[1.5px] border-line-strong text-[15px] font-bold"
          >
            Import JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onImport(f);
          }}
        />
        <span className="text-[13px] text-muted">Importing replaces what&apos;s on this device.</span>
      </Card>

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
      <span className="mt-2 text-center font-mono text-xs text-muted">Calgy MVP · stored on this device only</span>
    </div>
  );
}
