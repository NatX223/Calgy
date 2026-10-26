import { pino } from "pino";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { initFirebase } from "./firebase.js";
import { startJobs } from "./jobs/schedule.js";
import { FirestoreUserStore } from "./services/firestore-store.js";
import { webPushSender } from "./services/push.js";

function startupError(e: unknown): never {
  console.error((e as Error).message);
  process.exit(1);
}

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  startupError(e);
}

const log = pino({ level: config.logLevel, base: undefined });
const { db, auth } = initFirebase(config);
let push: ReturnType<typeof webPushSender>;
try {
  push = webPushSender(config);
} catch (e) {
  startupError(e);
}
const deps = { config, log, auth, store: new FirestoreUserStore(db), push };

const server = createApp(deps).listen(config.port, config.host, () => {
  log.info({ host: config.host, port: config.port, authMode: config.authMode }, "api listening");
});
const stopJobs = config.jobsEnabled ? startJobs({ ...deps, db }) : () => {};

function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  stopJobs();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
