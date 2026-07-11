import { describe, expect, it } from "vitest";
import { type ScrubbableEvent, scrubHealthData } from "./sentry-scrub";

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
