import { defaultUserDoc } from "@calgy/shared";
import { describe, expect, test, vi } from "vitest";
import { HttpApi } from "./http";
import { ApiError, type TokenSource } from "./types";

const DOC = defaultUserDoc("u1", "2026-10-01T09:00:00.000Z");
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const unauth = (code = "token_expired") => json(401, { code, message: "nope" });

function setup(mode: "bearer" | "cookie", responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const r = responses.shift();
    if (!r) throw new Error("unexpected request");
    return r;
  });
  const tokens: TokenSource & { calls: boolean[] } = {
    calls: [],
    async getIdToken(force = false) {
      this.calls.push(force);
      return force ? "fresh-token" : "cached-token";
    },
  };
  const onAuthFailure = vi.fn();
  const api = new HttpApi({
    baseUrl: "https://1-2-3-4.sslip.io/",
    authMode: mode,
    tokens,
    fetch: fetch as unknown as typeof globalThis.fetch,
    onAuthFailure,
    isOnline: () => true,
  });
  return { api, calls, tokens, onAuthFailure, fetch };
}

const header = (init: RequestInit, k: string) => (init.headers as Record<string, string>)[k];

describe("bearer mode", () => {
  test("attaches the ID token, omits credentials, sends the client header", async () => {
    const { api, calls } = setup("bearer", [json(200, DOC)]);
    await expect(api.getMe()).resolves.toEqual(DOC);
    expect(calls[0].url).toBe("https://1-2-3-4.sslip.io/v1/me");
    expect(header(calls[0].init, "Authorization")).toBe("Bearer cached-token");
    expect(header(calls[0].init, "X-Calgy-Client")).toBe("1");
    expect(calls[0].init.credentials).toBe("omit");
  });

  test("401 → force-refreshes the token and retries once", async () => {
    const { api, calls, tokens, onAuthFailure } = setup("bearer", [unauth(), json(200, DOC)]);
    await expect(api.updateMe({ household: { fuelWeekly: 1 } })).resolves.toEqual(DOC);
    expect(tokens.calls).toEqual([false, true]);
    expect(header(calls[1].init, "Authorization")).toBe("Bearer fresh-token");
    expect(calls[1].init.method).toBe("PATCH");
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  test("second 401 → error + auth-failure callback (the banner)", async () => {
    const { api, calls, onAuthFailure } = setup("bearer", [unauth(), unauth("unauthenticated")]);
    await expect(api.getMe()).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    expect(calls).toHaveLength(2);
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });

  test("createSession sends the token in the body, no Authorization header, never retries", async () => {
    const { api, calls } = setup("bearer", [json(200, DOC)]);
    await api.createSession("id-token");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ idToken: "id-token" });
    expect(header(calls[0].init, "Authorization")).toBeUndefined();
  });

  test("204 endpoints resolve to undefined", async () => {
    const { api, calls } = setup("bearer", [new Response(null, { status: 204 })]);
    await expect(api.unsubscribePush("https://push.example/abc")).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe("DELETE");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ endpoint: "https://push.example/abc" });
  });
});

describe("cookie mode", () => {
  test("includes credentials and no Authorization header", async () => {
    const { api, calls, tokens } = setup("cookie", [json(200, DOC)]);
    await api.getMe();
    expect(calls[0].init.credentials).toBe("include");
    expect(header(calls[0].init, "Authorization")).toBeUndefined();
    expect(tokens.calls).toEqual([]);
  });

  test("401 → createSession with a fresh token → retries once", async () => {
    const { api, calls } = setup("cookie", [unauth(), json(200, DOC), json(200, DOC)]);
    await expect(api.getMe()).resolves.toEqual(DOC);
    expect(calls.map((c) => c.url.replace("https://1-2-3-4.sslip.io", ""))).toEqual(["/v1/me", "/v1/session", "/v1/me"]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ idToken: "fresh-token" });
  });

  test("still 401 after re-creating the session → error", async () => {
    const { api, onAuthFailure } = setup("cookie", [unauth(), json(200, DOC), unauth()]);
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });
});

describe("errors", () => {
  test("network failure → offline", async () => {
    const { api, fetch } = setup("bearer", []);
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.getMe()).rejects.toMatchObject({ code: "offline" });
  });

  test("navigator offline → offline without a request", async () => {
    const fetch = vi.fn();
    const api = new HttpApi({
      baseUrl: "https://x", authMode: "bearer", tokens: { getIdToken: async () => "t" }, fetch, isOnline: () => false,
    });
    await expect(api.getMe()).rejects.toMatchObject({ code: "offline" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("times out after 15s by default", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      );
      const api = new HttpApi({
        baseUrl: "https://x", authMode: "bearer", tokens: { getIdToken: async () => "t" },
        fetch: fetch as unknown as typeof globalThis.fetch, isOnline: () => true,
      });
      const p = expect(api.getMe()).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(15_000);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  test("API error body → typed ApiError with fields", async () => {
    const { api } = setup("bearer", [json(400, { code: "bad_request", message: "Invalid", fields: { "gridHours.value": "Too big" } })]);
    await expect(api.updateMe({})).rejects.toMatchObject({ status: 400, code: "bad_request", fields: { "gridHours.value": "Too big" } });
  });

  test("response that fails the schema → bad_response", async () => {
    const { api } = setup("bearer", [json(200, { uid: 5 })]);
    await expect(api.getMe()).rejects.toMatchObject({ code: "bad_response" });
  });

  test("no signed-in user → unauthenticated, no request", async () => {
    const fetch = vi.fn();
    const api = new HttpApi({ baseUrl: "https://x", authMode: "bearer", tokens: { getIdToken: async () => null }, fetch, isOnline: () => true });
    await expect(api.getMe()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
