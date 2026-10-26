import type { NextConfig } from "next";

// The dev API shim must never ship: fail Vercel production builds early (env() also refuses it at runtime).
if (process.env.VERCEL_ENV === "production" && (process.env.NEXT_PUBLIC_API_MODE ?? "dev") === "dev") {
  throw new Error("NEXT_PUBLIC_API_MODE=dev can't be deployed to production. Set NEXT_PUBLIC_API_MODE=http.");
}

const firebaseAuthHost = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  ? `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`
  : null;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  // Optional: serve Firebase's auth handler from this domain so Google sign-in by redirect works in
  // browsers that block third-party storage. Use it by setting NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN to the
  // app's own domain (see README).
  async rewrites() {
    return firebaseAuthHost ? [{ source: "/__/auth/:path*", destination: `${firebaseAuthHost}/__/auth/:path*` }] : [];
  },
};

export default nextConfig;
