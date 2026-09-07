import type { ScheduledTask } from "node-cron";
import { getDb } from "@/db";
import { logger } from "@/lib/logger";
import { processRecoveryQueue } from "./recovery";

export function registerDataRecoveryTask(
  schedule: (
    expression: string,
    callback: () => void,
    options: { timezone: string; name: string }
  ) => ScheduledTask,
  timezone: string
) {
  let running = false;
  return schedule(
    "* * * * *",
    () => {
      if (running) return;
      running = true;
      processRecoveryQueue(getDb())
        .catch(() => {
          logger.warn("[Recovery] queue tick failed; durable requests remain available");
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone, name: "data-recovery" }
  );
}
