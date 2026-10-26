import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { Deps } from "./deps.js";
import { errorHandler, HttpError, notFound } from "./errors.js";
import { requireAuth } from "./middleware/auth.js";
import { corsMiddleware, csrf, ipRateLimit, uidRateLimit } from "./middleware/security.js";
import { accountRouter } from "./routes/account.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { pushRouter } from "./routes/push.js";
import { sessionRouter } from "./routes/session.js";

/** Order (§8): helmet → CORS → JSON → cookies → rate limit → CSRF → routes. */
export function createApp(deps: Deps) {
  const { config, auth, log } = deps;
  const app = express();
  // Caddy on the same host sets X-Forwarded-For; trust it (and only it) for req.ip.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: "100kb" }));
  if (config.authMode === "cookie") app.use(cookieParser());

  app.use("/health", healthRouter);

  app.use(ipRateLimit());
  app.use(csrf(config));

  const authed = requireAuth(auth, config.authMode);
  const authedRevoked = requireAuth(auth, config.authMode, { checkRevoked: true });
  const perUser = uidRateLimit();

  app.use("/v1/session", sessionRouter(deps));
  app.use("/v1/me", authed, perUser, meRouter(deps));
  app.use("/v1/account", authedRevoked, perUser, accountRouter(deps));
  app.use("/v1/push", authed, perUser, pushRouter(deps));
  app.post("/v1/ocr/meter", authed, perUser, () => {
    throw new HttpError(501, "not_implemented", "Coming soon");
  });

  app.use(notFound);
  app.use(errorHandler(log));
  return app;
}
