import type { ScrubbableEvent } from "./sentry-scrub";

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
