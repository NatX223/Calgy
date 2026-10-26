// Environment, validated once at startup. Production values live in /etc/calgy/api.env on the VM.
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const list = z
  .string()
  .default("")
  .transform((v) => v.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean));

const required = (message: string) => z.string({ error: message }).min(1, message);

/** The service account key: what Firebase console → Service accounts → Generate new private key downloads. */
const ServiceAccountSchema = z.looseObject({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});
export type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

/** CRED = base64 of the service account JSON (`base64 -w0 service-account.json`). */
const cred = (emulator: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx): ServiceAccount | null => {
      if (!v) {
        // Emulators need no key; real projects do.
        if (!emulator) ctx.addIssue({ code: "custom", message: "Required: base64 of the service account JSON (base64 -w0 service-account.json)" });
        return null;
      }
      try {
        const j = ServiceAccountSchema.parse(JSON.parse(Buffer.from(v.trim(), "base64").toString("utf8")));
        return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
      } catch {
        ctx.addIssue({ code: "custom", message: "Not base64 of a service account JSON (needs project_id, client_email, private_key)" });
        return z.NEVER;
      }
    });

const envSchema = (emulator: boolean) =>
  z
    .object({
      NODE_ENV: z.string().default("production"),
      AUTH_MODE: z.enum(["bearer", "cookie"]).default("bearer"),
      HOST: z.string().default("127.0.0.1"),
      PORT: z.coerce.number().int().min(1).max(65535).default(8080),
      APP_ORIGINS: list,
      ALLOW_VERCEL_PREVIEWS: bool,
      VERCEL_PREVIEW_PATTERN: z.string().default(""),
      CRED: cred(emulator),
      /** Defaults to the project in CRED. */
      FIREBASE_PROJECT_ID: z.string().optional().transform((v) => v || undefined),
      VAPID_PUBLIC_KEY: required("Required (generate once: npx web-push generate-vapid-keys)"),
      VAPID_PRIVATE_KEY: required("Required (generate once: npx web-push generate-vapid-keys)"),
      VAPID_SUBJECT: required("Required: mailto:<your email>").regex(/^(mailto:|https:)/, "Must be mailto:… or https:…"),
      AGGREGATE_MIN_CONTRIBUTORS: z.coerce.number().int().min(1).default(10),
      COOKIE_DOMAIN: z.string().default(""),
      SESSION_DAYS: z.coerce.number().int().min(1).max(14).default(14),
      /** Turn the cron jobs off (e.g. a second instance, or local dev). */
      DISABLE_JOBS: bool,
      LOG_LEVEL: z.string().default("info"),
    })
    .superRefine((e, ctx) => {
      if (e.APP_ORIGINS.length === 0) ctx.addIssue({ code: "custom", path: ["APP_ORIGINS"], message: "Needs at least one origin, e.g. https://<project>.vercel.app" });
      if (e.ALLOW_VERCEL_PREVIEWS) {
        try {
          if (!e.VERCEL_PREVIEW_PATTERN) throw new Error();
          new RegExp(e.VERCEL_PREVIEW_PATTERN);
        } catch {
          ctx.addIssue({ code: "custom", path: ["VERCEL_PREVIEW_PATTERN"], message: "Needs a valid regex when ALLOW_VERCEL_PREVIEWS=true" });
        }
      }
      if (!e.CRED && !e.FIREBASE_PROJECT_ID)
        ctx.addIssue({ code: "custom", path: ["FIREBASE_PROJECT_ID"], message: "Required when CRED isn't set (e.g. demo-calgy for the emulators)" });
      if (e.CRED && e.FIREBASE_PROJECT_ID && e.FIREBASE_PROJECT_ID !== e.CRED.projectId)
        ctx.addIssue({ code: "custom", path: ["FIREBASE_PROJECT_ID"], message: `Doesn't match the project in CRED (${e.CRED.projectId})` });
    });

export type Config = {
  dev: boolean;
  authMode: "bearer" | "cookie";
  host: string;
  port: number;
  appOrigins: string[];
  previewPattern: RegExp | null;
  projectId: string;
  /** null only with the emulators. */
  serviceAccount: ServiceAccount | null;
  vapid: { publicKey: string; privateKey: string; subject: string };
  aggregateMinContributors: number;
  cookieDomain: string;
  sessionDays: number;
  jobsEnabled: boolean;
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = envSchema(!!env.FIRESTORE_EMULATOR_HOST).safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = r.data;
  // ^…$ so a pattern like "calgy-.*\.vercel\.app" can't match a longer attacker-controlled origin.
  const anchored = (p: string) => new RegExp(`^(?:${p.replace(/^\^/, "").replace(/\$$/, "")})$`);
  return {
    dev: e.NODE_ENV === "development",
    authMode: e.AUTH_MODE,
    host: e.HOST,
    port: e.PORT,
    appOrigins: e.APP_ORIGINS,
    previewPattern: e.ALLOW_VERCEL_PREVIEWS ? anchored(e.VERCEL_PREVIEW_PATTERN) : null,
    projectId: e.FIREBASE_PROJECT_ID ?? e.CRED!.projectId,
    serviceAccount: e.CRED,
    vapid: { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT },
    aggregateMinContributors: e.AGGREGATE_MIN_CONTRIBUTORS,
    cookieDomain: e.COOKIE_DOMAIN,
    sessionDays: e.SESSION_DAYS,
    jobsEnabled: !e.DISABLE_JOBS,
    logLevel: e.LOG_LEVEL,
  };
}
