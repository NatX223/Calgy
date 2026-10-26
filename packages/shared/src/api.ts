// HTTP contract between the web app and the API (see the backend spec). Both sides validate with these.
import { z } from "zod";
import { UserDocSchema } from "./user-doc.ts";

export const API_PATHS = {
  session: "/v1/session",
  logout: "/v1/session/logout",
  me: "/v1/me",
  merge: "/v1/account/merge",
  discardAnonymous: "/v1/account/discard-anonymous",
  account: "/v1/account",
  vapidKey: "/v1/push/vapid-key",
  pushSubscribe: "/v1/push/subscribe",
  pushTest: "/v1/push/test",
} as const;

/** Header every client request carries (lets the API reject plain cross-site form posts). */
export const CLIENT_HEADER = "X-Calgy-Client";

export const SessionRequestSchema = z.object({ idToken: z.string().min(1) });
export const SessionResponseSchema = UserDocSchema;
export const LogoutRequestSchema = z.object({ revoke: z.boolean().optional() });
export const MergeRequestSchema = z.object({ fromIdToken: z.string().min(1) });
export const MergeResponseSchema = z.object({ merged: z.number().int().min(0) });
export const DiscardAnonymousRequestSchema = MergeRequestSchema;
export const VapidKeyResponseSchema = z.object({ key: z.string().min(1) });

/** `PushSubscription.toJSON()`. */
export const PushSubscriptionSchema = z.object({
  endpoint: z.url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionSchema>;
export const UnsubscribeRequestSchema = z.object({ endpoint: z.url() });

export const API_ERROR_CODES = [
  "bad_request",
  "unauthenticated",
  "token_expired",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal",
] as const;

/** Error body for every 4xx/5xx. `fields` maps a request field to what's wrong with it. */
export const ApiErrorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
