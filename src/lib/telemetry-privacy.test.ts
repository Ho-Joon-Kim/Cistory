import { describe, expect, it } from "vitest";
import { redactSearchBreadcrumb, redactSearchEvent, redactSearchSpan } from "./telemetry-privacy";

describe("search telemetry privacy", () => {
  it("removes search parameters from requests, referrers, breadcrumbs and spans", () => {
    const url = "https://cistory.hojoon.dev/search?q=private-term&from=2026-01-01";
    const result = redactSearchEvent({
      contexts: { trace: { data: { "url.full": url, "url.query": "q=private-term" } } },
      request: { url, query_string: "q=private-term", headers: { Referer: url } },
      breadcrumbs: [
        { data: { from: url, to: "/search?q=private-term", url: "/api/search?q=private-term" } },
      ],
      spans: [
        {
          start_timestamp: 1,
          timestamp: 2,
          trace_id: "trace",
          span_id: "span",
          description: "GET /api/search?q=private-term",
          data: {
            "url.full": url,
            "http.url": url,
            "url.query": "q=private-term",
            "http.query": "q=private-term",
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private-term");
    expect(result.request?.url).toBe("https://cistory.hojoon.dev/search");
    expect(result.breadcrumbs?.[0].data?.url).toBe("/api/search");
  });
  it("redacts breadcrumbs and spans before they enter a later unrelated event", () => {
    expect(redactSearchBreadcrumb({ data: { to: "/search?q=secret" } }).data?.to).toBe("/search");
    const result = redactSearchSpan({
      start_timestamp: 1,
      timestamp: 2,
      trace_id: "trace",
      span_id: "span",
      description: "GET https://cistory.hojoon.dev/api/search?q=secret",
      data: { "url.full": "/api/search?q=secret", "url.query": "q=secret" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("preserves unrelated telemetry and does not mutate the input", () => {
    const event = { request: { url: "https://example.test/other?page=2", query_string: "page=2" } };
    expect(redactSearchEvent(event)).toEqual(event);
    const breadcrumb = { data: { url: "/search?q=secret", status_code: 200 } };
    expect(redactSearchBreadcrumb(breadcrumb).data?.status_code).toBe(200);
    expect(breadcrumb.data.url).toBe("/search?q=secret");
  });
});
