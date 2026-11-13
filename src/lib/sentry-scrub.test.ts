import { describe, expect, it } from "vitest";
import { type ScrubbableEvent, scrubHealthData, scrubHealthSpan } from "./sentry-scrub";

describe("scrubHealthData", () => {
  it("drops the body of a health fetch breadcrumb but keeps url/method/status", () => {
    const event: ScrubbableEvent = {
      breadcrumbs: [
        {
          message: "http",
          data: {
            url: "https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints",
            method: "GET",
            status_code: 200,
            response_body: { dataPoints: [{ bpm: 62 }] },
          },
        },
      ],
    };
    scrubHealthData(event);
    const data = event.breadcrumbs?.[0].data;
    expect(data?.url).toContain("heart-rate");
    expect(data?.method).toBe("GET");
    expect(data?.status_code).toBe(200);
    expect(data?.response_body).toBeUndefined();
  });

  it("leaves non-health breadcrumbs untouched", () => {
    const event: ScrubbableEvent = {
      breadcrumbs: [{ message: "http", data: { url: "https://api.github.com/user", payload: 1 } }],
    };
    scrubHealthData(event);
    expect(event.breadcrumbs?.[0].data?.payload).toBe(1);
  });

  it("strips request data/query and auth headers on a /api/fitbit request", () => {
    const event: ScrubbableEvent = {
      request: {
        url: "https://app.example.com/api/fitbit/callback?code=secret-code",
        data: { code: "secret-code" },
        query_string: "code=secret-code&state=abc",
        headers: { authorization: "Bearer xyz", cookie: "session=1", "user-agent": "keep-me" },
      },
    };
    scrubHealthData(event);
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    // The querystring (with the grant code) is stripped off request.url itself.
    expect(event.request?.url).toBe("https://app.example.com/api/fitbit/callback");
    expect(event.request?.url).not.toContain("secret-code");
    expect(event.request?.headers?.authorization).toBeUndefined();
    expect(event.request?.headers?.cookie).toBeUndefined();
    expect(event.request?.headers?.["user-agent"]).toBe("keep-me");
  });

  it("redacts health-payload keys in extra, keeping unrelated keys", () => {
    const event: ScrubbableEvent = {
      extra: {
        rawJson: { dataPoints: [{ bpm: 62 }] },
        valueJson: { stages: ["deep"] },
        healthData: [1, 2, 3],
        userId: "user-1",
      },
    };
    scrubHealthData(event);
    expect(event.extra?.rawJson).toBe("[scrubbed:health]");
    expect(event.extra?.valueJson).toBe("[scrubbed:health]");
    expect(event.extra?.healthData).toBe("[scrubbed:health]");
    expect(event.extra?.userId).toBe("user-1");
  });

  it("redacts the 2026 rollup / blood-glucose payload keys", () => {
    const event: ScrubbableEvent = {
      extra: { rollupPage: [{}], kcalSum: 2100, bloodGlucose: { mg: 100 }, metric: "x" },
    };
    scrubHealthData(event);
    expect(event.extra?.rollupPage).toBe("[scrubbed:health]");
    expect(event.extra?.kcalSum).toBe("[scrubbed:health]");
    expect(event.extra?.bloodGlucose).toBe("[scrubbed:health]");
    expect(event.extra?.metric).toBe("x");
  });

  it("redacts ECG and irregular-rhythm payload keys", () => {
    const event: ScrubbableEvent = {
      extra: {
        electrocardiogram: {},
        waveformSamples: [1, 2],
        resultClassification: "ATRIAL_FIBRILLATION",
        irregularRhythmNotification: {},
        alertWindows: [],
        heartBeats: [],
        metric: "ecg",
      },
    };
    scrubHealthData(event);
    for (const key of [
      "electrocardiogram",
      "waveformSamples",
      "resultClassification",
      "irregularRhythmNotification",
      "alertWindows",
      "heartBeats",
    ]) {
      expect(event.extra?.[key], key).toBe("[scrubbed:health]");
    }
    expect(event.extra?.metric).toBe("ecg");
  });

  it("redacts webhook user ids and interval payloads", () => {
    const event: ScrubbableEvent = {
      extra: { healthUserId: "123", intervals: [{}], dataType: "steps" },
    };
    scrubHealthData(event);
    expect(event.extra?.healthUserId).toBe("[scrubbed:health]");
    expect(event.extra?.intervals).toBe("[scrubbed:health]");
    expect(event.extra?.dataType).toBe("steps");
  });

  it("is a no-op on an event with no health data", () => {
    const event: ScrubbableEvent = {
      breadcrumbs: [{ message: "navigation", data: { from: "/", to: "/settings" } }],
      extra: { count: 3 },
    };
    scrubHealthData(event);
    expect(event.breadcrumbs?.[0].data?.from).toBe("/");
    expect(event.extra?.count).toBe(3);
  });
});

describe("scrubHealthSpan (Sentry v11 streamed spans)", () => {
  it("strips the OAuth grant and drops query/body/auth attributes on a health segment span", () => {
    const span = {
      name: "GET /api/fitbit/callback",
      is_segment: true,
      attributes: {
        "url.full": "https://cistory.hojoon.dev/api/fitbit/callback?code=grant-secret&state=s",
        "url.query": "code=grant-secret&state=s",
        "http.request.method": "GET",
        "http.request.body.data": '{"bpm":62}',
        "http.request.header.authorization": ["Bearer tok"],
        "http.request.header.cookie": ["session=abc"],
        "http.request.header.referer": [
          "https://health.googleapis.com/v4/users/me?pageToken=grant-secret",
        ],
      },
    };
    const result = scrubHealthSpan(span);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("grant-secret");
    expect(serialized).not.toContain("bpm");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("session=abc");
    expect(result.attributes["url.full"]).toBe("https://cistory.hojoon.dev/api/fitbit/callback");
    expect(result.attributes["http.request.method"]).toBe("GET");
    // The input is not mutated.
    expect(span.attributes["url.query"]).toBe("code=grant-secret&state=s");
  });

  it("detects health URLs inside { value } attribute objects and the span name", () => {
    const result = scrubHealthSpan({
      name: "GET https://health.googleapis.com/v4/x?pageToken=t1",
      attributes: { "http.url": { value: "https://health.googleapis.com/v4/x?pageToken=t2" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/t1|t2/);
  });

  it("replaces health-payload attribute keys on any span and leaves the rest untouched", () => {
    const result = scrubHealthSpan({
      name: "GET /api/overview",
      attributes: { "url.query": "periodType=week", "app.rawJson": '{"steps":1}' },
    });
    expect(result.attributes).toEqual({
      "url.query": "periodType=week",
      "app.rawJson": "[scrubbed:health]",
    });
  });

  it("replaces ECG and irregular-rhythm attribute keys on streamed spans", () => {
    const result = scrubHealthSpan({
      name: "health.sync",
      attributes: {
        "app.electrocardiogram": "{}",
        "app.waveformSamples": "1,2",
        "app.resultClassification": "ATRIAL_FIBRILLATION",
        "app.irregularRhythmNotification": "{}",
        "app.alertWindows": "[]",
        "app.heartBeats": "[]",
        "app.metric": "ecg",
      },
    });
    expect(result.attributes).toEqual({
      "app.electrocardiogram": "[scrubbed:health]",
      "app.waveformSamples": "[scrubbed:health]",
      "app.resultClassification": "[scrubbed:health]",
      "app.irregularRhythmNotification": "[scrubbed:health]",
      "app.alertWindows": "[scrubbed:health]",
      "app.heartBeats": "[scrubbed:health]",
      "app.metric": "ecg",
    });
  });
});

describe("Proton Drive Photos scrubbing", () => {
  it("drops body, query, Authorization and x-pm-uid on a drive-api.proton.me request", () => {
    const event: ScrubbableEvent = {
      request: {
        url: "https://drive-api.proton.me/auth/refresh?token=secret",
        data: { RefreshToken: "secret" },
        query_string: "token=secret",
        headers: { authorization: "Bearer t", "x-pm-uid": "uid-1", accept: "application/json" },
      },
    };
    scrubHealthData(event);
    expect(event.request?.url).toBe("https://drive-api.proton.me/auth/refresh");
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toEqual({ accept: "application/json" });
  });

  it("drops x-pm-uid/authorization span header attributes on a Proton span", () => {
    const result = scrubHealthSpan({
      name: "POST https://drive-api.proton.me/auth/refresh",
      attributes: {
        "url.full": "https://drive-api.proton.me/auth/refresh?x=secret",
        "http.request.header.x-pm-uid": ["uid-1"],
        "http.request.header.authorization": ["Bearer t"],
        "http.request.method": "POST",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/uid-1|Bearer|secret/);
    expect(result.attributes?.["http.request.method"]).toBe("POST");
  });

  it("redacts latitude/longitude/claimedMetadata/thumbnail/keyPassword keys in extra", () => {
    const extra: Record<string, unknown> = {
      latitude: 37.5,
      longitude: 127,
      claimedMetadata: {},
      claimed_metadata: {},
      thumbnailBytes: "x",
      keyPassword: "p",
      key_password: "p",
      count: 3,
    };
    scrubHealthData({ extra });
    expect(extra).toEqual({
      latitude: "[scrubbed:health]",
      longitude: "[scrubbed:health]",
      claimedMetadata: "[scrubbed:health]",
      claimed_metadata: "[scrubbed:health]",
      thumbnailBytes: "[scrubbed:health]",
      keyPassword: "[scrubbed:health]",
      key_password: "[scrubbed:health]",
      count: 3,
    });
  });

  it("redacts original-EXIF heading and UTC offset keys in extra", () => {
    const extra: Record<string, unknown> = {
      imageDirection: 87.2,
      image_direction_ref: "T",
      captureUtcOffsetMin: 540,
      capture_utc_offset_min: 540,
      originalExif: {},
      attempts: 1,
    };
    scrubHealthData({ extra });
    expect(extra).toEqual({
      imageDirection: "[scrubbed:health]",
      image_direction_ref: "[scrubbed:health]",
      captureUtcOffsetMin: "[scrubbed:health]",
      capture_utc_offset_min: "[scrubbed:health]",
      originalExif: "[scrubbed:health]",
      attempts: 1,
    });
  });

  it("strips the response body of /api/photos/<id>/thumbnail breadcrumbs", () => {
    const event: ScrubbableEvent = {
      breadcrumbs: [
        {
          message: "http",
          data: {
            url: "/api/photos/2b1c/thumbnail",
            method: "GET",
            status_code: 200,
            response_body: "binary",
          },
        },
      ],
    };
    scrubHealthData(event);
    expect(event.breadcrumbs?.[0].data).toEqual({
      url: "/api/photos/2b1c/thumbnail",
      method: "GET",
      status_code: 200,
    });
  });
});

describe("MCP and Telegram scrubbing", () => {
  const BOT_URL = "https://api.telegram.org/bot123456:AAH-secret_Token/sendMessage";

  it("drops the bearer token, body and query of an /api/mcp request", () => {
    const event: ScrubbableEvent = {
      request: {
        url: "https://cistory.example/api/mcp?debug=1",
        data: '{"method":"tools/call","params":{"name":"search","arguments":{"q":"배달"}}}',
        headers: { authorization: "Bearer cmcp_abcdef012345_deadbeef", "user-agent": "agent" },
      },
    };
    scrubHealthData(event);
    expect(event.request).toEqual({
      url: "https://cistory.example/api/mcp",
      data: undefined,
      query_string: undefined,
      headers: { "user-agent": "agent" },
    });
  });

  it("scrubs authorization, args and structuredContent extra keys", () => {
    const event: ScrubbableEvent = {
      extra: {
        authorization: "Bearer x",
        args: { q: "배달" },
        structuredContent: { rows: [] },
        tool: "search",
      },
    };
    scrubHealthData(event);
    expect(event.extra).toEqual({
      authorization: "[scrubbed:health]",
      args: "[scrubbed:health]",
      structuredContent: "[scrubbed:health]",
      tool: "search",
    });
  });

  it("redacts the Telegram bot token from breadcrumbs, messages and exceptions", () => {
    const event: ScrubbableEvent = {
      message: `fetch failed for ${BOT_URL}`,
      exception: { values: [{ value: `request to ${BOT_URL} failed` }] },
      breadcrumbs: [{ message: "fetch", data: { url: BOT_URL, method: "POST", body: "chat" } }],
    };
    scrubHealthData(event);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("AAH-secret_Token");
    expect(serialized).toContain("api.telegram.org/bot[scrubbed]/sendMessage");
    expect(event.breadcrumbs?.[0].data).toEqual({
      url: "https://api.telegram.org/bot[scrubbed]/sendMessage",
      method: "POST",
    });
  });

  it("redacts the Telegram bot token from span names and attributes", () => {
    const span = scrubHealthSpan({
      name: `POST ${BOT_URL}`,
      attributes: { "url.full": BOT_URL, "http.request.header.authorization": ["Bearer x"] },
    });
    expect(JSON.stringify(span)).not.toContain("AAH-secret_Token");
    expect(span.attributes?.["http.request.header.authorization"]).toBe("[scrubbed:health]");
  });
});
