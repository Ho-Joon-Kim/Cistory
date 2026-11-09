import type { init } from "@sentry/nextjs";
import {
  mapAttributeStrings,
  type ScrubbableEvent,
  type ScrubbableSpan,
  someAttributeString,
} from "./sentry-scrub";

// `@sentry/nextjs` doesn't re-export `DataCollection`; derive it from `init`.
type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

const PII_KEY_DENYLIST = ["forwarded", "-ip", "remote-", "via", "-user"];

/**
 * Sentry v11 replaced `sendDefaultPii` with `dataCollection`, and an UNSET
 * `dataCollection` collects everything (user info, cookies, all headers, full
 * request/response bodies, DB query data, ...). This is the v10
 * `sendDefaultPii: false` equivalent from the official v10→v11 migration guide,
 * with every remaining category that v10 never collected without opting in
 * switched off too. Shared by all three Sentry inits (server, edge, browser).
 */
export const SENTRY_DATA_COLLECTION = {
  // No user.* fields, and no IP inference (v11 ties IP inference to userInfo).
  userInfo: false,
  cookies: false,
  // v10 kept headers but stripped IP/forwarding/user headers. Auth-like headers
  // are additionally always "[Filtered]" by the SDK's built-in sensitive-key list.
  httpHeaders: {
    request: { deny: PII_KEY_DENYLIST },
    response: { deny: PII_KEY_DENYLIST },
  },
  // No request/response bodies at all (v10 recorded body size only).
  httpBodies: [],
  urlQueryParams: { deny: PII_KEY_DENYLIST },
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  // Local variables are only captured when `includeLocalVariables` is set (it
  // is not, as in v10); pinned off so enabling that later can't leak values.
  stackFrameVariables: false,
} satisfies DataCollection;

type Breadcrumb = { message?: string; data?: Record<string, unknown> };
type Span = { description?: string; data?: Record<string, unknown> };
type SearchEvent = ScrubbableEvent & {
  spans?: Span[];
  contexts?: { trace?: Span; [key: string]: unknown };
};

// Both absolute request URLs and relative navigation URLs can carry a private
// search term. Keep the route for diagnosis, never its query parameters.
function redactUrl(value: string): string {
  return value.replace(/(\/(?:api\/)?search)\?[^\s]*/g, "$1");
}
function isSearch(value: unknown): boolean {
  return typeof value === "string" && /\/(?:api\/)?search(?:[?#]|$)/.test(value);
}
function redactUrlFields(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === "string" ? redactUrl(value) : value,
    ])
  );
}

export function redactSearchBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  return {
    ...breadcrumb,
    ...(breadcrumb.message !== undefined && { message: redactUrl(breadcrumb.message) }),
    ...(breadcrumb.data && { data: redactUrlFields(breadcrumb.data) }),
  };
}

export function redactSearchSpan<T extends Span>(span: T): T {
  const data = span.data && redactUrlFields(span.data);
  if (data && (isSearch(span.description) || Object.values(span.data ?? {}).some(isSearch))) {
    delete data["url.query"];
    delete data["http.query"];
  }
  return {
    ...span,
    ...(span.description !== undefined && { description: redactUrl(span.description) }),
    ...(data && { data }),
  };
}

export function redactSearchEvent<T extends SearchEvent>(event: T): T {
  const request = event.request && { ...event.request };
  if (request) {
    if (isSearch(request.url)) {
      request.url = redactUrl(request.url ?? "");
      request.query_string = undefined;
    }
    if (request.headers) request.headers = redactUrlFields(request.headers);
  }
  return {
    ...event,
    ...(request && { request }),
    ...(event.breadcrumbs && { breadcrumbs: event.breadcrumbs.map(redactSearchBreadcrumb) }),
    ...(event.spans && { spans: event.spans.map(redactSearchSpan) }),
    ...(event.contexts?.trace && {
      contexts: { ...event.contexts, trace: redactSearchSpan(event.contexts.trace) },
    }),
  };
}

/**
 * `redactSearchSpan` for Sentry v11 span streaming. v11 hands `beforeSendSpan`
 * a `StreamedSpanJSON` (`name` + `attributes`, formerly `description` + `data`)
 * for every span — including the segment span that replaced the transaction —
 * and `beforeSendTransaction` no longer runs. Attribute values may be arrays
 * (HTTP headers such as `http.request.header.referer`) or `{ value }` objects.
 * Must never throw: Sentry sends the span UNMODIFIED if `beforeSendSpan` throws.
 */
export function redactSearchStreamedSpan<T extends ScrubbableSpan>(span: T): T {
  const original = span.attributes;
  const attributes =
    original &&
    Object.fromEntries(
      Object.entries(original).map(([key, value]) => [key, mapAttributeStrings(value, redactUrl)])
    );
  const touchesSearch =
    isSearch(span.name) ||
    (original !== undefined &&
      Object.values(original).some((value) => someAttributeString(value, isSearch)));
  if (attributes && touchesSearch) {
    delete attributes["url.query"];
    delete attributes["http.query"];
  }
  return {
    ...span,
    ...(span.name !== undefined && { name: redactUrl(span.name) }),
    ...(attributes && { attributes }),
  };
}
