// Integration tests against the Firebase Emulator Suite (dev rules) and the dev API shim.
// Run from the repo root: npm run test:e2e   (needs JDK 21+ and `npx playwright install chromium`).
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-calgy.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-calgy",
      NEXT_PUBLIC_FIREBASE_APP_ID: "1:0:web:0",
      NEXT_PUBLIC_API_MODE: "dev",
      NEXT_PUBLIC_AUTH_MODE: "bearer",
      NEXT_PUBLIC_USE_EMULATORS: "true",
    },
  },
});
