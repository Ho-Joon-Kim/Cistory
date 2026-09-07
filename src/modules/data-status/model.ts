import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import type { RecoveryJob, SourceDay, SourceId } from "./types";

export function validateStatusRange(from: string, to: string, now = new Date()): boolean {
  const start = dateKeyToUtcMillis(from);
  const end = dateKeyToUtcMillis(to);
  return (
    start !== null &&
    end !== null &&
    start <= end &&
    end - start < 31 * 86_400_000 &&
    to <= toKstCalendarDate(now)
  );
}

function sourceDayState(
  date: string,
  count: number,
  job: RecoveryJob | undefined
): SourceDay["state"] {
  if (!job) return count > 0 ? "observed" : "unknown";
  if (job.status === "completed" || date < job.nextDate) return count ? "observed" : "checked";
  if (date === job.nextDate && job.status === "failed") return "failed";
  if (job.status === "pending" || job.status === "running") return "pending";
  return count > 0 ? "observed" : "unknown";
}

/** No samples alone prove neither a successful empty fetch nor an outage. */
export function buildSourceDays(
  source: SourceId,
  from: string,
  to: string,
  counts: Map<string, number>,
  jobs: RecoveryJob[]
): SourceDay[] {
  const days: SourceDay[] = [];
  for (let date = from; date <= to; date = shiftDateKey(date, 1)) {
    const count = counts.get(date) ?? 0;
    // Jobs arrive newest first. Use latest evidence for this source/day.
    const job = jobs.find(
      (item) => item.source === source && item.fromDate <= date && item.toDate >= date
    );
    const state = sourceDayState(date, count, job);
    days.push({ date, count, state });
  }
  return days;
}

export function isSourceStale(connected: boolean, lastSuccessAt: string | null, now = new Date()) {
  return (
    connected &&
    lastSuccessAt !== null &&
    now.getTime() - new Date(lastSuccessAt).getTime() > 48 * 3_600_000
  );
}
