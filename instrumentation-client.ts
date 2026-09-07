import * as Sentry from "@sentry/nextjs";
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
  beforeSend: redactSearchEvent,
  beforeSendTransaction: redactSearchEvent,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
