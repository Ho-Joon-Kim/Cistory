import * as Sentry from "@sentry/nextjs";
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
  // Pinned so SENTRY_TRACE_LIFECYCLE=static can't silently disable beforeSendSpan.
  traceLifecycle: "stream",
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeBreadcrumb: redactSearchBreadcrumb,
  beforeSendSpan: redactSearchStreamedSpan,
  beforeSend: redactSearchEvent,
});
