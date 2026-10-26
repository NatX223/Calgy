// Fakes for the HTTP tests: tokens are strings the fake auth understands.
//   "tok:<uid>"   valid ID token (Google user unless registered as anonymous)
//   "anon:<uid>"  valid anonymous ID token
//   "expired"     expired token
//   "revoked:<uid>" valid unless revocation is checked
import type { AddressInfo } from "node:net";
import {
  applyUserDocPatch, defaultUserDoc, type PushSubscriptionBody, type UserDoc, type UserDocPatch,
} from "@calgy/shared";
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { pino } from "pino";
import { createApp } from "../src/app.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { PushGoneError, type AuthPort, type Identity, type PushPayload, type PushSender, type StoredPushSubscription, type UserStore } from "../src/deps.ts";
import { pushSubscriptionId } from "../src/services/firestore-store.ts";

export const ORIGIN = "https://calgy.vercel.app";

export const TEST_CRED = Buffer.from(
  JSON.stringify({ type: "service_account", project_id: "demo-calgy", client_email: "api@demo-calgy.iam.gserviceaccount.com", private_key: "key" }),
).toString("base64");

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    APP_ORIGINS: `${ORIGIN},http://localhost:3000`,
    CRED: TEST_CRED,
    VAPID_PUBLIC_KEY: "BPublicKey",
    VAPID_PRIVATE_KEY: "private",
    VAPID_SUBJECT: "mailto:test@example.com",
    ...env,
  });
}

const authErr = (code: string) => Object.assign(new Error(code), { code });

export class FakeAuth implements AuthPort {
  /** uid → providers (empty = anonymous). */
  users = new Map<string, string[]>();
  deleted: string[] = [];
  revoked: string[] = [];

  private decode(token: string, checkRevoked: boolean): DecodedIdToken {
    if (token === "expired") throw authErr("auth/id-token-expired");
    const [kind, uid] = token.split(":");
    if (!uid) throw authErr("auth/argument-error");
    if (kind === "revoked" && checkRevoked) throw authErr("auth/id-token-revoked");
    if (!["tok", "anon", "revoked"].includes(kind)) throw authErr("auth/argument-error");
    if (!this.users.has(uid)) this.users.set(uid, kind === "anon" ? [] : ["google.com"]);
    const provider = kind === "anon" ? "anonymous" : (this.users.get(uid)![0] ?? "anonymous");
    return { uid, firebase: { sign_in_provider: provider } } as unknown as DecodedIdToken;
  }

  verifyIdToken = async (token: string, checkRevoked = false) => this.decode(token, checkRevoked);
  verifySessionCookie = async (cookie: string, checkRevoked = false) => {
    if (!cookie.startsWith("session:")) throw authErr("auth/argument-error");
    return this.decode(cookie.slice("session:".length), checkRevoked);
  };
  createSessionCookie = async (token: string) => `session:${token}`;
  getUser = async (uid: string) =>
    ({ uid, providerData: (this.users.get(uid) ?? []).map((providerId) => ({ providerId })) }) as unknown as UserRecord;
  revokeRefreshTokens = async (uid: string) => void this.revoked.push(uid);
  deleteUser = async (uid: string) => {
    if (!this.users.delete(uid)) throw authErr("auth/user-not-found");
    this.deleted.push(uid);
  };
}

type Logs = Map<string, Record<string, unknown>>;

export class FakeStore implements UserStore {
  docs = new Map<string, UserDoc>();
  identities = new Map<string, Identity>();
  logs = new Map<string, Logs>(); // `${uid}/${collection}` → id → doc
  subs = new Map<string, Map<string, StoredPushSubscription>>();

  coll(uid: string, name: string) {
    const k = `${uid}/${name}`;
    if (!this.logs.has(k)) this.logs.set(k, new Map());
    return this.logs.get(k)!;
  }

  async ensure(uid: string, identity: Identity) {
    if (!this.docs.has(uid)) this.docs.set(uid, defaultUserDoc(uid));
    this.identities.set(uid, identity);
    return this.docs.get(uid)!;
  }
  async patch(uid: string, patch: UserDocPatch, identity: Identity) {
    const next = applyUserDocPatch(await this.ensure(uid, identity), patch, new Date().toISOString());
    this.docs.set(uid, next);
    return next;
  }
  async mergeInto(fromUid: string, toUid: string) {
    let n = 0;
    for (const [k, docs] of this.logs) {
      if (!k.startsWith(`${fromUid}/`)) continue;
      const target = this.coll(toUid, k.slice(fromUid.length + 1));
      for (const [id, d] of docs) if (!target.has(id)) (target.set(id, d), n++);
    }
    for (const [id, s] of this.subs.get(fromUid) ?? []) {
      const t = this.subs.get(toUid) ?? new Map();
      if (!t.has(id)) (t.set(id, s), n++);
      this.subs.set(toUid, t);
    }
    return n;
  }
  async deleteAll(uid: string) {
    this.docs.delete(uid);
    this.subs.delete(uid);
    for (const k of [...this.logs.keys()]) if (k.startsWith(`${uid}/`)) this.logs.delete(k);
  }
  async addPushSubscription(uid: string, sub: PushSubscriptionBody) {
    const m = this.subs.get(uid) ?? new Map();
    m.set(pushSubscriptionId(sub.endpoint), { id: pushSubscriptionId(sub.endpoint), endpoint: sub.endpoint, keys: sub.keys });
    this.subs.set(uid, m);
  }
  async removePushSubscription(uid: string, endpoint: string) {
    this.subs.get(uid)?.delete(pushSubscriptionId(endpoint));
  }
  async listPushSubscriptions(uid: string) {
    return [...(this.subs.get(uid)?.values() ?? [])];
  }
  async deletePushSubscription(uid: string, id: string) {
    this.subs.get(uid)?.delete(id);
  }
}

export class FakePush implements PushSender {
  sent: { endpoint: string; payload: PushPayload }[] = [];
  gone = new Set<string>();
  async send(sub: StoredPushSubscription, payload: PushPayload) {
    if (this.gone.has(sub.endpoint)) throw new PushGoneError("410");
    this.sent.push({ endpoint: sub.endpoint, payload });
  }
}

export type TestServer = {
  url: string;
  auth: FakeAuth;
  store: FakeStore;
  push: FakePush;
  close: () => Promise<void>;
  /** fetch with the client header and JSON body set. */
  call: (method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
};

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const auth = new FakeAuth();
  const store = new FakeStore();
  const push = new FakePush();
  const app = createApp({ config: testConfig(env), log: pino({ level: "silent" }), auth, store, push });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    auth,
    store,
    push,
    close: () => new Promise((r) => server.close(() => r())),
    call: (method, path, { token, body, headers = {} } = {}) =>
      fetch(url + path, {
        method,
        headers: {
          "X-Calgy-Client": "1",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}
