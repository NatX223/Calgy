"use client";

import type { ReactNode } from "react";
import type { CalibrationResult } from "@/lib/calibration";
import { DOW, fU, MONTHS, naira, parseIso, shortDate, trim } from "@/lib/format";
import {
  meterSnapshot, sortReadings, tokensFromEntries, type ActualDaily, type MeterReading, type MeterState, type ReadingPair,
  type ReminderDay,
} from "@/lib/meter";
import type { Entry } from "@/lib/spend";
import { gridBadge, LightHoursCard } from "../Calibration";
import { Eyebrow, Marker } from "../ui";

type Snapshot = NonNullable<ReturnType<typeof meterSnapshot>>;

const CONF_LABEL = { rough: "Rough", good: "Good", solid: "Solid" } as const;
const longDate = (ymd: string) => {
  const d = parseIso(ymd);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};
export const daysText = (d: { low: number; high: number }) =>
  `${d.low === d.high ? d.low : `${d.low}–${d.high}`} day${d.high === 1 ? "" : "s"}`;

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-2.5 rounded-[18px] border border-line bg-card p-[18px] ${className}`}>{children}</div>;
}

/** Home card: units and days left, with a quick "Log reading". */
export function MeterCard({ snap, onOpen, onLog }: { snap: Snapshot | null; onOpen: () => void; onLog: () => void }) {
  return (
    <div className="mt-[22px] flex min-h-16 items-center gap-3 rounded-[14px] bg-card py-2 pr-2 pl-4">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 py-1.5 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-light-soft" aria-hidden="true">
          <Marker type="token" size={12} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Your meter</span>
          <span className="truncate font-mono text-xs text-muted">
            {snap
              ? `~${fU(snap.unitsNow.units)} units left${snap.days ? ` · ${daysText(snap.days)}` : ""}`
              : "Add a reading to see units and days left"}
          </span>
        </span>
      </button>
      <button type="button" onClick={onLog} className="h-11 shrink-0 rounded-xl bg-light px-3.5 text-sm font-bold text-white">
        Log reading
      </button>
    </div>
  );
}

/** In-app reminder when the last reading is a week old (reminders on). */
export function ReminderBanner({ onLog, onDismiss }: { onLog: () => void; onDismiss: () => void }) {
  return (
    <div className="mt-[22px] flex items-center gap-2.5 rounded-xl bg-fuel-soft py-2 pr-1.5 pl-3.5 text-sm leading-[1.4]">
      <span className="flex-1">It&apos;s been a week since your last meter reading.</span>
      <button type="button" onClick={onLog} className="h-10 px-2 text-sm font-bold text-light">
        Log it
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="h-10 w-9 text-sm">
        ✕
      </button>
    </div>
  );
}

const flagText = (p: ReadingPair) =>
  p.flag === "suspect"
    ? "Your units went up. Did you load a token?"
    : p.flag === "missing_units"
      ? "A token in this window has no units."
      : p.flag === "outlier"
        ? "That's a lot for this stretch. Double-check this reading."
        : p.flag === "short"
          ? "Too close to the last reading to count."
          : null;

export function MeterView({
  readings,
  entries,
  meter,
  tariff,
  actual,
  cal,
  enabled,
  now,
  onBack,
  onLogReading,
  onEditReading,
  onLogToken,
  onFixToken,
  onEditToken,
  onSetHours,
  onKeepHours,
  onReminder,
}: {
  readings: MeterReading[];
  entries: Entry[];
  meter: MeterState;
  tariff: { value: number; source: string } | null;
  actual: ActualDaily;
  cal: CalibrationResult;
  enabled: boolean;
  now: Date;
  onBack: () => void;
  onLogReading: () => void;
  onEditReading: (r: MeterReading) => void;
  /** Log a token, optionally inside a reading window (ISO time it was loaded by). */
  onLogToken: (before?: string, after?: string) => void;
  onFixToken: (entryId: string) => void;
  onEditToken: (e: Entry) => void;
  onSetHours: (h: number) => void;
  onKeepHours: () => void;
  onReminder: (p: Partial<MeterState["reminder"]>) => void;
}) {
  const tokens = tokensFromEntries(entries);
  const snap = meterSnapshot(readings, tokens, meter.profile, actual.value, now);
  const pairByTo = new Map(actual.pairs.map((p) => [p.to.id, p]));
  const history = sortReadings(readings).reverse();
  const tokenEntries = entries
    .filter((e) => e.type === "token")
    .sort((a, b) => (tokens.find((t) => t.id === b.id)?.loadedAt ?? "").localeCompare(tokens.find((t) => t.id === a.id)?.loadedAt ?? ""));
  const badge = enabled ? gridBadge(cal) : null;
  const perDay = actual.value != null && tariff ? actual.value * tariff.value : null;

  return (
    <div className="flex flex-col gap-3.5 pb-12">
      <header className="flex h-16 items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to dashboard" className="h-11 w-11 rounded-xl bg-track-2 text-xl font-semibold">
          ‹
        </button>
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Your meter</h1>
      </header>

      <div className="flex flex-col gap-4 rounded-[22px] bg-ink p-[22px] text-card">
        <Eyebrow className="text-ink-muted">{snap?.unitsNow.estimated ? "Units left now · estimated" : "Units left"}</Eyebrow>
        {snap ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[52px] leading-none font-extrabold tracking-[-0.05em]">
                {snap.unitsNow.estimated ? "~" : ""}
                {fU(snap.unitsNow.units)}
                <span className="text-xl font-bold text-ink-muted"> units</span>
              </span>
              <span className="font-mono text-xs text-ink-muted">
                {snap.unitsNow.estimated
                  ? `From your reading on ${shortDate(snap.last.takenAt, true)}, minus what you've likely used since`
                  : `As of ${shortDate(snap.last.takenAt, true)}`}
                {snap.unitsNow.missingUnits ? " · a token since has no units" : ""}
              </span>
            </div>
            {snap.days && (
              <div className="flex flex-col gap-1 border-t border-ink-line pt-3.5">
                <span className="text-[26px] leading-none font-extrabold tracking-[-0.03em]">{daysText(snap.days)} left</span>
                <span className="text-[15px] text-ink-muted">
                  Buy by <span className="font-semibold text-card">~{longDate(snap.days.buyBy)}</span>
                </span>
              </div>
            )}
          </>
        ) : (
          <span className="text-[15px] leading-[1.45] text-ink-muted">Log what your meter shows to see units and days left.</span>
        )}
        {badge && (
          <span className={`self-start rounded-full px-3 py-1 text-[13px] font-medium ${badge.ok ? "bg-light-chip text-ink" : "bg-ink-pill"}`}>
            {badge.ok ? "✓" : "○"} {badge.text}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onLogReading} className="h-[56px] rounded-2xl bg-light text-base font-extrabold text-white">
          Log meter reading
        </button>
        <button type="button" onClick={() => onLogToken()} className="h-[56px] rounded-2xl border-[1.5px] border-line-strong text-base font-extrabold">
          + Token
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Card>
          <Eyebrow>Price per unit</Eyebrow>
          {tariff ? (
            <>
              <span className="text-[24px] leading-none font-extrabold tracking-[-0.03em]">₦{trim(tariff.value.toFixed(1))}</span>
              <span className="font-mono text-xs text-muted">{tariff.source}</span>
            </>
          ) : (
            <span className="text-sm leading-[1.4] text-muted">Add units from your next token receipt</span>
          )}
        </Card>
        <Card>
          <Eyebrow>You use</Eyebrow>
          {actual.value != null ? (
            <>
              <span className="text-[24px] leading-none font-extrabold tracking-[-0.03em]">
                {fU(actual.value)}
                <span className="text-sm font-semibold text-muted"> units/day</span>
              </span>
              <span className="font-mono text-xs text-muted">
                {perDay != null ? `${naira(perDay)}/day · ${naira(perDay * 30)}/month` : CONF_LABEL[actual.confidence ?? "rough"]}
              </span>
            </>
          ) : (
            <span className="text-sm leading-[1.4] text-muted">Two readings a day or more apart tell us</span>
          )}
        </Card>
      </div>

      <LightHoursCard r={cal} enabled={enabled} keptAt={meter.suggestionKeptAt} onSet={onSetHours} onKeep={onKeepHours} />

      <section className="mt-2 flex flex-col">
        <h2 className="border-b-[1.5px] border-ink pb-1.5 text-[17px] font-bold">Readings</h2>
        {history.length === 0 && <span className="py-4 text-sm text-muted">No readings yet.</span>}
        {history.map((r) => {
          const p = pairByTo.get(r.id);
          const flag = p ? flagText(p) : null;
          const tok = p?.missingTokenId ? entries.find((e) => e.id === p.missingTokenId) : undefined;
          return (
            <div key={r.id} className="flex flex-col gap-1.5 border-b border-line py-3">
              <button type="button" onClick={() => onEditReading(r)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left">
                <span className="flex min-w-0 flex-col gap-[3px]">
                  <span className="text-base font-semibold">{fU(r.unitsLeft)} units left</span>
                  <span className="truncate font-mono text-xs text-muted">
                    {shortDate(r.takenAt, true)}
                    {r.context === "before_token" ? " · before a token" : r.context === "onboarding" ? " · first reading" : ""}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-[3px]">
                  <span className="text-[15px] font-bold tabular-nums">
                    {p?.used != null && !p.flag ? `${fU(p.used)} used` : p ? "—" : ""}
                  </span>
                  <span className="font-mono text-xs text-muted">{p?.perDay != null && !p.flag ? `${fU(p.perDay)}/day` : ""}</span>
                </span>
              </button>
              {flag && p && (
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[1.4] ${p.flag === "short" ? "text-muted" : "text-fuel-ink"}`}>
                  <span>{flag}</span>
                  {p.flag === "suspect" && (
                    <button type="button" onClick={() => onLogToken(p.to.takenAt, p.from.takenAt)} className="font-bold text-light">
                      Log that token
                    </button>
                  )}
                  {p.flag === "missing_units" && tok && (
                    <button type="button" onClick={() => onFixToken(tok.id)} className="font-bold text-light">
                      Add units for {shortDate(tokens.find((t) => t.id === tok.id)!.loadedAt)}
                    </button>
                  )}
                  {p.flag === "outlier" && (
                    <button type="button" onClick={() => onEditReading(r)} className="font-bold text-light">
                      Check it
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="mt-2 flex flex-col">
        <h2 className="border-b-[1.5px] border-ink pb-1.5 text-[17px] font-bold">Tokens</h2>
        {tokenEntries.length === 0 && <span className="py-4 text-sm text-muted">No tokens logged yet.</span>}
        {tokenEntries.map((e) => {
          const t = tokens.find((x) => x.id === e.id)!;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onEditToken(e)}
              className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-3 text-left hover:bg-track-2"
            >
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-base font-semibold">{naira(e.amount_naira)}</span>
                <span className="font-mono text-xs text-muted">{shortDate(t.loadedAt, !!e.loaded_at)}</span>
              </span>
              <span className="flex flex-col items-end gap-[3px]">
                <span className="text-[15px] font-bold tabular-nums">{e.quantity ? `${fU(e.quantity)} units` : "Units not logged"}</span>
                <span className="font-mono text-xs text-muted">{e.quantity ? `₦${trim((e.amount_naira / e.quantity).toFixed(1))}/unit` : ""}</span>
              </span>
            </button>
          );
        })}
      </section>

      <Reminders meter={meter} onReminder={onReminder} />
    </div>
  );
}

const DAYS: ReminderDay[] = [1, 2, 3, 4, 5, 6, 0];

function Reminders({ meter, onReminder }: { meter: MeterState; onReminder: (p: Partial<MeterState["reminder"]>) => void }) {
  const r = meter.reminder;
  const installed = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  const canNotify = installed && typeof Notification !== "undefined";
  return (
    <Card className="mt-2">
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Remind me to check my meter</span>
          <span className="text-[13px] text-muted">Once a week</span>
        </span>
        <input
          type="checkbox"
          checked={r.on}
          onChange={(e) => onReminder({ on: e.target.checked })}
          className="h-6 w-6 shrink-0 accent-light"
        />
      </label>
      {r.on && (
        <>
          <div className="flex gap-2">
            <select
              aria-label="Reminder day"
              value={r.day}
              onChange={(e) => onReminder({ day: Number(e.target.value) as ReminderDay })}
              className="h-12 flex-1 rounded-xl border-[1.5px] border-line bg-paper px-3 text-[15px] font-semibold"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {DOW[d]}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label="Reminder time"
              value={r.time}
              onChange={(e) => e.target.value && onReminder({ time: e.target.value })}
              className="h-12 flex-1 rounded-xl border-[1.5px] border-line bg-paper px-3 text-[15px] font-semibold"
            />
          </div>
          <span className="text-[13px] leading-[1.4] text-muted">
            {canNotify && Notification.permission === "granted"
              ? "We'll send a notification when you open Calgy after that time."
              : "We'll show a reminder in Calgy when your last reading is a week old."}
          </span>
          {canNotify && Notification.permission === "default" && (
            <button
              type="button"
              onClick={() => Notification.requestPermission().then(() => onReminder({}))}
              className="h-11 self-start rounded-xl border-[1.5px] border-line-strong px-4 text-sm font-semibold"
            >
              Allow notifications
            </button>
          )}
        </>
      )}
    </Card>
  );
}
