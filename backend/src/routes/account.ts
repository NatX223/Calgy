import { DiscardAnonymousRequestSchema, MergeRequestSchema } from "@calgy/shared";
import { Router, type Request } from "express";
import type { AuthPort, Deps } from "../deps.js";
import { forbidden, parse } from "../errors.js";
import { isAnonymousToken } from "../middleware/auth.js";
import { clearSessionCookie } from "./session.js";

/** The anonymous user behind `fromIdToken`, if it's a different, anonymous account (§9.5). */
async function anonymousSource(auth: AuthPort, req: Request, fromIdToken: string) {
  const from = await auth.verifyIdToken(fromIdToken).catch(() => {
    throw forbidden("That sign-in has expired. Start again.");
  });
  if (from.uid === req.uid) throw forbidden("Can't merge an account into itself.");
  if (!isAnonymousToken(from)) throw forbidden("Only a guest account can be merged.");
  return from.uid;
}

/** Already deleted on an earlier try → fine. */
async function deleteAuthUser(auth: AuthPort, uid: string) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }
}

/** /v1/account/*. Mounted behind requireAuth with revocation checks. Every step is safe to retry. */
export function accountRouter({ config, auth, store, log }: Deps) {
  const r = Router();

  r.post("/merge", async (req, res) => {
    const { fromIdToken } = parse(MergeRequestSchema, req.body);
    const anonUid = await anonymousSource(auth, req, fromIdToken);
    const merged = await store.mergeInto(anonUid, req.uid!);
    await store.deleteAll(anonUid);
    await deleteAuthUser(auth, anonUid);
    log.info({ uid: req.uid, merged }, "merged guest account");
    res.json({ merged });
  });

  r.post("/discard-anonymous", async (req, res) => {
    const { fromIdToken } = parse(DiscardAnonymousRequestSchema, req.body);
    const anonUid = await anonymousSource(auth, req, fromIdToken);
    await store.deleteAll(anonUid);
    await deleteAuthUser(auth, anonUid);
    res.status(204).end();
  });

  r.delete("/", async (req, res) => {
    await store.deleteAll(req.uid!);
    await deleteAuthUser(auth, req.uid!);
    clearSessionCookie(res, config);
    log.info({ uid: req.uid }, "deleted account");
    res.status(204).end();
  });

  return r;
}
