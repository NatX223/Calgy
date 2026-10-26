import { describe, expect, test } from "vitest";
import { ConfigError, parseEnv } from "./env";

const base = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "calgy.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "calgy",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:2:web:3",
};

describe("startup checks", () => {
  test("defaults: dev shim, bearer, no emulators", () => {
    const e = parseEnv(base, { nodeEnv: "development" });
    expect(e).toMatchObject({ apiMode: "dev", authMode: "bearer", useEmulators: false, apiUrl: "" });
  });

  test("missing Firebase config names the variables", () => {
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_FIREBASE_API_KEY: "" }, {})).toThrow(/NEXT_PUBLIC_FIREBASE_API_KEY/);
  });

  test("http:// API on an https: page throws", () => {
    const raw = { ...base, NEXT_PUBLIC_API_MODE: "http", NEXT_PUBLIC_API_URL: "http://1-2-3-4.sslip.io" };
    expect(() => parseEnv(raw, { nodeEnv: "production", pageProtocol: "https:" })).toThrow("API must be HTTPS in production");
    expect(() => parseEnv(raw, { nodeEnv: "development", pageProtocol: "http:" })).not.toThrow();
  });

  test("production build with the dev shim throws", () => {
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_API_MODE: "dev" }, { nodeEnv: "production" })).toThrow(ConfigError);
    expect(() => parseEnv(base, { nodeEnv: "production" })).toThrow(/API_MODE=dev/);
  });

  test("http mode needs an API URL; trailing slash trimmed", () => {
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_API_MODE: "http" }, {})).toThrow(/NEXT_PUBLIC_API_URL is required/);
    const e = parseEnv({ ...base, NEXT_PUBLIC_API_MODE: "http", NEXT_PUBLIC_API_URL: "https://1-2-3-4.sslip.io/" }, { nodeEnv: "production", pageProtocol: "https:" });
    expect(e.apiUrl).toBe("https://1-2-3-4.sslip.io");
  });

  test("auth mode and emulators", () => {
    const e = parseEnv({ ...base, NEXT_PUBLIC_AUTH_MODE: "cookie", NEXT_PUBLIC_USE_EMULATORS: "true" }, {});
    expect(e.authMode).toBe("cookie");
    expect(e.useEmulators).toBe(true);
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_AUTH_MODE: "session" }, {})).toThrow(/NEXT_PUBLIC_AUTH_MODE/);
  });
});
