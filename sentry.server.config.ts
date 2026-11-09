import * as Sentry from "@sentry/nextjs";
import { scrubHealthData, scrubHealthSpan } from "@/lib/sentry-scrub";
import {
  redactSearchBreadcrumb,
  redactSearchEvent,
  redactSearchStreamedSpan,
  SENTRY_DATA_COLLECTION,
} from "@/lib/telemetry-privacy";

const SAMPLE_RATE = process.env.NODE_ENV === "production" ? 0.1 : 1.0;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: SAMPLE_RATE,
  // Pinned so SENTRY_TRACE_LIFECYCLE=static can't silently switch to transaction
  // mode, where the streamed-span `beforeSendSpan` below would be ignored.
  traceLifecycle: "stream",
  beforeBreadcrumb: redactSearchBreadcrumb,
  // Every span — including the segment span that replaced the transaction in v11
  // — goes through here; `beforeSendTransaction` no longer fires in stream mode.
  beforeSendSpan: (span) => redactSearchStreamedSpan(scrubHealthSpan(span)),
  // v10's `sendDefaultPii: false` equivalent (no IP/cookies/bodies/user info);
  // combined with the health scrubbers, raw health (Fitbit / Google Health)
  // payloads never reach Sentry (R13).
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: (event) => redactSearchEvent(scrubHealthData(event)),
});
