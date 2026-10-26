import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { AuthPort, Identity } from "../deps.js";
import { HttpError, unauthenticated } from "../errors.js";

export const SESSION_COOKIE = "__calgy_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid?: string;
      isAnonymous?: boolean;
    }
  }
}

const EXPIRED = new Set(["auth/id-token-expired", "auth/session-cookie-expired"]);

/** firebase-admin auth error → 401 with the code the client retries on. */
export function authError(e: unknown): HttpError {
  const code = (e as { code?: string })?.code ?? "";
  if (EXPIRED.has(code)) return new HttpError(401, "token_expired", "Your session expired.");
  return unauthenticated();
}

export const isAnonymousToken = (t: DecodedIdToken) => t.firebase?.sign_in_provider === "anonymous";

/** Providers come from the auth record (the token's sign_in_provider is only how this session started). */
export async function identityOf(auth: AuthPort, uid: string): Promise<Identity> {
  const user = await auth.getUser(uid);
  const providers = [...new Set(user.providerData.map((p) => p.providerId))].sort();
  return providers.length ? { isAnonymous: false, authProviders: providers } : { isAnonymous: true, authProviders: ["anonymous"] };
}

const bearer = (req: Request) => {
  const h = req.headers.authorization;
  const m = h && /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
};

/**
 * Sets req.uid / req.isAnonymous from the bearer ID token (default) or the session cookie.
 * `checkRevoked` costs an extra lookup, so only account routes use it (cookies are always checked).
 */
export function requireAuth(auth: AuthPort, mode: "bearer" | "cookie", opts: { checkRevoked?: boolean } = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    let decoded: DecodedIdToken;
    try {
      if (mode === "bearer") {
        const token = bearer(req);
        if (!token) return next(unauthenticated());
        decoded = await auth.verifyIdToken(token, opts.checkRevoked ?? false);
      } else {
        const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
        if (!cookie) return next(unauthenticated());
        decoded = await auth.verifySessionCookie(cookie, true);
      }
    } catch (e) {
      return next(authError(e));
    }
    req.uid = decoded.uid;
    req.isAnonymous = isAnonymousToken(decoded);
    next();
  };
}
