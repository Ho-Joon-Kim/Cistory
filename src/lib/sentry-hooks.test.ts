/**
 * End-to-end check against the real installed Sentry SDK (v11): the redaction
 * hooks the Sentry configs wire up must actually run on what leaves the
 * process. Unit tests on the pure functions can't catch an SDK-side change in
 * which hook fires or which payload shape it receives — this test does, by
 * capturing the serialized envelopes a fake transport would send.
 */
import * as Sentry from "@sentry/nextjs";
import { afterAll, describe, expect, it } from "vitest";
import { scrubHealthData, scrubHealthSpan } from "./sentry-scrub";
import {
  redactSearchBreadcrumb,
  redactSearchEvent,
  redactSearchStreamedSpan,
  SENTRY_DATA_COLLECTION,
} from "./telemetry-privacy";

const sent: string[] = [];

Sentry.init({
  dsn: "https://public@o0.ingest.sentry.io/0",
  tracesSampleRate: 1,
  traceLifecycle: "stream",
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeBreadcrumb: redactSearchBreadcrumb,
  beforeSendSpan: (span) => redactSearchStreamedSpan(scrubHealthSpan(span)),
  beforeSend: (event) => redactSearchEvent(scrubHealthData(event)),
  transport: () => ({
    send: async (envelope) => {
      sent.push(JSON.stringify(envelope));
      return {};
    },
    flush: async () => true,
  }),
});

afterAll(async () => {
  await Sentry.close();
});

describe("Sentry v11 hook wiring", () => {
  it("resolves dataCollection to the v10 no-PII posture", () => {
    const resolved = Sentry.getClient()?.getDataCollectionOptions();
    expect(resolved).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      stackFrameVariables: false,
    });
  });

  it("streams spans through beforeSendSpan with search terms and health querystrings removed", async () => {
    Sentry.startSpan(
      {
        name: "GET /api/search",
        forceTransaction: true,
        attributes: {
          "url.full": "https://cistory.hojoon.dev/api/search?q=private-term",
          "url.query": "q=private-term",
        },
      },
      () => {
        Sentry.startSpan(
          {
            name: "GET https://health.googleapis.com/v4/users/me/dataPoints?pageToken=hr-secret",
            attributes: {
              "url.full":
                "https://health.googleapis.com/v4/users/me/dataPoints?pageToken=hr-secret",
              "http.request.header.referer": ["https://cistory.hojoon.dev/search?q=private-term"],
            },
          },
          () => undefined
        );
      }
    );
    await Sentry.flush(2000);

    const payload = sent.join("\n");
    // The spans really were sent (as v11 span items, not a transaction event)...
    expect(payload).toContain("/api/search");
    expect(payload).toContain("health.googleapis.com/v4/users/me/dataPoints");
    expect(payload).toContain('"type":"span"');
    expect(payload).not.toContain('"type":"transaction"');
    // ...and nothing private survived.
    expect(payload).not.toContain("private-term");
    expect(payload).not.toContain("hr-secret");
  });

  it("redacts error events through beforeSend", async () => {
    sent.length = 0;
    Sentry.addBreadcrumb({ category: "navigation", data: { to: "/search?q=crumb-secret" } });
    Sentry.captureException(new Error("boom"), {
      extra: { rawJson: '{"bpm":62}' },
    });
    await Sentry.flush(2000);

    // Assert on the event fields rather than the raw envelope: the stack frames'
    // source context lines quote this very test file, secrets included.
    const events = sent
      .map((raw) => JSON.parse(raw) as [unknown, [[{ type: string }, Record<string, unknown>]]])
      .flatMap(([, items]) => items)
      .filter(([header]) => header.type === "event")
      .map(([, event]) => event);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(JSON.stringify(event.breadcrumbs)).toContain("/search");
    expect(JSON.stringify(event.breadcrumbs)).not.toContain("crumb-secret");
    expect(event.extra).toEqual({ rawJson: "[scrubbed:health]" });
    expect(event.user).toBeUndefined();
  });
});
