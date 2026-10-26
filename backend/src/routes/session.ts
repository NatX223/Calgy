import { LogoutRequestSchema, SessionRequestSchema } from "@calgy/shared";
import { Router, type CookieOptions, type Response } from "express";
import type { Deps } from "../deps.js";
import { parse } from "../errors.js";
import { authError, identityOf, requireAuth, SESSION_COOKIE } from "../middleware/auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function cookieOptions(config: Deps["config"]): CookieOptions {
  return {
    httpOnly: true,
    secure: !config.dev,
    sameSite: "lax",
    path: "/",
    ...(config.cookieDomain && !config.dev ? { domain: config.cookieDomain } : {}),
  };
}

export function clearSessionCookie(res: Response, config: Deps["config"]) {
  if (config.authMode === "cookie") res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}

export function sessionRouter({ config, auth, store }: Deps) {
  const r = Router();

  /** §9.1: verify the token, create/sync users/{uid}, set the cookie in cookie mode. */
  r.post("/", async (req, res) => {
    const { idToken } = parse(SessionRequestSchema, req.body);
    let uid: string;
    try {
      uid = (await auth.verifyIdToken(idToken)).uid;
    } catch (e) {
      throw authError(e);
    }
    const doc = await store.ensure(uid, await identityOf(auth, uid));
    if (config.authMode === "cookie") {
      const expiresIn = config.sessionDays * DAY_MS;
      const cookie = await auth.createSessionCookie(idToken, { expiresIn }).catch((e) => {
        throw authError(e);
      });
      res.cookie(SESSION_COOKIE, cookie, { ...cookieOptions(config), maxAge: expiresIn });
    }
    res.json(doc);
  });

  r.post("/logout", requireAuth(auth, config.authMode), async (req, res) => {
    const { revoke } = parse(LogoutRequestSchema, req.body ?? {});
    if (revoke) await auth.revokeRefreshTokens(req.uid!);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  return r;
}
