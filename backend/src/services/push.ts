import webpush, { WebPushError } from "web-push";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import { PushGoneError, type PushPayload, type PushSender, type UserStore } from "../deps.js";

/** One day: a reminder that can't be delivered by then isn't worth showing. */
const TTL_SECONDS = 24 * 60 * 60;

export function webPushSender(config: Config): PushSender {
  const { publicKey, privateKey, subject } = config.vapid;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (e) {
    throw new Error(`Invalid VAPID settings: ${(e as Error).message} (generate with: npx web-push generate-vapid-keys)`);
  }
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: TTL_SECONDS });
      } catch (e) {
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) throw new PushGoneError(e.message);
        throw e;
      }
    },
  };
}

/**
 * Send to every subscription the user has; drop the ones the push service says are gone.
 * Returns how many were delivered. Other failures are logged, not thrown, so one bad device
 * doesn't stop the rest.
 */
export async function sendToUser(store: UserStore, push: PushSender, log: Logger, uid: string, payload: PushPayload) {
  const subs = await store.listPushSubscriptions(uid);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await push.send(s, payload);
        sent++;
      } catch (e) {
        if (e instanceof PushGoneError) await store.deletePushSubscription(uid, s.id);
        else log.warn({ err: e, uid, sub: s.id }, "push failed");
      }
    }),
  );
  return { sent, total: subs.length };
}
