import { PushSubscriptionSchema, UnsubscribeRequestSchema } from "@calgy/shared";
import { Router } from "express";
import type { Deps } from "../deps.js";
import { parse } from "../errors.js";
import { sendToUser } from "../services/push.js";

/** /v1/push/*. Mounted behind requireAuth. */
export function pushRouter({ config, store, push, log }: Deps) {
  const r = Router();

  r.get("/vapid-key", (_req, res) => {
    res.json({ key: config.vapid.publicKey });
  });

  r.post("/subscribe", async (req, res) => {
    const sub = parse(PushSubscriptionSchema, req.body, "Invalid push subscription.");
    await store.addPushSubscription(req.uid!, sub, req.get("user-agent") ?? null);
    res.status(204).end();
  });

  r.delete("/subscribe", async (req, res) => {
    const { endpoint } = parse(UnsubscribeRequestSchema, req.body);
    await store.removePushSubscription(req.uid!, endpoint);
    res.status(204).end();
  });

  r.post("/test", async (req, res) => {
    await sendToUser(store, push, log, req.uid!, {
      title: "Test reminder from Calgy",
      body: "Reminders are working on this device.",
      url: "/app/settings/reminders",
      tag: "calgy-test",
    });
    res.status(204).end();
  });

  return r;
}
