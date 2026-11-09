import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mapped: [] as Array<{ userId: string; healthUserId: string }>,
  verify: vi.fn(),
  enqueue: vi.fn(),
  selectWhere: vi.fn(),
}));

vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          mocks.selectWhere(...args);
          return Promise.resolve(mocks.mapped);
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/google-health-webhook-signature", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google-health-webhook-signature")>();
  return {
    ...actual,
    GoogleHealthKeysetVerifier: class {
      verify = mocks.verify;
    },
  };
});
vi.mock("@/modules/health/webhook-queue", () => ({ enqueueWebhookEvents: mocks.enqueue }));
vi.mock("@/modules/data-status/telemetry", () => ({ recordSourceSuccess: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { KeysetUnavailableError } from "@/lib/google-health-webhook-signature";
import { logger } from "@/lib/logger";
import { recordSourceSuccess } from "@/modules/data-status/telemetry";
import { POST } from "./route";

const SECRET = "Bearer test-webhook-secret-0123456789abcdef";
let ipCounter = 0;

function req(body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("https://app.example.com/api/fitbit/webhook", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "user-agent": "Google-Health-API-Webhooks",
      // Unique IP per request so the unauth rate limiter never trips across tests.
      "x-real-ip": `10.0.0.${++ipCounter % 250}`,
      ...headers,
    },
  });
}

const notification = (over: Record<string, unknown> = {}) => ({
  data: {
    version: "1",
    clientProvidedSubscriptionName: "auto-794779085130-cistory-prod-WEBHOOK_DATA_TYPE_STEPS",
    healthUserId: "1234567890123456789",
    operation: "UPSERT",
    dataType: "steps",
    intervals: [
      {
        physicalTimeInterval: {
          startTime: "2026-11-09T01:29:00Z",
          endTime: "2026-11-09T01:34:00Z",
        },
        civilIso8601TimeInterval: {
          startTime: "2026-11-09T10:29:00",
          endTime: "2026-11-09T10:34:00",
        },
      },
    ],
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_HEALTH_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE", "");
  mocks.mapped = [{ userId: "u1", healthUserId: "1234567890123456789" }];
  mocks.verify.mockResolvedValue({ ok: true, keyId: 1 });
  mocks.enqueue.mockImplementation(async (_db, rows: unknown[]) => rows.length);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verification handshake", () => {
  it("answers 200 to the authorized probe and 401 to the unauthenticated one", async () => {
    const authorized = await POST(req({ type: "verification" }, { authorization: SECRET }));
    expect(authorized.status).toBe(200);
    const anonymous = await POST(req({ type: "verification" }));
    expect(anonymous.status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret and fails closed when no secret is configured", async () => {
    expect((await POST(req([notification()], { authorization: "Bearer nope" }))).status).toBe(401);
    vi.stubEnv("GOOGLE_HEALTH_WEBHOOK_SECRET", "");
    expect((await POST(req({ type: "verification" }, { authorization: "" }))).status).toBe(401);
  });
});

describe("notifications", () => {
  it("enqueues a 99-item batch in one call and answers 204", async () => {
    const batch = Array.from({ length: 99 }, (_, i) =>
      notification({
        intervals: [
          {
            physicalTimeInterval: {
              startTime: `2026-11-09T01:${String(i % 60).padStart(2, "0")}:00Z`,
              endTime: `2026-11-09T02:${String(i % 60).padStart(2, "0")}:00Z`,
            },
          },
        ],
      })
    );
    const res = await POST(
      req(batch, { authorization: SECRET, "google-health-api-signature": "x" })
    );
    expect(res.status).toBe(204);
    expect(mocks.selectWhere).toHaveBeenCalledTimes(1); // one batched user lookup
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    const rows = mocks.enqueue.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(99);
    expect(rows[0]).toMatchObject({
      userId: "u1",
      dataType: "steps",
      operation: "UPSERT",
      recordId: "",
    });
    expect(recordSourceSuccess).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "health",
      expect.any(Date)
    );
  });

  it("accepts a single (non-array) notification object", async () => {
    const res = await POST(req(notification(), { authorization: SECRET }));
    expect(res.status).toBe(204);
    expect(mocks.enqueue.mock.calls[0][1]).toHaveLength(1);
  });

  it("drops unknown health users and DELETE operations without enqueuing them", async () => {
    mocks.mapped = [];
    const res = await POST(
      req(
        [
          notification({ healthUserId: "999" }),
          notification({ operation: "DELETE", recordId: "r1" }),
        ],
        {
          authorization: SECRET,
        }
      )
    );
    expect(res.status).toBe(204);
    expect(mocks.enqueue.mock.calls[0][1]).toEqual([]);
    expect(recordSourceSuccess).not.toHaveBeenCalled();
    const logged = vi.mocked(logger.info).mock.calls.find((c) => c[0].includes("received"));
    expect(logged?.[1]).toMatchObject({ deletesIgnored: 1, unknownUser: 1, enqueued: 0 });
    // Logs never carry the user id or interval times.
    expect(JSON.stringify(logged)).not.toContain("999");
    expect(JSON.stringify(logged)).not.toContain("2026-11-09");
  });

  it("maps a civil-only (daily) interval through KST", async () => {
    await POST(
      req(
        notification({
          intervals: [
            {
              civilDateTimeInterval: {
                startDateTime: { date: { year: 2026, month: 7, day: 14 }, time: {} },
                endDateTime: { date: { year: 2026, month: 7, day: 15 }, time: {} },
              },
              civilIso8601TimeInterval: {
                startTime: "2026-07-14T00:00:00",
                endTime: "2026-07-15T00:00:00",
              },
            },
          ],
        }),
        { authorization: SECRET }
      )
    );
    const [row] = mocks.enqueue.mock.calls[0][1] as Array<{ rangeStart: Date; rangeEnd: Date }>;
    expect(row.rangeStart.toISOString()).toBe("2026-07-13T15:00:00.000Z");
    expect(row.rangeEnd.toISOString()).toBe("2026-07-14T15:00:00.000Z");
  });

  it("413s an oversized body before authenticating", async () => {
    const big = "x".repeat(256 * 1024 + 1);
    const res = await POST(req(big, { authorization: SECRET }));
    expect(res.status).toBe(413);
  });

  it("400s invalid JSON from an authenticated sender", async () => {
    expect((await POST(req("{", { authorization: SECRET }))).status).toBe(400);
  });
});

describe("signature modes", () => {
  it("log-only: a failed signature is logged but the batch is still enqueued", async () => {
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid_signature" });
    const res = await POST(req([notification()], { authorization: SECRET }));
    expect(res.status).toBe(204);
    expect(mocks.enqueue).toHaveBeenCalled();
    const logged = vi.mocked(logger.info).mock.calls.find((c) => c[0].includes("signature"));
    expect(logged?.[1]).toMatchObject({ mode: "log-only", ok: false, reason: "invalid_signature" });
  });

  it("enforce: a failed signature is 401 and nothing is enqueued", async () => {
    vi.stubEnv("GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE", "enforce");
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid_signature" });
    expect((await POST(req([notification()], { authorization: SECRET }))).status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("enforce: a keyset outage is 503 so Google retries", async () => {
    vi.stubEnv("GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE", "enforce");
    mocks.verify.mockRejectedValue(new KeysetUnavailableError("offline"));
    expect((await POST(req([notification()], { authorization: SECRET }))).status).toBe(503);
  });

  it("log-only: a keyset outage does not block ingestion", async () => {
    mocks.verify.mockRejectedValue(new KeysetUnavailableError("offline"));
    expect((await POST(req([notification()], { authorization: SECRET }))).status).toBe(204);
  });

  it("enforce: a valid signature passes", async () => {
    vi.stubEnv("GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE", "enforce");
    expect((await POST(req([notification()], { authorization: SECRET }))).status).toBe(204);
  });
});
