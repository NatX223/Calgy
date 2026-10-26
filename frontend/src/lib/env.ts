// Public config, validated once. NEXT_PUBLIC_* values are inlined at build time, so each is read by name.
import { z } from "zod";

const EnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.string().trim().optional().default(""),
  NEXT_PUBLIC_API_MODE: z.enum(["dev", "http"]).default("dev"),
  NEXT_PUBLIC_AUTH_MODE: z.enum(["bearer", "cookie"]).default("bearer"),
  NEXT_PUBLIC_USE_EMULATORS: z
    .enum(["true", "false", ""])
    .optional()
    .transform((v) => v === "true"),
});

export type Env = {
  firebase: { apiKey: string; authDomain: string; projectId: string; storageBucket: string; messagingSenderId: string; appId: string };
  apiUrl: string;
  apiMode: "dev" | "http";
  authMode: "bearer" | "cookie";
  useEmulators: boolean;
};

export class ConfigError extends Error {
  name = "ConfigError";
}

/** Parse + sanity-check config. `pageProtocol` is location.protocol in the browser (undefined on the server). */
export function parseEnv(raw: Record<string, string | undefined>, ctx: { nodeEnv?: string; pageProtocol?: string }): Env {
  // Empty strings from .env files mean "not set".
  const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]));
  const res = EnvSchema.safeParse(cleaned);
  if (!res.success) {
    const keys = [...new Set(res.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(`Calgy config is missing or invalid: ${keys.join(", ")}. Check your .env / Vercel environment variables.`);
  }
  const e = res.data;
  if (e.NEXT_PUBLIC_API_MODE === "http") {
    if (!e.NEXT_PUBLIC_API_URL) throw new ConfigError("NEXT_PUBLIC_API_URL is required when NEXT_PUBLIC_API_MODE=http.");
    if (!/^https?:\/\//.test(e.NEXT_PUBLIC_API_URL)) throw new ConfigError("NEXT_PUBLIC_API_URL must start with http:// or https://.");
  }
  if (ctx.pageProtocol === "https:" && e.NEXT_PUBLIC_API_URL.startsWith("http://"))
    throw new ConfigError("API must be HTTPS in production. NEXT_PUBLIC_API_URL starts with http:// but the app is served over https:.");
  if (ctx.nodeEnv === "production" && e.NEXT_PUBLIC_API_MODE === "dev")
    throw new ConfigError("NEXT_PUBLIC_API_MODE=dev (the dev API shim) can't be used in a production build. Set it to http.");
  return {
    firebase: {
      apiKey: e.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: e.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: e.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: e.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: e.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: e.NEXT_PUBLIC_FIREBASE_APP_ID,
    },
    apiUrl: e.NEXT_PUBLIC_API_URL.replace(/\/+$/, ""),
    apiMode: e.NEXT_PUBLIC_API_MODE,
    authMode: e.NEXT_PUBLIC_AUTH_MODE,
    useEmulators: e.NEXT_PUBLIC_USE_EMULATORS,
  };
}

let cached: Env | null = null;

export function env(): Env {
  return (cached ??= parseEnv(
    {
      NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NEXT_PUBLIC_API_MODE: process.env.NEXT_PUBLIC_API_MODE,
      NEXT_PUBLIC_AUTH_MODE: process.env.NEXT_PUBLIC_AUTH_MODE,
      NEXT_PUBLIC_USE_EMULATORS: process.env.NEXT_PUBLIC_USE_EMULATORS,
    },
    { nodeEnv: process.env.NODE_ENV, pageProtocol: typeof window === "undefined" ? undefined : window.location.protocol },
  ));
}
