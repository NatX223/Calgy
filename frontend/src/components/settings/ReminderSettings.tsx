"use client";

import { DEFAULT_TIMEZONE, type UserDoc } from "@calgy/shared";
import { DOW } from "@calgy/engine/format";
import { useEffect, useState } from "react";
import { getApi } from "@/lib/api";
import { apiErrorMessage, isApiError } from "@/lib/api/types";
import { useUserDoc } from "@/lib/hooks/status";
import {
  disablePush, enablePush, isPushSubscribed, notificationPermission, PushPermissionError, pushSupport, type PushSupport,
} from "@/lib/push/push";
import { OfflineGate } from "../sync/OfflineGate";
import { btn, Card, SettingsPage, Toggle } from "./SettingsPage";

type Reminder = UserDoc["settings"]["reminder"];

const DAYS = [1, 2, 3, 4, 5, 6, 0];
/** 00:00 … 23:45 in 15-minute steps. */
export const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);
/** Snap a saved time onto the picker's 15-minute grid. */
export const toQuarter = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const q = Math.min(95, Math.round((h * 60 + m) / 15));
  return QUARTER_HOURS[q];
};

export const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

const select = "h-12 flex-1 rounded-xl border-[1.5px] border-line bg-paper px-3 text-[15px] font-semibold";

/** §12 Reminders: weekly "check your meter", by push where possible, else an in-app banner. */
export function ReminderSettings() {
  const { userDoc, update } = useUserDoc();
  // Client-only screen (behind the app gate), so browser checks can run in initialisers.
  const [support] = useState<PushSupport>(pushSupport);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [zones] = useState<string[]>(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    isPushSubscribed().then(setSubscribed).catch(() => {});
  }, []);

  if (!userDoc) return <SettingsPage title="Reminders">{null}</SettingsPage>;
  const r = userDoc.settings.reminder;

  const save = async (p: Partial<Reminder>) => {
    setBusy(true);
    try {
      await update({ settings: { reminder: p } });
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    const timezone = r.timezone === DEFAULT_TIMEZONE ? deviceTimezone() : r.timezone;
    try {
      if (support === "supported") {
        try {
          await enablePush();
          setSubscribed(true);
        } catch (e) {
          if (e instanceof PushPermissionError)
            setNote(
              e.permission === "denied"
                ? "Notifications are blocked for Calgy in your browser settings. We'll show a reminder in the app instead."
                : "No notifications allowed. We'll show a reminder in the app instead.",
            );
          else if (isApiError(e, "not_available_in_dev"))
            setNote("Push reminders are available when the server is connected. We'll show a reminder in the app for now.");
          else setNote(`${apiErrorMessage(e)} We'll show a reminder in the app instead.`);
        }
      }
      await update({ settings: { reminder: { enabled: true, timezone } } });
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setNote(null);
    try {
      await disablePush().catch((e) => console.warn("Calgy: unsubscribe failed", e));
      setSubscribed(false);
      await update({ settings: { reminder: { enabled: false } } });
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await getApi().testPush();
      setNote("Test reminder sent. It can take a minute to arrive.");
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const how =
    support === "ios_needs_install"
      ? "Add Calgy to your home screen to get reminders. Until then we'll show a reminder in the app."
      : support === "unsupported"
        ? "This browser can't send notifications, so we'll show a reminder in Calgy when your last reading is a week old."
        : subscribed && notificationPermission() === "granted"
          ? "We'll send a notification at that time."
          : "We'll show a reminder in Calgy when your last reading is a week old.";

  return (
    <SettingsPage title="Reminders">
      <OfflineGate>
        <Card>
          <Toggle
            label="Remind me to check my meter"
            hint="Once a week. One number keeps your estimates accurate."
            checked={r.enabled}
            disabled={busy}
            onChange={(on) => void (on ? turnOn() : turnOff())}
          />
          {r.enabled && (
            <>
              <div className="flex gap-2">
                <select aria-label="Reminder day" value={r.day} disabled={busy} onChange={(e) => save({ day: Number(e.target.value) })} className={select}>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DOW[d]}
                    </option>
                  ))}
                </select>
                <select aria-label="Reminder time" value={toQuarter(r.time)} disabled={busy} onChange={(e) => save({ time: e.target.value })} className={select}>
                  {QUARTER_HOURS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Time zone</span>
                {zones.length ? (
                  <select value={r.timezone} disabled={busy} onChange={(e) => save({ timezone: e.target.value })} className={select}>
                    {(zones.includes(r.timezone) ? zones : [r.timezone, ...zones]).map((z) => (
                      <option key={z} value={z}>
                        {z.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-sm">{r.timezone}</span>
                )}
              </label>
              <span className="text-[13px] leading-[1.4] text-muted">{how}</span>
              {subscribed && (
                <button type="button" disabled={busy} onClick={test} className={`${btn} self-start`}>
                  Send test reminder
                </button>
              )}
            </>
          )}
          {note && <span className="text-[13px] leading-[1.4] text-body-2">{note}</span>}
        </Card>
      </OfflineGate>
    </SettingsPage>
  );
}
