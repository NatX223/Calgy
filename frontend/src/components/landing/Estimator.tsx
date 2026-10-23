"use client";

import Link from "next/link";
import { useState } from "react";
import { commas, digits, nice, short } from "@/lib/format";

function Field({
  label,
  marker,
  value,
  onChange,
  chips,
}: {
  label: string;
  marker: string;
  value: string;
  onChange: (v: string) => void;
  chips: number[];
}) {
  const cur = +digits(value) || 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 ${marker}`} />
        <span className="text-[17px] font-semibold">{label}</span>
      </div>
      <label className="flex h-[62px] max-w-[460px] items-center gap-1.5 rounded-[14px] border-[1.5px] border-ink-line bg-ink-field px-[18px]">
        <span className="text-2xl font-semibold text-ink-muted">₦</span>
        <input
          inputMode="numeric"
          placeholder="0"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(commas(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-[26px] font-bold text-card outline-none placeholder:text-[#8C8474]"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {chips.map((v) => {
          const on = cur === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(commas(v))}
              className={`h-11 rounded-full border-[1.5px] px-4 font-mono text-sm ${
                on ? "border-card bg-card text-ink" : "border-body-2 text-card"
              }`}
            >
              {short(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Ten-second ballpark" — yearly spend from two guesses, ±15%. */
export function Estimator() {
  const [fuel, setFuel] = useState("");
  const [token, setToken] = useState("");
  const fy = (+digits(fuel) || 0) * 52;
  const ty = (+digits(token) || 0) * 12;
  const y = fy + ty;
  const fuelPct = y ? Math.round((fy / y) * 100) : 0;

  return (
    <section id="estimate" className="scroll-mt-4 bg-ink text-card">
      <div className="mx-auto grid max-w-[1160px] grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-14 px-6 py-24">
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-3.5">
            <span className="font-mono text-[13px] tracking-[0.08em] text-ink-muted uppercase">Ten-second ballpark</span>
            <h2 className="text-[clamp(36px,4.6vw,58px)] leading-none font-extrabold tracking-[-0.04em] text-balance">
              Two guesses. One uncomfortable number.
            </h2>
            <p className="max-w-[460px] text-[17px] leading-normal text-pretty text-ink-muted">
              Most homes know what one top-up costs, never what a year costs. Rough figures are fine.
            </p>
          </div>
          <Field label="Generator fuel, per week" marker="bg-fuel" value={fuel} onChange={setFuel} chips={[5000, 10000, 20000, 40000]} />
          <Field
            label="Meter tokens, per month"
            marker="rounded-full bg-light-bright"
            value={token}
            onChange={setToken}
            chips={[5000, 10000, 20000, 30000]}
          />
        </div>

        <div className="flex flex-col gap-[26px] rounded-[28px] border-[1.5px] border-ink-line p-[clamp(24px,4vw,40px)]" aria-live="polite">
          <div className="flex flex-col gap-2.5">
            <span className="font-mono text-[13px] tracking-[0.08em] text-ink-muted uppercase">Your home, over a year</span>
            <span
              className={`text-[clamp(40px,5.4vw,68px)] leading-none font-extrabold tracking-[-0.05em] ${
                y ? "text-fuel" : "text-body-2"
              }`}
            >
              {y ? `${short(nice(y * 0.85))}–${short(nice(y * 1.15))}` : "₦—"}
            </span>
            <span className="text-[17px] text-ink-muted">
              {y
                ? `About ${short(nice((y / 12) * 0.85))}–${short(nice((y / 12) * 1.15))} a month on fuel and light`
                : "Enter a rough figure to see your year"}
            </span>
          </div>
          <div className="flex flex-col gap-3.5">
            <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[4px] bg-ink-line">
              <div className="bg-fuel transition-[width] duration-400" style={{ width: `${fuelPct}%` }} />
              <div className={`flex-1 ${y ? "bg-light-bright" : "bg-ink-line"}`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Fuel · {y ? fuelPct + "%" : "—"}</span>
                <span className="text-[22px] font-extrabold tracking-[-0.02em]">{y ? "~" + short(nice(fy)) + "/yr" : "—"}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Light · {y ? 100 - fuelPct + "%" : "—"}</span>
                <span className="text-[22px] font-extrabold tracking-[-0.02em]">{y ? "~" + short(nice(ty)) + "/yr" : "—"}</span>
              </div>
            </div>
          </div>
          <p className="text-sm leading-normal text-pretty text-ink-muted">
            Give or take 15% — guesses drift. Calgy replaces this with what you actually log.
          </p>
          <Link
            href="/app"
            className="inline-flex h-14 items-center self-start rounded-2xl bg-fuel px-6 text-base font-extrabold whitespace-nowrap text-ink no-underline"
          >
            Track the real number →
          </Link>
        </div>
      </div>
    </section>
  );
}
