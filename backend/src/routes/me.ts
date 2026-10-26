import { UserDocPatchSchema } from "@calgy/shared";
import { Router } from "express";
import type { Deps } from "../deps.js";
import { parse } from "../errors.js";
import { identityOf } from "../middleware/auth.js";

/** GET/PATCH /v1/me. Mounted behind requireAuth. */
export function meRouter({ auth, store }: Deps) {
  const r = Router();

  // Normally POST /v1/session made the doc already; creating it here too keeps GET from 404ing.
  r.get("/", async (req, res) => {
    res.json(await store.ensure(req.uid!, await identityOf(auth, req.uid!)));
  });

  /** §9.3: only the fields in UserDocPatchSchema (strict: anything else is a 400). */
  r.patch("/", async (req, res) => {
    const patch = parse(UserDocPatchSchema, req.body, "Invalid settings.");
    res.json(await store.patch(req.uid!, patch, await identityOf(auth, req.uid!)));
  });

  return r;
}
