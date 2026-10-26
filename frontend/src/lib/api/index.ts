import { firebaseTokens } from "../auth/current";
import { env } from "../env";
import { DevApi } from "./dev";
import { HttpApi } from "./http";
import type { ApiClient, ApiError } from "./types";

export * from "./types";

let api: ApiClient | null = null;
const authFailure = new Set<(e: ApiError) => void>();

/** HttpApi when NEXT_PUBLIC_API_MODE=http, else the dev shim. */
export function getApi(): ApiClient {
  if (api) return api;
  const e = env();
  api =
    e.apiMode === "http"
      ? new HttpApi({
          baseUrl: e.apiUrl,
          authMode: e.authMode,
          tokens: firebaseTokens,
          onAuthFailure: (err) => authFailure.forEach((l) => l(err)),
        })
      : new DevApi();
  return api;
}

/** A request still failed auth after refresh + retry (AuthProvider shows "Try again"). */
export function onApiAuthFailure(l: (e: ApiError) => void) {
  authFailure.add(l);
  return () => {
    authFailure.delete(l);
  };
}
