/**
 * In-memory import job store.
 *
 * Replaces the SSE stream the import route used to keep open for the whole
 * processing run. Cloudflare cuts long-lived streams once bytes stop flowing,
 * so we now persist progress server-side and let the client poll. The store is
 * single-process (matches the cron service's pattern) and intentionally
 * non-durable: a server restart loses in-flight jobs, which is acceptable
 * since the user can simply re-upload.
 */
import { randomUUID } from "node:crypto";
import type { ImportProgress } from "./importer";

interface ImportJob {
  jobId: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  progress: ImportProgress;
}

const jobs = new Map<string, ImportJob>();

const ACTIVE_TTL_MS = 60 * 60 * 1000;
const COMPLETED_TTL_MS = 5 * 60 * 1000;

export function createJob(userId: string): string {
  const jobId = randomUUID();
  const now = Date.now();
  jobs.set(jobId, {
    jobId,
    userId,
    createdAt: now,
    updatedAt: now,
    progress: { phase: "parsing", totalParsed: 0 },
  });
  return jobId;
}

export function updateJob(jobId: string, progress: ImportProgress): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = progress;
  job.updatedAt = Date.now();
}

export function getJob(jobId: string, userId: string): ImportJob | null {
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId) return null;
  return job;
}

// Lazy GC on every read avoids needing a long-lived timer. Completed/errored
// jobs hang around briefly so the client's last poll can read the final state.
function gc(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const isDone = job.progress.phase === "done" || job.progress.phase === "error";
    const ttl = isDone ? COMPLETED_TTL_MS : ACTIVE_TTL_MS;
    if (now - job.updatedAt > ttl) jobs.delete(id);
  }
}

const gcTimer = setInterval(gc, 60_000);
gcTimer.unref?.();
