"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SyncStatus } from "../sync/SyncStatus";

export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-3.5 px-5 pb-10">
        <header className="flex h-16 items-center gap-2">
          <Link href="/app#settings" className="inline-flex h-11 items-center pr-3 text-base font-semibold text-ink no-underline">
            ‹ Settings
          </Link>
        </header>
        <h1 className="mb-1.5 text-[34px] font-extrabold tracking-[-0.035em]">{title}</h1>
        <SyncStatus />
        {children}
      </div>
    </div>
  );
}

export function Card({ children, className = "flex-col gap-2.5" }: { children: ReactNode; className?: string }) {
  return <div className={`flex rounded-[18px] border border-line bg-card p-[18px] ${className}`}>{children}</div>;
}

/** A labelled on/off switch row. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="flex flex-col gap-1">
        <span className="text-base font-semibold">{label}</span>
        {hint && <span className="text-sm leading-[1.4] text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-6 w-6 shrink-0 accent-light"
      />
    </label>
  );
}

export const btn = "h-12 rounded-xl border-[1.5px] border-line-strong px-4 text-[15px] font-semibold disabled:opacity-40";
export const btnDark = "h-12 rounded-xl bg-ink px-4 text-[15px] font-bold text-card disabled:opacity-40";
