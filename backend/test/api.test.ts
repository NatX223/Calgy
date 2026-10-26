// Run with: npm test -w backend
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { UserDocSchema } from "@calgy/shared";
import { ORIGIN, startServer, type TestServer } from "./helpers.ts";

const SUB = { endpoint: "https://push.example/abc", expirationTime: null, keys: { p256dh: "p", auth: "a" } };

describe("bearer mode", () => {
  let s: TestServer;
  before(async () => (s = await startServer()));
  after(() => s.close());
  beforeEach(() => {
    s.store.docs.clear();
    s.store.logs.clear();
    s.store.subs.clear();
    s.push.sent = [];
  });

  test("health needs no auth", async () => {
    const r = await fetch(`${s.url}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  describe("CORS", () => {
    const preflight = (origin: string) =>
      fetch(`${s.url}/v1/me`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,x-calgy-client" },
      });

    test("allowed origin gets allow-origin and the auth headers, no credentials", async () => {
      const r = await preflight(ORIGIN);
      assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
      assert.match(r.headers.get("access-control-allow-headers") ?? "", /Authorization/);
      assert.equal(r.headers.get("access-control-allow-credentials"), null);
    });

    test("unknown origin gets no allow-origin header", async () => {
      assert.equal((await preflight("https://evil.example")).headers.get("access-control-allow-origin"), null);
    });

    test("preview origins only when enabled, and only full matches", async () => {
      assert.equal((await preflight("https://calgy-git-x.vercel.app")).headers.get("access-control-allow-origin"), null);
      const p = await startServer({ ALLOW_VERCEL_PREVIEWS: "true", VERCEL_PREVIEW_PATTERN: "https://calgy-[a-z0-9-]+\\.vercel\\.app" });
      try {
        const ok = await fetch(`${p.url}/health`, { headers: { Origin: "https://calgy-git-x.vercel.app" } });
        assert.equal(ok.headers.get("access-control-allow-origin"), "https://calgy-git-x.vercel.app");
        const evil = await fetch(`${p.url}/health`, { headers: { Origin: "https://calgy-git-x.vercel.app.evil.example" } });
        assert.equal(evil.headers.get("access-control-allow-origin"), null);
      } finally {
        await p.close();
      }
    });
  });

  describe("auth", () => {
    test("no token → 401 unauthenticated", async () => {
      const r = await s.call("GET", "/v1/me");
      assert.equal(r.status, 401);
      assert.equal((await r.json()).code, "unauthenticated");
    });

    test("garbage token → 401 unauthenticated", async () => {
      assert.equal((await (await s.call("GET", "/v1/me", { token: "nonsense" })).json()).code, "unauthenticated");
    });

    test("expired token → 401 token_expired", async () => {
      const r = await s.call("GET", "/v1/me", { token: "expired" });
      assert.equal(r.status, 401);
      assert.equal((await r.json()).code, "token_expired");
    });

    test("revoked token works on /v1/me but not on /v1/account", async () => {
      assert.equal((await s.call("GET", "/v1/me", { token: "revoked:rita" })).status, 200);
      assert.equal((await s.call("DELETE", "/v1/account", { token: "revoked:rita" })).status, 401);
    });

    test("state-changing requests need X-Calgy-Client", async () => {
      const r = await s.call("PATCH", "/v1/me", { token: "tok:u1", body: {}, headers: { "X-Calgy-Client": "" } });
      assert.equal(r.status, 403);
      assert.equal((await s.call("PATCH", "/v1/me", { token: "tok:u1", body: {} })).status, 200);
    });
  });

  describe("POST /v1/session", () => {
    test("creates the user doc with defaults, sets no cookie, is idempotent", async () => {
      const r = await s.call("POST", "/v1/session", { body: { idToken: "anon:a1" } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("set-cookie"), null);
      const doc = UserDocSchema.parse(await r.json());
      assert.equal(doc.uid, "a1");
      assert.equal(doc.settings.shareAnonymousData, false);
      assert.deepEqual(s.store.identities.get("a1"), { isAnonymous: true, authProviders: ["anonymous"] });
      const again = await (await s.call("POST", "/v1/session", { body: { idToken: "anon:a1" } })).json();
      assert.deepEqual(again, doc);
    });

    test("syncs providers after linking", async () => {
      await s.call("POST", "/v1/session", { body: { idToken: "anon:a2" } });
      s.auth.users.set("a2", ["google.com"]);
      await s.call("POST", "/v1/session", { body: { idToken: "tok:a2" } });
      assert.deepEqual(s.store.identities.get("a2"), { isAnonymous: false, authProviders: ["google.com"] });
    });

    test("missing or bad token", async () => {
      assert.equal((await s.call("POST", "/v1/session", { body: {} })).status, 400);
      assert.equal((await s.call("POST", "/v1/session", { body: { idToken: "expired" } })).status, 401);
    });
  });

  describe("PATCH /v1/me", () => {
    test("updates allowed fields and merges groups", async () => {
      const r = await s.call("PATCH", "/v1/me", {
        token: "tok:u1",
        body: { household: { fuelWeekly: 5000 }, settings: { reminder: { enabled: true, timezone: "Europe/London" } } },
      });
      assert.equal(r.status, 200);
      const doc = UserDocSchema.parse(await r.json());
      assert.equal(doc.household.fuelWeekly, 5000);
      assert.equal(doc.household.tokenMonthly, 0);
      assert.equal(doc.settings.reminder.enabled, true);
      assert.equal(doc.settings.reminder.time, "09:00");
    });

    test("server-owned top-level fields are rejected; unknown nested fields are dropped", async () => {
      for (const body of [{ uid: "x" }, { createdAt: "2020-01-01" }, { isAnonymous: false }, { schemaVersion: 2 }]) {
        const r = await s.call("PATCH", "/v1/me", { token: "tok:u1", body });
        assert.equal(r.status, 400, JSON.stringify(body));
      }
      const r = await s.call("PATCH", "/v1/me", { token: "tok:u1", body: { settings: { reminder: { lastSentAt: "x", enabled: true } } } });
      assert.equal(r.status, 200);
      const reminder = (await r.json()).settings.reminder;
      assert.equal(reminder.enabled, true);
      assert.equal("lastSentAt" in reminder, false);
    });

    test("invalid values → 400 bad_request naming the field", async () => {
      const cases: [unknown, string][] = [
        [{ gridHours: { value: 30 } }, "gridHours.value"],
        [{ tariffOverride: 20000 }, "tariffOverride"],
        [{ tariffOverride: 0 }, "tariffOverride"],
        [{ settings: { reminder: { timezone: "Mars/Olympus" } } }, "settings.reminder.timezone"],
        [{ settings: { reminder: { day: 7 } } }, "settings.reminder.day"],
        [{ meterProfile: { meterStartDate: "2999-01-01" } }, "meterProfile.meterStartDate"],
      ];
      for (const [body, field] of cases) {
        const r = await s.call("PATCH", "/v1/me", { token: "tok:u1", body });
        assert.equal(r.status, 400, JSON.stringify(body));
        const err = await r.json();
        assert.equal(err.code, "bad_request");
        assert.ok(field in err.fields, `${field} in ${JSON.stringify(err.fields)}`);
      }
    });

    test("malformed JSON → 400 without a stack trace", async () => {
      const r = await fetch(`${s.url}/v1/me`, {
        method: "PATCH",
        headers: { "X-Calgy-Client": "1", "Content-Type": "application/json", Authorization: "Bearer tok:u1" },
        body: "{nope",
      });
      assert.equal(r.status, 400);
      assert.deepEqual(Object.keys(await r.json()).sort(), ["code", "message"]);
    });
  });

  describe("account", () => {
    test("merge copies the guest's logs (de-duplicated by id), then deletes the guest", async () => {
      s.auth.users.set("anon1", []);
      s.store.coll("anon1", "tokenLoads").set("t1", { amountNaira: 1 }).set("t2", { amountNaira: 2 });
      s.store.coll("me", "tokenLoads").set("t1", { amountNaira: 99 });
      await s.call("POST", "/v1/session", { body: { idToken: "tok:me" } });

      const r = await s.call("POST", "/v1/account/merge", { token: "tok:me", body: { fromIdToken: "anon:anon1" } });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { merged: 1 });
      assert.deepEqual(s.store.coll("me", "tokenLoads").get("t1"), { amountNaira: 99 });
      assert.ok(s.auth.deleted.includes("anon1"));
      assert.equal(s.store.logs.has("anon1/tokenLoads"), false);

      // Retry after success: nothing left to copy, still fine.
      const again = await s.call("POST", "/v1/account/merge", { token: "tok:me", body: { fromIdToken: "anon:anon1" } });
      assert.deepEqual(await again.json(), { merged: 0 });
    });

    test("merge refuses a non-anonymous source or the same account", async () => {
      assert.equal((await s.call("POST", "/v1/account/merge", { token: "tok:me", body: { fromIdToken: "tok:other" } })).status, 403);
      assert.equal((await s.call("POST", "/v1/account/merge", { token: "anon:x", body: { fromIdToken: "anon:x" } })).status, 403);
      assert.equal((await s.call("POST", "/v1/account/merge", { token: "tok:me", body: { fromIdToken: "expired" } })).status, 403);
    });

    test("discard-anonymous deletes the guest without copying", async () => {
      s.auth.users.set("anon2", []);
      s.store.coll("anon2", "devices").set("d1", {});
      const r = await s.call("POST", "/v1/account/discard-anonymous", { token: "tok:me", body: { fromIdToken: "anon:anon2" } });
      assert.equal(r.status, 204);
      assert.equal(s.store.logs.has("me/devices"), false);
      assert.ok(s.auth.deleted.includes("anon2"));
    });

    test("delete removes data and the auth user", async () => {
      await s.call("POST", "/v1/session", { body: { idToken: "tok:gone" } });
      s.store.coll("gone", "devices").set("d1", {});
      await s.store.addPushSubscription("gone", SUB);
      assert.equal((await s.call("DELETE", "/v1/account", { token: "tok:gone" })).status, 204);
      assert.equal(s.store.docs.has("gone"), false);
      assert.equal(s.store.logs.size, 0);
      assert.equal(s.store.subs.has("gone"), false);
      assert.ok(s.auth.deleted.includes("gone"));
    });
  });

  describe("push", () => {
    test("vapid key", async () => {
      assert.deepEqual(await (await s.call("GET", "/v1/push/vapid-key", { token: "tok:u1" })).json(), { key: "BPublicKey" });
    });

    test("subscribe, test, 410 cleanup, unsubscribe", async () => {
      assert.equal((await s.call("POST", "/v1/push/subscribe", { token: "tok:u1", body: SUB })).status, 204);
      const second = { ...SUB, endpoint: "https://push.example/dead" };
      await s.call("POST", "/v1/push/subscribe", { token: "tok:u1", body: second });
      s.push.gone.add(second.endpoint);

      assert.equal((await s.call("POST", "/v1/push/test", { token: "tok:u1" })).status, 204);
      assert.deepEqual(s.push.sent.map((x) => x.endpoint), [SUB.endpoint]);
      assert.equal(s.push.sent[0].payload.title, "Test reminder from Calgy");
      assert.deepEqual((await s.store.listPushSubscriptions("u1")).map((x) => x.endpoint), [SUB.endpoint]);

      assert.equal((await s.call("DELETE", "/v1/push/subscribe", { token: "tok:u1", body: { endpoint: SUB.endpoint } })).status, 204);
      assert.equal((await s.store.listPushSubscriptions("u1")).length, 0);
    });

    test("bad subscription → 400", async () => {
      assert.equal((await s.call("POST", "/v1/push/subscribe", { token: "tok:u1", body: { endpoint: "nope" } })).status, 400);
    });
  });

  test("OCR is stubbed", async () => {
    const r = await s.call("POST", "/v1/ocr/meter", { token: "tok:u1" });
    assert.equal(r.status, 501);
    assert.deepEqual(await r.json(), { code: "not_implemented", message: "Coming soon" });
  });

  test("unknown route → 404 JSON", async () => {
    const r = await s.call("GET", "/v1/nope", { token: "tok:u1" });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, "not_found");
  });

  test("61st request in a minute from one user → 429 rate_limited", async () => {
    const own = await startServer(); // the per-IP limit is shared by every test on `s`
    try {
      for (let i = 0; i < 60; i++) assert.equal((await own.call("GET", "/v1/push/vapid-key", { token: "tok:busy" })).status, 200);
      const last = await own.call("GET", "/v1/push/vapid-key", { token: "tok:busy" });
      assert.equal(last.status, 429);
      assert.equal((await last.json()).code, "rate_limited");
      assert.equal((await own.call("GET", "/v1/push/vapid-key", { token: "tok:calm" })).status, 200);
    } finally {
      await own.close();
    }
  });
});

describe("cookie mode", () => {
  let s: TestServer;
  before(async () => (s = await startServer({ AUTH_MODE: "cookie", NODE_ENV: "development" })));
  after(() => s.close());

  const withCookie = (cookie: string, extra: Record<string, string> = {}) => ({ headers: { Cookie: cookie, Origin: ORIGIN, ...extra } });

  test("session sets an httpOnly cookie that authenticates later calls", async () => {
    const r = await s.call("POST", "/v1/session", { body: { idToken: "tok:c1" }, headers: { Origin: ORIGIN } });
    assert.equal(r.status, 200);
    const setCookie = r.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /__calgy_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";")[0];
    assert.equal((await s.call("GET", "/v1/me", withCookie(cookie))).status, 200);
    assert.equal((await s.call("GET", "/v1/me")).status, 401);
  });

  test("credentials allowed in CORS", async () => {
    const r = await fetch(`${s.url}/health`, { headers: { Origin: ORIGIN } });
    assert.equal(r.headers.get("access-control-allow-credentials"), "true");
  });

  test("state-changing requests need an allowed Origin", async () => {
    const cookie = "__calgy_session=session:tok:c2";
    assert.equal((await s.call("PATCH", "/v1/me", { body: {}, ...withCookie(cookie) })).status, 200);
    assert.equal((await s.call("PATCH", "/v1/me", { body: {}, ...withCookie(cookie, { Origin: "https://evil.example" }) })).status, 403);
  });

  test("expired cookie → 401 token_expired; logout clears the cookie", async () => {
    const r = await s.call("GET", "/v1/me", withCookie("__calgy_session=session:expired"));
    assert.equal((await r.json()).code, "token_expired");
    const out = await s.call("POST", "/v1/session/logout", { body: { revoke: true }, ...withCookie("__calgy_session=session:tok:c3") });
    assert.equal(out.status, 204);
    assert.match(out.headers.get("set-cookie") ?? "", /__calgy_session=;/);
    assert.ok(s.auth.revoked.includes("c3"));
  });
});
