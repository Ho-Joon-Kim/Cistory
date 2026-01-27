/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server boots up
 * Used to initialize services like cron jobs
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on Node.js runtime (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeCron, stopCron } = await import('@/lib/cron');

    // Initialize cron service
    initializeCron();

    // Graceful shutdown handlers
    process.on('SIGINT', () => {
      console.log('\n[Server] Received SIGINT. Shutting down gracefully...');
      stopCron();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n[Server] Received SIGTERM. Shutting down gracefully...');
      stopCron();
      process.exit(0);
    });
  }
}
