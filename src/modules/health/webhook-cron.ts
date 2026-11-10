import type { ScheduledTask } from "node-cron";
import { getDb } from "@/db";
import { logger } from "@/lib/logger";

/** The consumer only runs when explicitly enabled (rollout gate, design §4 step 4). */
export function healthWebhooksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GOOGLE_HEALTH_WEBHOOKS_ENABLED === "true";
}

/**
 * Every minute, in the cron container only. A closure-local `running` flag keeps
 * ticks from overlapping inside this process; the DB lease (SKIP LOCKED + lease
 * token) is what makes it safe across processes. Returns null when disabled.
 */
export function registerHealthWebhookTask(
  schedule: (
    expression: string,
    callback: () => void,
    options: { timezone: string; name: string }
  ) => ScheduledTask,
  timezone: string,
  env: NodeJS.ProcessEnv = process.env
): ScheduledTask | null {
  if (!healthWebhooksEnabled(env)) {
    logger.info("[HealthWebhook] consumer disabled (GOOGLE_HEALTH_WEBHOOKS_ENABLED != true)");
    return null;
  }
  let running = false;
  return schedule(
    "* * * * *",
    () => {
      if (running) return;
      running = true;
      // Loaded lazily so registering the schedule doesn't pull the sync service
      // graph into cron.ts's import (and its unit tests' module mocks).
      import("./webhook-queue")
        .then(({ processHealthWebhookQueue }) => processHealthWebhookQueue(getDb()))
        .catch((error) => {
          logger.warn("[HealthWebhook] queue tick failed; events stay queued", {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone, name: "health-webhook" }
  );
}
