import { CLIENT_HEADER } from "@calgy/shared";
import cors from "cors";
import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Config } from "../config.js";
import { forbidden, HttpError } from "../errors.js";

export function originAllowed(config: Pick<Config, "appOrigins" | "previewPattern">, origin: string | undefined) {
  if (!origin) return false;
  return config.appOrigins.includes(origin) || !!config.previewPattern?.test(origin);
}

/** Unknown origins get no allow-origin header (the browser blocks them); no Origin (curl) passes. */
export function corsMiddleware(config: Config): RequestHandler {
  return cors({
    origin: (origin, cb) => cb(null, !origin || originAllowed(config, origin)),
    credentials: config.authMode === "cookie",
    allowedHeaders: ["Authorization", "Content-Type", CLIENT_HEADER],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
}

const STATE_CHANGING = new Set(["POST", "PATCH", "DELETE"]);

/**
 * State-changing requests must carry X-Calgy-Client (a cross-site form can't set it, and setting it
 * forces a CORS preflight). In cookie mode the browser sends credentials by itself, so the Origin
 * must also be one of ours.
 */
export function csrf(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (!STATE_CHANGING.has(req.method)) return next();
    if (req.get(CLIENT_HEADER) !== "1") return next(forbidden(`Missing ${CLIENT_HEADER} header.`));
    if (config.authMode === "cookie" && !originAllowed(config, req.get("origin"))) return next(forbidden("Origin not allowed."));
    next();
  };
}

const limited = () => new HttpError(429, "rate_limited", "Too many requests. Try again in a minute.");

/** Before auth: per client IP (Caddy's X-Forwarded-For; see `trust proxy` in app.ts). */
export const ipRateLimit = (limit = 120) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, _res, next) => next(limited()),
  });

/** After auth: 60 requests a minute per user. */
export const uidRateLimit = (limit = 60) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => `uid:${req.uid}`,
    handler: (_req, _res, next) => next(limited()),
  });
