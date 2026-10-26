// Cron jobs, in the API process. Single instance only: two instances would send reminders twice
// (add a Firestore lock doc per job before scaling out). DISABLE_JOBS=true turns them off.
import cron from "node-cron";
import type { Firestore } from "firebase-admin/firestore";
import type { Deps } from "../deps.js";
import { runAggregates } from "./aggregates.js";
import { runReminders } from "./reminders.js";

export function startJobs(deps: Deps & { db: Firestore }) {
  const { log, config } = deps;
  const guard = (name: string, fn: () => Promise<void>) => async () => {
    const started = Date.now();
    try {
      await fn();
    } catch (e) {
      log.error({ err: e, job: name }, "job failed");
    } finally {
      log.debug({ job: name, ms: Date.now() - started }, "job finished");
    }
  };

  const tasks = [
    cron.schedule("*/15 * * * *", guard("reminders", () => runReminders(deps)), { name: "reminders", noOverlap: true }),
    cron.schedule(
      "0 2 * * *",
      guard("aggregates", () => runAggregates({ db: deps.db, log, minContributors: config.aggregateMinContributors })),
      { name: "aggregates", timezone: "Africa/Lagos", noOverlap: true },
    ),
  ];
  log.info("jobs scheduled: reminders every 15 min, aggregates 02:00 Africa/Lagos");
  return () => tasks.forEach((t) => t.stop());
}
