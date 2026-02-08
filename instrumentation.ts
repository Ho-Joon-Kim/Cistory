/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server boots up
 * Used to initialize services like cron jobs and error tracking
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    const { initializeCron, stopCron } = await import("@/lib/cron");

    // Initialize cron service
    initializeCron();

    // Graceful shutdown handlers
    process.on("SIGINT", async () => {
      console.log("\n[Server] Received SIGINT. Shutting down gracefully...");
      await stopCron();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n[Server] Received SIGTERM. Shutting down gracefully...");
      await stopCron();
      process.exit(0);
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
