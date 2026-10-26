import type { PushSubscriptionBody, UserDoc, UserDocPatch } from "@calgy/shared";

export interface ApiClient {
  createSession(idToken: string): Promise<UserDoc>;
  logout(): Promise<void>;
  getMe(): Promise<UserDoc>;
  updateMe(patch: UserDocPatch): Promise<UserDoc>;
  mergeAccount(fromIdToken: string): Promise<{ merged: number }>;
  discardAnonymous(fromIdToken: string): Promise<void>;
  deleteAccount(): Promise<void>;
  getVapidKey(): Promise<string>;
  subscribePush(sub: PushSubscriptionBody): Promise<void>;
  unsubscribePush(endpoint: string): Promise<void>;
  testPush(): Promise<void>;
}

/** Client-side codes on top of the API's own (`API_ERROR_CODES`). */
export type ClientErrorCode = "offline" | "timeout" | "bad_response" | "not_available_in_dev";

export class ApiError extends Error {
  name = "ApiError";
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(init: { status?: number; code: string; message?: string; fields?: Record<string, string> }) {
    super(init.message ?? init.code);
    this.status = init.status ?? 0;
    this.code = init.code;
    this.fields = init.fields;
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (code == null || e.code === code);

/** Copy for an error shown next to a control. */
export function apiErrorMessage(e: unknown): string {
  if (isApiError(e, "offline")) return "Needs a connection.";
  if (isApiError(e, "timeout")) return "The server took too long. Try again.";
  if (isApiError(e, "not_available_in_dev")) return "Available when the server is connected.";
  if (isApiError(e, "rate_limited")) return "Too many tries. Wait a minute and try again.";
  if (isApiError(e, "unauthenticated") || isApiError(e, "token_expired")) return "Your session ended. Try again.";
  return "Something went wrong. Try again.";
}

/** Where the API gets Firebase ID tokens. `null` = no signed-in user (after waiting for auth to start). */
export interface TokenSource {
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
}
