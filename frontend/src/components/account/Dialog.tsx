"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Centered modal for account decisions. Escape / backdrop call `onCancel` when given. */
export function Dialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel?: () => void }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    if (!onCancel) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center px-4 pb-4 sm:items-center">
      <div className="absolute inset-0 bg-ink/45" onClick={onCancel} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="relative flex w-full max-w-[440px] flex-col gap-3.5 rounded-[22px] bg-card p-5 shadow-[0_12px_40px_rgba(25,23,18,0.3)] outline-none"
      >
        <h2 id={id} className="text-[22px] font-extrabold tracking-[-0.025em]">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export const primaryBtn = "h-[52px] rounded-[14px] bg-ink text-[15px] font-bold text-card disabled:opacity-40";
export const secondaryBtn = "h-[52px] rounded-[14px] border-[1.5px] border-line-strong text-[15px] font-bold disabled:opacity-40";
export const dangerBtn = "h-[52px] rounded-[14px] bg-red text-[15px] font-bold text-white disabled:opacity-40";
export const textBtn = "h-11 text-[15px] font-medium text-muted";
