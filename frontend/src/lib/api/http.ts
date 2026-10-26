// The real API on the VM. Bearer mode (default) sends the ID token on every call; cookie mode
// relies on the httpOnly session cookie from POST /v1/session (only works on a shared domain).
import {
  API_PATHS, ApiErrorBodySchema, CLIENT_HEADER, MergeResponseSchema, SessionResponseSchema, UserDocSchema,
  VapidKeyResponseSchema, type PushSubscriptionBody, type UserDoc, type UserDocPatch,
} from "@calgy/shared";
import type { z } from "zod";
import { ApiError, type ApiClient, type TokenSource } from "./types";

export type HttpApiOptions = {
  baseUrl: string;
  authMode: "bearer" | "cookie";
  tokens: TokenSource;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Called when a request still fails auth after one refresh + retry. */
  onAuthFailure?: (e: ApiError) => void;
  isOnline?: () => boolean;
};

type Req = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown; auth?: boolean };

export const REQUEST_TIMEOUT_MS = 15_000;
const AUTH_CODES = new Set(["unauthenticated", "token_expired"]);

export class HttpApi implements ApiClient {
  private readonly o: Required<Omit<HttpApiOptions, "onAuthFailure">> & Pick<HttpApiOptions, "onAuthFailure">;

  constructor(opts: HttpApiOptions) {
    this.o = {
      fetch: (...a) => globalThis.fetch(...a),
      timeoutMs: REQUEST_TIMEOUT_MS,
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      ...opts,
      baseUrl: opts.baseUrl.replace(/\/+$/, ""),
    };
  }

  // ——— Transport ———

  private async send({ method, path, body, auth = true }: Req, forceToken = false): Promise<Response> {
    if (!this.o.isOnline()) throw new ApiError({ code: "offline", message: "You're offline." });
    const headers: Record<string, string> = { [CLIENT_HEADER]: "1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const bearer = this.o.authMode === "bearer";
    if (bearer && auth) {
      const token = await this.o.tokens.getIdToken(forceToken);
      if (!token) throw new ApiError({ status: 401, code: "unauthenticated", message: "Not signed in." });
      headers.Authorization = `Bearer ${token}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    try {
      return await this.o.fetch(this.o.baseUrl + path, {
        method,
        credentials: bearer ? "omit" : "include",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw new ApiError({ code: "timeout", message: "The request timed out." });
      throw new ApiError({ code: "offline", message: e instanceof Error ? e.message : "Network error" });
    } finally {
      clearTimeout(timer);
    }
  }

  private async toError(res: Response): Promise<ApiError> {
    let parsed: z.infer<typeof ApiErrorBodySchema> | null = null;
    try {
      const r = ApiErrorBodySchema.safeParse(await res.json());
      if (r.success) parsed = r.data;
    } catch {
      // not JSON
    }
    return new ApiError({
      status: res.status,
      code: parsed?.code ?? (res.status === 401 ? "unauthenticated" : `http_${res.status}`),
      message: parsed?.message ?? res.statusText,
      fields: parsed?.fields,
    });
  }

  /** One request, with a single refresh-and-retry on 401 (§5.3). */
  private async request<T>(req: Req, schema?: z.ZodType<T>): Promise<T> {
    let res = await this.send(req);
    if (res.status === 401 && req.auth !== false) {
      const first = await this.toError(res);
      if (!AUTH_CODES.has(first.code)) throw first;
      if (this.o.authMode === "cookie") {
        try {
          const token = await this.o.tokens.getIdToken(true);
          if (token) await this.createSession(token);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) this.o.onAuthFailure?.(e);
          throw e;
        }
        res = await this.send(req);
      } else {
        res = await this.send(req, true);
      }
      if (res.status === 401) {
        const err = await this.toError(res);
        this.o.onAuthFailure?.(err);
        throw err;
      }
    }
    if (!res.ok) throw await this.toError(res);
    if (!schema) return undefined as T;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError({ status: res.status, code: "bad_response", message: "The server sent an unreadable reply." });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ApiError({ status: res.status, code: "bad_response", message: "The server sent an unexpected reply." });
    return parsed.data;
  }

  // ——— Endpoints ———

  createSession(idToken: string): Promise<UserDoc> {
    return this.request({ method: "POST", path: API_PATHS.session, body: { idToken }, auth: false }, SessionResponseSchema);
  }
  logout() {
    return this.request<void>({ method: "POST", path: API_PATHS.logout, body: {} });
  }
  getMe() {
    return this.request({ method: "GET", path: API_PATHS.me }, UserDocSchema);
  }
  updateMe(patch: UserDocPatch) {
    return this.request({ method: "PATCH", path: API_PATHS.me, body: patch }, UserDocSchema);
  }
  mergeAccount(fromIdToken: string) {
    return this.request({ method: "POST", path: API_PATHS.merge, body: { fromIdToken } }, MergeResponseSchema);
  }
  discardAnonymous(fromIdToken: string) {
    return this.request<void>({ method: "POST", path: API_PATHS.discardAnonymous, body: { fromIdToken } });
  }
  deleteAccount() {
    return this.request<void>({ method: "DELETE", path: API_PATHS.account });
  }
  async getVapidKey() {
    return (await this.request({ method: "GET", path: API_PATHS.vapidKey }, VapidKeyResponseSchema)).key;
  }
  subscribePush(sub: PushSubscriptionBody) {
    return this.request<void>({ method: "POST", path: API_PATHS.pushSubscribe, body: sub });
  }
  unsubscribePush(endpoint: string) {
    return this.request<void>({ method: "DELETE", path: API_PATHS.pushSubscribe, body: { endpoint } });
  }
  testPush() {
    return this.request<void>({ method: "POST", path: API_PATHS.pushTest });
  }
}
