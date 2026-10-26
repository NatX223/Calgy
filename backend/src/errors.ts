import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import type { z } from "zod";

/** Thrown from handlers; becomes `{ code, message, fields? }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthenticated = (message = "Sign in again.") => new HttpError(401, "unauthenticated", message);
export const forbidden = (message = "Not allowed.") => new HttpError(403, "forbidden", message);

export const zodFields = (e: z.ZodError) =>
  Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "body", i.message]));

/** Parse with a zod schema or throw a 400 naming the bad fields. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid request."): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "bad_request", message, zodFields(r.error));
  return r.data;
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ code: "not_found", message: "Not found." });
};

/** Last middleware: known errors keep their status; anything else is a 500 with no details. */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) });
      return;
    }
    // express.json() errors: malformed JSON, body too large.
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 413) {
      res.status(status).json({ code: "bad_request", message: status === 413 ? "Request too large." : "Malformed JSON." });
      return;
    }
    log.error({ err, method: req.method, path: req.path }, "unhandled error");
    res.status(500).json({ code: "internal", message: "Something went wrong." });
  };
}
