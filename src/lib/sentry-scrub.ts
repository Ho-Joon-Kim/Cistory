/**
 * Sentry scrubbing for health (Fitbit / Google Health) data — R13: raw health
 * payloads must never reach Sentry. Kept as a pure, dependency-free function so
 * it can be unit-tested without invoking Sentry.init (which the config file does
 * at import time). Wired into sentry.server.config.ts's beforeSend +
 * beforeSendTransaction.
 */

// Any URL/message touching these is a health request whose body must be dropped.
const HEALTH_URL_MARKERS = ["health.googleapis.com", "/api/fitbit"];

// Breadcrumb data fields worth keeping on a health request (no health values).
const BREADCRUMB_KEEP_KEYS = new Set(["url", "method", "status_code"]);

// `extra` / context keys whose values are (or may contain) health payloads.
const HEALTH_EXTRA_KEY_DENYLIST = [
  "rawjson",
  "raw_json",
  "rawpage",
  "datapoints",
  "rollupdatapoints",
  "valuejson",
  "value_json",
  "samples",
  "dailysummaries",
  "healthdata",
];

/** Structural subset of a Sentry event — only the fields we scrub. */
export interface ScrubbableEvent {
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  request?: {
    url?: string;
    data?: unknown;
    query_string?: unknown;
    headers?: Record<string, unknown>;
  };
  extra?: Record<string, unknown>;
}

function isHealthUrl(value: string | undefined): boolean {
  if (!value) return false;
  return HEALTH_URL_MARKERS.some((marker) => value.includes(marker));
}

/** Drop the payload of any http/fetch crumb to a health endpoint, keeping only
 *  url/method/status_code. */
function scrubBreadcrumbs(breadcrumbs: NonNullable<ScrubbableEvent["breadcrumbs"]>): void {
  for (const crumb of breadcrumbs) {
    const url = typeof crumb.data?.url === "string" ? crumb.data.url : undefined;
    if (!crumb.data || !(isHealthUrl(url) || isHealthUrl(crumb.message))) continue;
    for (const key of Object.keys(crumb.data)) {
      if (!BREADCRUMB_KEEP_KEYS.has(key)) delete crumb.data[key];
    }
  }
}

/** On a health route, the body/query can carry the OAuth code or health payloads
 *  — drop them and any auth-bearing headers. */
function scrubRequest(request: NonNullable<ScrubbableEvent["request"]>): void {
  if (!isHealthUrl(request.url)) return;
  request.data = undefined;
  request.query_string = undefined;
  if (request.headers) {
    delete request.headers.authorization;
    delete request.headers.cookie;
  }
}

/** Redact any extra/context key that looks like a health payload. */
function scrubExtra(extra: NonNullable<ScrubbableEvent["extra"]>): void {
  for (const key of Object.keys(extra)) {
    if (HEALTH_EXTRA_KEY_DENYLIST.some((deny) => key.toLowerCase().includes(deny))) {
      extra[key] = "[scrubbed:health]";
    }
  }
}

/**
 * Strip health request bodies + health data from an event's breadcrumbs, request,
 * and extra. Mutates and returns the same event. Safe on events with no health
 * data (no-op). On a health request it also drops auth/cookie headers.
 */
export function scrubHealthData<T extends ScrubbableEvent>(event: T): T {
  if (event.breadcrumbs) scrubBreadcrumbs(event.breadcrumbs);
  if (event.request) scrubRequest(event.request);
  if (event.extra) scrubExtra(event.extra);
  return event;
}
