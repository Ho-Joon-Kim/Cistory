import type { ScheduledTask } from "node-cron";
import { getDb } from "@/db";
import { logger } from "@/lib/logger";

type ScheduleFn = (
  expression: string,
  callback: () => void,
  options: { timezone: string; name: string }
) => ScheduledTask;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Loads the Proton crypto runtime and the NSFW model once at cron boot, so a
 * missing wasm binary or an OOM shows up in the boot log rather than on the
 * first tick, and logs the tensor backend (a `cpu` fallback is ~10x slower).
 * Never throws: a failed warm-up is retried lazily by the first sync tick.
 *
 * Everything is imported lazily so registering the task keeps the Proton SDK
 * and TensorFlow out of `src/lib/cron.ts`'s import graph.
 */
export async function warmUpProtonRuntime(): Promise<void> {
  try {
    const { initProtonRuntime } = await import("@/lib/adapters/proton/runtime");
    await initProtonRuntime();
    const { createNsfwjsClassifier } = await import("./nsfw/nsfwjs");
    const backend = await createNsfwjsClassifier().load();
    logger.info("[Proton] runtime ready", { backend });
  } catch (error) {
    logger.error("[Proton] runtime warm-up failed", { error: errorName(error) });
  }
}

/**
 * Every 10 minutes, in the cron container only. A closure-local `running` flag
 * keeps ticks from overlapping in this process; the per-user session advisory
 * lock in `sync.ts` is what makes it safe across processes.
 */
export function registerProtonPhotosTask(schedule: ScheduleFn, timezone: string): ScheduledTask {
  let running = false;
  const task = schedule(
    "*/10 * * * *",
    () => {
      if (running) return;
      running = true;
      import("./sync")
        .then(({ syncAllProtonPhotos }) => syncAllProtonPhotos(getDb()))
        .catch((error) => {
          logger.error("[Proton] sync tick failed", { error: errorName(error) });
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone, name: "proton-photos" }
  );
  void warmUpProtonRuntime();
  return task;
}
