"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-label="Calgy"
      className="inline-flex items-baseline font-extrabold leading-none tracking-[-0.04em]"
      style={{ fontSize: size }}
    >
      Ca
      <span
        aria-hidden="true"
        className="inline-flex w-[0.46em] justify-center overflow-visible text-[0.82em]"
        style={{ transform: "translateY(0.04em) rotate(8deg)" }}
      >
        ⚡
      </span>
      gy
    </span>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-xs uppercase tracking-[0.08em] text-muted ${className}`}>{children}</span>
  );
}

/** Fuel = amber square, light/token = green circle. */
export function Marker({ type, size = 10 }: { type: "fuel" | "token"; size?: number }) {
  return (
    <span
      className={`shrink-0 ${type === "fuel" ? "bg-fuel" : "rounded-full bg-light"}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Chip({
  on,
  onClick,
  children,
  className = "h-11 px-4 text-sm",
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border-[1.5px] font-mono font-medium ${
        on ? "border-ink bg-ink text-card" : "border-line-strong bg-transparent text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function SplitBar({ fuelPct, empty, emptyClass = "bg-line" }: { fuelPct: number; empty: boolean; emptyClass?: string }) {
  return (
    <div className={`flex h-3.5 gap-0.5 overflow-hidden rounded-[4px] ${emptyClass}`}>
      <div className="bg-fuel transition-[width] duration-400" style={{ width: `${fuelPct}%` }} />
      <div className={`flex-1 ${empty ? emptyClass : "bg-light"}`} />
    </div>
  );
}

export function StepButton({
  label,
  onClick,
  children,
  className = "bg-track-2",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`h-11 w-11 rounded-xl text-lg font-semibold ${className}`}
    >
      {children}
    </button>
  );
}

type ToastState = { msg: string; actionLabel?: string; action?: () => void } | null;

export function useToast(duration = 2600) {
  const [toast, setToast] = useState<ToastState>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (msg: string, actionLabel?: string, action?: () => void) => {
      window.clearTimeout(timer.current);
      setToast({ msg, actionLabel, action });
      setShown(true);
      timer.current = window.setTimeout(() => setShown(false), actionLabel ? 5000 : duration);
    },
    [duration],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, shown, show };
}

export function Toast({ toast, shown, bottom }: { toast: ToastState; shown: boolean; bottom: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-5 transition-[opacity,translate] duration-250 ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
      style={{ bottom }}
    >
      <div
        className={`flex min-h-[52px] w-full max-w-[440px] items-center gap-3 rounded-[14px] bg-ink py-0 pr-1.5 pl-4 text-card shadow-[0_8px_24px_rgba(25,23,18,0.25)] ${
          shown ? "pointer-events-auto" : ""
        }`}
      >
        <span className="flex-1 text-[15px] font-medium">{toast?.msg}</span>
        {toast?.actionLabel && (
          <button
            type="button"
            onClick={() => toast.action?.()}
            className="h-11 px-3 text-[15px] font-bold text-fuel"
          >
            {toast.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Close an open sheet with Escape. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, onEscape]);
}

/** Pill-style tab row; equal-width options. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid gap-1 rounded-2xl bg-track-2 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-11 rounded-xl text-[15px] font-semibold ${
            value === o.id ? "bg-card text-ink shadow-sm" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
