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
    // Enable Happy Eyeballs (RFC 8305) for all server-side fetch(). Some external
    // hosts — e.g. Withings' wbsapi.withings.net — publish both A and AAAA records
    // but are only reachable over IPv4 from our network. undici's default connector
    // picks a single address family and stalls until ETIMEDOUT on a dead IPv6 route
    // (surfacing as a bare `TypeError: fetch failed`). autoSelectFamily races IPv4
    // and IPv6 the way curl and browsers do, so the reachable family wins; it is a
    // no-op where IPv6 already works. Set before any outbound request is made.
    const { setGlobalDispatcher, Agent } = await import("undici");
    setGlobalDispatcher(new Agent({ connect: { autoSelectFamily: true } }));

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
