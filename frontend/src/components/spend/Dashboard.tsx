"use client";

import Link from "next/link";
import { daysIn, DOW, fmtQ, MONTHS, naira, nice, parseIso, short, trim, ymKey } from "@/lib/format";
import { monthBuckets } from "@/lib/insights";
import { byNewest, type Entry, type EntryType, type Settings } from "@/lib/spend";
import { Eyebrow, Logo, Marker, SplitBar } from "../ui";

type Props = {
  entries: Entry[];
  settings: Settings;
  offset: number;
  setOffset: (fn: (o: number) => number) => void;
  onAdd: (t: EntryType) => void;
  onEdit: (e: Entry) => void;
  onSettings: () => void;
  onInsights?: () => void;
  /** One-line gen summary; shows the gen card when set. */
  genLine?: string;
  onGen?: () => void;
  onLoadSample: () => void;
  /** Compare current month to the same days of last month, or to all of it. */
  compareBasis?: "same-period" | "full-month";
  showPace?: boolean;
};

const sum = (a: Entry[]) => a.reduce((t, e) => t + e.amount_naira, 0);

/** Σ₦ / Σqty over entries that have a quantity. */
const avgUnit = (a: Entry[]) => {
  const w = a.filter((e) => (e.quantity ?? 0) > 0);
  const q = w.reduce((t, e) => t + (e.quantity ?? 0), 0);
  return q ? sum(w) / q : null;
};

export function Dashboard({
  entries,
  settings: S,
  offset,
  setOffset,
  onAdd,
  onEdit,
  onSettings,
  onInsights,
  genLine,
  onGen,
  onLoadSample,
  compareBasis = "same-period",
  showPace = true,
}: Props) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const prev = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const ym = ymKey(base);
  const pym = ymKey(prev);
  const isCurrent = offset === 0;
  const day = now.getDate();
  const dim = daysIn(base);
  const monthName = MONTHS[base.getMonth()];

  const mE = entries.filter((e) => e.date.slice(0, 7) === ym);
  const fuelE = mE.filter((e) => e.type === "fuel");
  const tokE = mE.filter((e) => e.type === "token");
  const fuelT = sum(fuelE);
  const tokT = sum(tokE);
  const total = fuelT + tokT;

  // Month-on-month delta
  const samePeriod = isCurrent && compareBasis === "same-period";
  let prevE = entries.filter((e) => e.date.slice(0, 7) === pym);
  if (samePeriod) prevE = prevE.filter((e) => +e.date.slice(8, 10) <= day);
  const prevT = sum(prevE);
  const pName = MONTHS[prev.getMonth()];
  const basisLabel = samePeriod ? `1–${Math.min(day, daysIn(prev))} ${pName.slice(0, 3)}` : pName;
  let deltaText: string;
  let deltaClass = "text-muted";
  if (!total && !prevT) deltaText = isCurrent ? "Nothing logged yet this month" : "Nothing logged this month";
  else if (!prevT) deltaText = `Nothing logged for ${basisLabel} to compare`;
  else {
    const p = Math.round(((total - prevT) / prevT) * 100);
    if (p === 0) deltaText = `Level with ${basisLabel} · ${naira(prevT)}`;
    else if (p > 0) {
      deltaText = `↑ ${p}% more than ${basisLabel} · ${naira(prevT)}`;
      deltaClass = "text-red";
    } else {
      deltaText = `↓ ${-p}% less than ${basisLabel} · ${naira(prevT)}`;
      deltaClass = "text-light";
    }
  }

  const fuelPct = total ? Math.round((fuelT / total) * 100) : 0;
  const fU = avgUnit(fuelE);
  const tU = avgUnit(tokE);

  // Pace projection
  const guess = ((S.fuelWeekly || 0) * 52) / 12 + (S.tokenMonthly || 0);
  const showPaceLine = showPace && isCurrent && total > 0 && day >= 3 && day < dim;
  const proj = (total / day) * dim;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const relDate = (s: string) => {
    const d = parseIso(s);
    const diff = Math.round((today.getTime() - d.getTime()) / 864e5);
    return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  };

  const daysSince = S.lastExport ? Math.floor((now.getTime() - new Date(S.lastExport).getTime()) / 864e5) : null;
  const showBackupNudge = entries.length >= 5 && (daysSince === null || daysSince >= 14);

  return (
    <>
      <div className="flex flex-col pb-32">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <nav className="flex gap-0.5 rounded-[13px] bg-track p-[3px]">
              <span
                aria-current="page"
                className="inline-flex h-10 items-center rounded-[10px] bg-card px-3 text-sm font-semibold shadow-[0_1px_2px_rgba(25,23,18,0.12)]"
              >
                Spend
              </span>
              <Link
                href="/app/home"
                className="inline-flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold whitespace-nowrap text-ink no-underline"
              >
                My Home
              </Link>
              <Link
                href="/app/simulator"
                className="inline-flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold whitespace-nowrap text-ink no-underline"
              >
                Simulator
              </Link>
            </nav>
            <button
              type="button"
              onClick={onSettings}
              className="h-10 rounded-xl border-[1.5px] border-line-strong px-3.5 text-sm font-semibold hover:bg-track-2"
            >
              Settings
            </button>
          </div>
        </header>

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            aria-label="Previous month"
            className="h-11 w-11 rounded-xl bg-track-2 text-xl font-semibold"
          >
            ‹
          </button>
          <span className="text-base font-semibold">
            {monthName} {base.getFullYear()}
          </span>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            aria-label="Next month"
            disabled={isCurrent}
            className="h-11 w-11 rounded-xl bg-track-2 text-xl font-semibold disabled:opacity-35"
          >
            ›
          </button>
        </div>

        <div className="mt-7 flex flex-col">
          <Eyebrow>{isCurrent ? "Spent on energy so far" : "Spent on energy"}</Eyebrow>
          <span className="mt-2.5 text-[60px] leading-none font-extrabold tracking-[-0.05em] tabular-nums">
            {naira(total)}
          </span>
          <span className={`mt-3 text-[15px] font-medium ${deltaClass}`}>{deltaText}</span>
        </div>

        <div className="mt-6">
          <SplitBar fuelPct={fuelPct} empty={!total} />
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-3">
          <Legend
            type="fuel"
            label="Fuel"
            pct={total ? fuelPct + "%" : ""}
            amount={naira(fuelT)}
            unit={
              fU ? `avg ₦${Math.round(fU).toLocaleString("en-NG")}/L` : fuelE.length ? "add litres for ₦/L" : "no fuel logged"
            }
          />
          <Legend
            type="token"
            label="Light"
            pct={total ? 100 - fuelPct + "%" : ""}
            amount={naira(tokT)}
            unit={tU ? `avg ₦${trim(tU.toFixed(1))}/kWh` : tokE.length ? "add units for ₦/kWh" : "no tokens logged"}
          />
        </div>

        {showPaceLine && (
          <div className="mt-[22px] flex flex-col gap-1 rounded-[14px] border-[1.5px] border-dashed border-line-strong px-4 py-3.5">
            <span className="text-[15px] font-semibold">
              On pace for {short(nice(Math.max(total, proj * 0.88)))}–{short(nice(proj * 1.12))} by {dim}{" "}
              {monthName.slice(0, 3)}
            </span>
            <span className="font-mono text-xs text-muted">
              From {day} days of logs{guess ? ` · your guess was ~${short(nice(guess))}/mo` : ""}
            </span>
          </div>
        )}

        {onGen && genLine && <GenTeaser line={genLine} onClick={onGen} />}
        {onInsights && entries.length > 0 && <InsightsTeaser entries={entries} onClick={onInsights} />}

        <div className="mt-8 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-[-0.01em]">Entries</h2>
          <span className="font-mono text-xs text-muted">{mE.length ? `${mE.length} this month` : ""}</span>
        </div>

        {mE.length > 0 ? (
          <div className="mt-1.5 flex flex-col">
            {[...mE].sort(byNewest).map((e) => (
              <EntryRow key={e.id} entry={e} dateLabel={relDate(e.date)} onClick={() => onEdit(e)} />
            ))}
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line-strong px-5 py-7 text-center">
            <span className="text-[17px] font-semibold">
              Nothing logged for {monthName}
              {isCurrent ? " yet" : ""}
            </span>
            <span className="max-w-[300px] text-sm leading-[1.45] text-pretty text-muted">
              {isCurrent
                ? "Next time you buy fuel or load a token, tap a button below. Two taps is enough."
                : "No fuel or token entries for this month."}
            </span>
            {entries.length === 0 && (
              <button
                type="button"
                onClick={onLoadSample}
                className="h-11 px-2 text-[15px] font-semibold text-light underline underline-offset-[3px]"
              >
                Or explore with sample data
              </button>
            )}
          </div>
        )}

        {showBackupNudge && (
          <button
            type="button"
            onClick={onSettings}
            className="mt-6 flex min-h-14 w-full items-center justify-between gap-3 rounded-[14px] bg-track-2 px-4 py-3 text-left"
          >
            <span className="text-sm leading-[1.4]">
              {daysSince === null
                ? "Your logs live only in this browser. No backup yet."
                : `Last backup ${daysSince} days ago.`}
            </span>
            <span className="text-sm font-bold whitespace-nowrap text-light">Back up →</span>
          </button>
        )}
      </div>

      <div className="bar-fade pb-safe-bar fixed inset-x-0 bottom-0 z-20 px-5 pt-[22px]">
        <div className="mx-auto grid max-w-[440px] grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onAdd("fuel")}
            className="h-[68px] rounded-[18px] bg-fuel text-xl font-extrabold tracking-[-0.01em] text-ink shadow-[0_6px_18px_rgba(196,128,30,0.28)] active:scale-[.97]"
          >
            + Fuel
          </button>
          <button
            type="button"
            onClick={() => onAdd("token")}
            className="h-[68px] rounded-[18px] bg-light text-xl font-extrabold tracking-[-0.01em] text-white shadow-[0_6px_18px_rgba(31,122,77,0.28)] active:scale-[.97]"
          >
            + Token
          </button>
        </div>
      </div>
    </>
  );
}

/** What the gen costs to run, opening the gen view. */
function GenTeaser({ line, onClick }: { line: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-[22px] flex min-h-16 w-full items-center gap-4 rounded-[14px] bg-card px-4 py-3 text-left hover:bg-track-2"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-fuel-soft" aria-hidden="true">
        <Marker type="fuel" size={12} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">Your gen</span>
        <span className="truncate font-mono text-xs text-muted">{line}</span>
      </span>
      <span className="text-sm font-bold whitespace-nowrap text-fuel-ink">See →</span>
    </button>
  );
}

/** Six-month spend sparkline that opens the Insights view. */
function InsightsTeaser({ entries, onClick }: { entries: Entry[]; onClick: () => void }) {
  const months = monthBuckets(entries);
  const totals = months.map((b) => b.fuel + b.token);
  const max = Math.max(...totals) || 1;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-[22px] flex min-h-16 w-full items-center gap-4 rounded-[14px] bg-card px-4 py-3 text-left hover:bg-track-2"
    >
      <span className="flex h-9 items-end gap-[3px]" aria-hidden="true">
        {totals.map((t, i) => (
          <span
            key={months[i].key}
            className={`w-2 rounded-t-[2px] ${i === totals.length - 1 ? "bg-light" : "bg-ink-muted"}`}
            style={{ height: Math.max(3, (t / max) * 36) }}
          />
        ))}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">Insights</span>
        <span className="font-mono text-xs text-muted">Spend & usage per day, week, month</span>
      </span>
      <span className="text-sm font-bold whitespace-nowrap text-light">See →</span>
    </button>
  );
}

function Legend({
  type,
  label,
  pct,
  amount,
  unit,
}: {
  type: "fuel" | "token";
  label: string;
  pct: string;
  amount: string;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Marker type={type} />
        <span className="text-sm font-semibold">{label}</span>
        <span className="font-mono text-[13px] text-muted">{pct}</span>
      </div>
      <span className="text-[22px] font-extrabold tracking-[-0.025em]">{amount}</span>
      <span className="font-mono text-xs text-muted">{unit}</span>
    </div>
  );
}

function EntryRow({ entry: e, dateLabel, onClick }: { entry: Entry; dateLabel: string; onClick: () => void }) {
  const f = e.type === "fuel";
  const q = e.quantity;
  let meta = f
    ? q
      ? `${fmtQ(q)} L · ₦${Math.round(e.amount_naira / q).toLocaleString("en-NG")}/L`
      : "Litres not logged"
    : q
      ? `${fmtQ(q)} kWh · ₦${trim((e.amount_naira / q).toFixed(1))}/kWh`
      : "Units not logged";
  if (e.note) meta += " · " + e.note;

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid min-h-[66px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line px-1 py-3.5 text-left hover:bg-track-2"
    >
      <Marker type={e.type} size={12} />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-base font-semibold">{f ? "Fuel" : "Token"}</span>
        <span className="truncate font-mono text-xs text-muted">{meta}</span>
      </span>
      <span className="flex flex-col items-end gap-[3px]">
        <span className="text-base font-bold tabular-nums">{naira(e.amount_naira)}</span>
        <span className="font-mono text-xs text-muted">{dateLabel}</span>
      </span>
    </button>
  );
}
