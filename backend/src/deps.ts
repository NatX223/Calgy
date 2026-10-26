// What the routes and jobs need from the outside world. index.ts wires Firebase in; tests pass fakes.
import type { PushSubscriptionBody, UserDoc, UserDocPatch } from "@calgy/shared";
import type { Auth } from "firebase-admin/auth";
import type { Logger } from "pino";
import type { Config } from "./config.js";

export type AuthPort = Pick<
  Auth,
  "verifyIdToken" | "verifySessionCookie" | "createSessionCookie" | "getUser" | "revokeRefreshTokens" | "deleteUser"
>;

/** Who the token says the user is; kept on the user doc. */
export type Identity = { isAnonymous: boolean; authProviders: string[] };

export type StoredPushSubscription = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export interface UserStore {
  /** Create users/{uid} with defaults if missing, and sync the identity fields. Idempotent. */
  ensure(uid: string, identity: Identity): Promise<UserDoc>;
  /** Apply a validated patch (creating the doc first if needed) and return the result. */
  patch(uid: string, patch: UserDocPatch, identity: Identity): Promise<UserDoc>;
  /** Copy the anonymous user's logs, push subscriptions and unset settings into `toUid`; returns docs written. */
  mergeInto(fromUid: string, toUid: string): Promise<number>;
  /** users/{uid} and everything under it. */
  deleteAll(uid: string): Promise<void>;
  addPushSubscription(uid: string, sub: PushSubscriptionBody, userAgent: string | null): Promise<void>;
  removePushSubscription(uid: string, endpoint: string): Promise<void>;
  listPushSubscriptions(uid: string): Promise<StoredPushSubscription[]>;
  deletePushSubscription(uid: string, id: string): Promise<void>;
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

export interface PushSender {
  /** Throws PushGoneError when the push service says the subscription no longer exists. */
  send(sub: StoredPushSubscription, payload: PushPayload): Promise<void>;
}

export class PushGoneError extends Error {
  name = "PushGoneError";
}

export type Deps = {
  config: Config;
  log: Logger;
  auth: AuthPort;
  store: UserStore;
  push: PushSender;
};
