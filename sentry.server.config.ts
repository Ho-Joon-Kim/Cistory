import * as Sentry from "@sentry/nextjs";
import { scrubHealthData } from "@/lib/sentry-scrub";
import {
  redactSearchBreadcrumb,
  redactSearchEvent,
  redactSearchSpan,
} from "@/lib/telemetry-privacy";

const SAMPLE_RATE = process.env.NODE_ENV === "production" ? 0.1 : 1.0;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: SAMPLE_RATE,
  beforeBreadcrumb: redactSearchBreadcrumb,
  beforeSendSpan: redactSearchSpan,
  // Never attach IP/cookies/headers by default; combined with the health scrubber
  // below, raw health (Fitbit / Google Health) payloads never reach Sentry (R13).
  sendDefaultPii: false,
  beforeSend: (event) => redactSearchEvent(scrubHealthData(event)),
  beforeSendTransaction: (event) => redactSearchEvent(scrubHealthData(event)),
});
