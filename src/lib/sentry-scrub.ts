/**
 * Sentry scrubbing for health (Fitbit / Google Health) data — R13: raw health
 * payloads must never reach Sentry. Kept as a pure, dependency-free function so
 * it can be unit-tested without invoking Sentry.init (which the config file does
 * at import time). Wired into sentry.server.config.ts: `scrubHealthData` on
 * beforeSend (error events), `scrubHealthSpan` on beforeSendSpan. Sentry v11
 * streams spans instead of sending transaction events, so `beforeSendTransaction`
 * no longer runs — every span (including the segment span that replaced the
 * transaction) goes through `beforeSendSpan` as a `StreamedSpanJSON`
 * (`name` + `attributes`), which is the shape `scrubHealthSpan` handles.
 */

// Any URL/message touching these is a health request whose body must be dropped.
const HEALTH_URL_MARKERS = [
  "health.googleapis.com",
  "/api/fitbit",
  // Proton Drive Photos: session tokens, photo locations and thumbnails.
  "proton.me",
  "/api/proton",
  "/api/photos",
  // MCP endpoint: bearer tokens and tool arguments/results (personal data).
  "/api/mcp",
  // MCP owner alerts: the bot token is part of the URL *path*
  // (/bot<token>/sendMessage), so it is also redacted by `redactTelegramToken`.
  "api.telegram.org",
];

// `https://api.telegram.org/bot<token>/…` — the credential sits in the path,
// where query-stripping can't reach it.
const TELEGRAM_BOT_PATH = /(api\.telegram\.org\/(?:file\/)?bot)[^/\s?#"']+/g;

/** Replace a Telegram bot token embedded in any URL/message text. */
export function redactTelegramToken(value: string): string {
  return value.replace(TELEGRAM_BOT_PATH, "$1[scrubbed]");
}

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
  // 2026 data types (design §6): rollup payloads and their sums, blood glucose.
  "rollup",
  "kcalsum",
  "bloodglucose",
  // Webhook payloads (design §6): no values, but the user id and activity times
  // themselves are personal data.
  "healthuserid",
  "intervals",
  // ECG / irregular-rhythm payloads (decision 9): medical-grade data.
  "electrocardiogram",
  "waveform",
  "resultclassification",
  "irregularrhythm",
  "alertwindows",
  "heartbeats",
  // Proton Drive Photos: GPS, EXIF-claimed metadata, image bytes, key material.
  "latitude",
  "longitude",
  "claimedmetadata",
  "claimed_metadata",
  "thumbnail",
  "keypassword",
  "key_password",
  // Original-file EXIF: camera heading and capture UTC offset (and any `exif` payload).
  "exif",
  "imagedirection",
  "image_direction",
  "utcoffset",
  "utc_offset",
  // MCP: bearer tokens, tool arguments and tool results (structuredContent).
  "authorization",
  "args",
  "structuredcontent",
];

/** Structural subset of a Sentry event — only the fields we scrub. */
export interface ScrubbableEvent {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  request?: {
    url?: string;
    data?: unknown;
    query_string?: unknown;
    headers?: Record<string, unknown>;
  };
  extra?: Record<string, unknown>;
}

function isHealthUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return HEALTH_URL_MARKERS.some((marker) => value.includes(marker));
}

/** Drop the payload of any http/fetch crumb to a health endpoint, keeping only
 *  url/method/status_code. */
function redactCrumbTelegram(crumb: NonNullable<ScrubbableEvent["breadcrumbs"]>[number]): void {
  if (typeof crumb.message === "string") crumb.message = redactTelegramToken(crumb.message);
  for (const [key, value] of Object.entries(crumb.data ?? {})) {
    if (typeof value === "string" && crumb.data) crumb.data[key] = redactTelegramToken(value);
  }
}

function scrubBreadcrumbs(breadcrumbs: NonNullable<ScrubbableEvent["breadcrumbs"]>): void {
  for (const crumb of breadcrumbs) {
    redactCrumbTelegram(crumb);
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
  if (typeof request.url === "string") request.url = redactTelegramToken(request.url);
  // The OAuth callback URL carries ?code=…&state=… in the querystring — keep only
  // the path so the grant code never lands in Sentry via request.url.
  if (typeof request.url === "string") {
    const q = request.url.indexOf("?");
    if (q !== -1) request.url = request.url.slice(0, q);
  }
  request.data = undefined;
  request.query_string = undefined;
  if (request.headers) {
    delete request.headers.authorization;
    delete request.headers.cookie;
    delete request.headers["x-pm-uid"];
  }
}

/** Redact any extra/context key that looks like a health payload. */
function isHealthPayloadKey(key: string): boolean {
  return HEALTH_EXTRA_KEY_DENYLIST.some((deny) => key.toLowerCase().includes(deny));
}

function scrubExtra(extra: NonNullable<ScrubbableEvent["extra"]>): void {
  for (const key of Object.keys(extra)) {
    if (isHealthPayloadKey(key)) extra[key] = "[scrubbed:health]";
  }
}

/**
 * Strip health request bodies + health data from an event's breadcrumbs, request,
 * and extra. Mutates and returns the same event. Safe on events with no health
 * data (no-op). On a health request it also drops auth/cookie headers.
 */
export function scrubHealthData<T extends ScrubbableEvent>(event: T): T {
  // A failed fetch to the Telegram API can quote its URL in the error text.
  if (typeof event.message === "string") event.message = redactTelegramToken(event.message);
  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === "string") value.value = redactTelegramToken(value.value);
  }
  if (event.breadcrumbs) scrubBreadcrumbs(event.breadcrumbs);
  if (event.request) scrubRequest(event.request);
  if (event.extra) scrubExtra(event.extra);
  return event;
}

/**
 * Structural subset of a v11 `StreamedSpanJSON` — only the fields we scrub.
 * Attribute values are primitives, arrays (HTTP headers arrive as
 * `http.request.header.<name>: string[]`) or `{ value, unit }` objects.
 */
export interface ScrubbableSpan {
  name?: string;
  attributes?: Record<string, unknown>;
}

/** Apply `fn` to every string inside a span attribute value. */
export function mapAttributeStrings(value: unknown, fn: (value: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapAttributeStrings(item, fn));
  if (value && typeof value === "object" && "value" in value) {
    return { ...value, value: mapAttributeStrings((value as { value: unknown }).value, fn) };
  }
  return value;
}

/** True if any string inside a span attribute value satisfies `predicate`. */
export function someAttributeString(
  value: unknown,
  predicate: (value: string) => boolean
): boolean {
  if (typeof value === "string") return predicate(value);
  if (Array.isArray(value)) return value.some((item) => someAttributeString(item, predicate));
  if (value && typeof value === "object" && "value" in value) {
    return someAttributeString((value as { value: unknown }).value, predicate);
  }
  return false;
}

// Span attributes that can carry a health request's querystring (the OAuth
// `?code=&state=` grant), body, or credentials.
const HEALTH_SPAN_DROP_KEYS = new Set([
  "url.query",
  "http.query",
  "http.request.body.data",
  "http.response.body.data",
]);
const HEALTH_SPAN_DROP_HEADER =
  /^http\.(?:request|response)\.header\.(?:authorization|cookie|set-cookie|x-pm-uid)$/;

function stripHealthQuery(value: string): string {
  return isHealthUrl(value) ? redactTelegramToken(value.replace(/\?[^\s]*/g, "")) : value;
}

function scrubHealthAttributes(
  original: Record<string, unknown>,
  touchesHealth: boolean
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(original)) {
    if (isHealthPayloadKey(key)) {
      attributes[key] = "[scrubbed:health]";
    } else if (!touchesHealth) {
      attributes[key] = value;
    } else if (!HEALTH_SPAN_DROP_KEYS.has(key) && !HEALTH_SPAN_DROP_HEADER.test(key)) {
      attributes[key] = mapAttributeStrings(value, stripHealthQuery);
    }
  }
  return attributes;
}

/**
 * The span-level counterpart of `scrubHealthData` for Sentry v11 span streaming.
 * Returns a new span (never mutates the input):
 *  - attribute keys that look like health payloads become "[scrubbed:health]"
 *    (the same denylist as `extra` — v11 maps scope data onto span attributes);
 *  - on a span touching a health URL (its name or any attribute value), every
 *    health URL loses its querystring and query/body/auth/cookie attributes
 *    are dropped — the span equivalent of `scrubRequest`.
 * Must never throw: Sentry sends the span UNMODIFIED if `beforeSendSpan` throws.
 */
export function scrubHealthSpan<T extends ScrubbableSpan>(span: T): T {
  const original = span.attributes;
  const touchesHealth =
    isHealthUrl(span.name) ||
    (original !== undefined &&
      Object.values(original).some((value) => someAttributeString(value, isHealthUrl)));
  const attributes = original && scrubHealthAttributes(original, touchesHealth);

  return {
    ...span,
    ...(span.name !== undefined && touchesHealth && { name: stripHealthQuery(span.name) }),
    ...(attributes && { attributes }),
  };
}
