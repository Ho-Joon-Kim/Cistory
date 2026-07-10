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
    // Prefer IPv4 for all server-side DNS resolution. Some external hosts — e.g.
    // Withings' wbsapi.withings.net — publish both A and AAAA records but are only
    // reachable over IPv4 from our network; undici's default connector picks IPv6
    // and stalls until ETIMEDOUT on the dead route (surfacing as a bare
    // `TypeError: fetch failed` in the OAuth token exchange). This works at the
    // node:dns layer, below undici, so it applies to every fetch() regardless of
    // which undici instance or dispatcher Next uses — unlike setGlobalDispatcher,
    // which Next's route runtime does not pick up. No-op where IPv6 works.
    const { setDefaultResultOrder } = await import("node:dns");
    setDefaultResultOrder("ipv4first");

    await import("./sentry.server.config");

    // Cron runs in a DEDICATED container, separate from the web container.
    // Background jobs (AI summaries, location/subway processing) do multi-second
    // synchronous CPU work that blocks the Node event loop; running them in the
    // web process stalled ALL HTTP requests (DB connections failed to establish,
    // even sub-ms queries hit the query timeout). The web container sets
    // DISABLE_CRON=true; the cron container leaves it unset so only it schedules.
    if (process.env.DISABLE_CRON === "true") {
      console.log("[Cron] DISABLE_CRON=true — skipping cron init (web container)");
    } else {
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
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
