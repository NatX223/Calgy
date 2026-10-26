// Weekly "check your meter" push (§10.1). Runs every 15 minutes; a user is due when the current
// quarter-hour in their time zone holds their reminder time and nothing was sent in the last 6 days.
import type { UserDoc } from "@calgy/shared";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Logger } from "pino";
import type { PushPayload, PushSender, UserStore } from "../deps.js";
import { sendToUser } from "../services/push.js";
import { decodeUserDoc } from "../services/user-doc.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0 = Sunday) and minute of the day at `date` in `timeZone`. */
export function zonedClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { weekday: WEEKDAYS[parts.weekday], minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

const quarter = (minuteOfDay: number) => Math.floor(minuteOfDay / 15);

export function reminderDue(reminder: UserDoc["settings"]["reminder"], lastSentAt: string | null, now: Date): boolean {
  if (!reminder.enabled) return false;
  let clock;
  try {
    clock = zonedClock(now, reminder.timezone);
  } catch {
    return false; // unknown zone (validated on write, but old docs may hold anything)
  }
  const [h, m] = reminder.time.split(":").map(Number);
  if (clock.weekday !== reminder.day || quarter(clock.minute) !== quarter(h * 60 + m)) return false;
  // "Once a week": 6 days leaves room for the user moving the reminder a day or two earlier.
  return !lastSentAt || now.getTime() - Date.parse(lastSentAt) > 6 * DAY_MS;
}

export const STALE_READING_DAYS = 14;

export function reminderPayload(latestReadingAt: string | null, now: Date): PushPayload {
  const stale = latestReadingAt != null && now.getTime() - Date.parse(latestReadingAt) > STALE_READING_DAYS * DAY_MS;
  return {
    title: "Check your meter",
    body: stale ? "It's been a while — a quick reading helps a lot." : "One quick reading keeps your estimates accurate.",
    url: "/app?log=reading",
    tag: "calgy-reminder",
  };
}

export async function runReminders(deps: { db: Firestore; store: UserStore; push: PushSender; log: Logger }, now = new Date()) {
  const { db, store, push, log } = deps;
  const snap = await db.collection("users").where("settings.reminder.enabled", "==", true).get();
  let sent = 0;
  for (const d of snap.docs) {
    try {
      const { doc, meta } = decodeUserDoc(d.data(), d.id);
      if (!reminderDue(doc.settings.reminder, meta.reminderLastSentAt, now)) continue;
      const latest = await d.ref.collection("meterReadings").orderBy("takenAt", "desc").limit(1).get();
      const takenAt = latest.docs[0]?.get("takenAt");
      const latestAt = takenAt instanceof Timestamp ? takenAt.toDate().toISOString() : null;
      const r = await sendToUser(store, push, log, d.id, reminderPayload(latestAt, now));
      // Mark it sent even with no live subscriptions, so a user without devices isn't retried every 15 minutes.
      await d.ref.update({ "settings.reminder.lastSentAt": Timestamp.fromDate(now) });
      sent += r.sent;
    } catch (e) {
      log.error({ err: e, uid: d.id }, "reminder failed");
    }
  }
  log.info({ candidates: snap.size, sent }, "reminders run");
}
