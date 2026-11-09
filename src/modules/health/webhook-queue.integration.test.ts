import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// api-handler → auth-helpers → auth.ts builds the app pool at import time.
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import {
  claimWebhookEvents,
  enqueueWebhookEvents,
  processHealthWebhookQueue,
  type WebhookConsumerDeps,
  type WebhookEventInput,
} from "./webhook-queue";

/**
 * Real-Postgres properties of the webhook queue: the unique key absorbs
 * re-deliveries (and re-arms finished rows), SKIP LOCKED never hands one event
 * to two workers, and range timestamps land as UTC wall time under the
 * container's Asia/Seoul session timezone.
 *
 * The cross-connection lock test needs COMMITTED rows, so this file can't use
 * the rollback-per-test helper. It writes to the real tables under fresh
 * fixture users and deletes those users afterwards (the events cascade). It
 * deliberately does no DDL: creating/dropping a private schema races Better
 * Auth's catalog introspection in auth-compatibility.integration.test.ts, which
 * runs concurrently.
 */
describe("health_webhook_events queue against PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const created: string[] = [];

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    db = drizzle(pool, { schema }) as unknown as Database;
  });

  afterEach(async () => {
    if (created.length) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.splice(0)]);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function newUser(): Promise<string> {
    const id = await insertTestUser(db as unknown as TestDb);
    created.push(id);
    return id;
  }

  const event = (userId: string, over: Partial<WebhookEventInput> = {}): WebhookEventInput => ({
    userId,
    dataType: "steps",
    operation: "UPSERT",
    rangeStart: new Date("2026-11-09T01:29:00Z"),
    rangeEnd: new Date("2026-11-09T01:34:00Z"),
    recordId: "",
    ...over,
  });

  it("stores ranges as UTC wall time and absorbs re-deliveries", async () => {
    const user = await newUser();
    const t0 = new Date("2026-11-09T02:00:00Z");
    await enqueueWebhookEvents(db, [event(user), event(user)], t0);
    await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T02:05:00Z"));
    const { rows } = await pool.query(
      "SELECT range_start::text AS s, received_at::text AS r, status FROM health_webhook_events"
    );
    expect(rows).toEqual([
      // UTC wall time even though the session TimeZone is Asia/Seoul.
      { s: "2026-11-09 01:29:00", r: "2026-11-09 02:05:00", status: "pending" },
    ]);
  });

  it("re-arms a done row when the same interval is notified again", async () => {
    const user = await newUser();
    await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T02:00:00Z"));
    await pool.query(
      "UPDATE health_webhook_events SET status = 'done', attempts = 2, last_error = 'x'"
    );
    await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T03:00:00Z"));
    const { rows } = await pool.query(
      "SELECT status, attempts, last_error FROM health_webhook_events"
    );
    expect(rows).toEqual([{ status: "pending", attempts: 0, last_error: null }]);
  });

  it("SKIP LOCKED: a second worker never claims rows another worker holds", async () => {
    const user = await newUser();
    const now = new Date("2026-11-09T04:00:00Z");
    await enqueueWebhookEvents(
      db,
      [0, 1, 2, 3].map((i) =>
        event(user, {
          rangeStart: new Date(Date.UTC(2026, 10, 9, i)),
          rangeEnd: new Date(Date.UTC(2026, 10, 9, i, 5)),
        })
      ),
      now
    );
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const locked = await holder.query(
        "SELECT id FROM health_webhook_events ORDER BY range_start LIMIT 2 FOR UPDATE"
      );
      const claimed = await claimWebhookEvents(db, now, 10);
      const lockedIds = locked.rows.map((r: { id: string }) => r.id);
      expect(claimed).toHaveLength(2);
      for (const c of claimed) expect(lockedIds).not.toContain(c.id);
      await holder.query("COMMIT");
    } finally {
      holder.release();
    }
    // The held rows are still claimable afterwards; the claimed ones are leased.
    const second = await claimWebhookEvents(db, now, 10);
    expect(second).toHaveLength(2);
  });

  function deps(over: Partial<WebhookConsumerDeps> = {}) {
    const refreshMetricWindow = vi.fn().mockResolvedValue({ upserted: 0, truncated: false });
    const withingsSync = vi.fn().mockResolvedValue(undefined);
    const service = {
      getConnection: vi.fn().mockResolvedValue({ userId: "x", status: "active" }),
      refreshMetricWindow,
    } as unknown as WebhookConsumerDeps["service"];
    return {
      d: { service, withingsSync, now: () => new Date("2026-11-09T06:00:00Z"), ...over },
      refreshMetricWindow,
      withingsSync,
    };
  }

  it("merges a type's intervals into one read and completes the events", async () => {
    const user = await newUser();
    await enqueueWebhookEvents(
      db,
      [
        event(user),
        event(user, {
          rangeStart: new Date("2026-11-09T03:00:00Z"),
          rangeEnd: new Date("2026-11-09T03:05:00Z"),
        }),
        event(user, { dataType: "sleep", recordId: "r1" }),
      ],
      new Date("2026-11-09T05:00:00Z")
    );
    const { d, refreshMetricWindow } = deps();
    const out = await processHealthWebhookQueue(db, d);
    expect(out).toMatchObject({ claimed: 3, done: 3, failed: 0 });
    // One windowed read per type: steps (two intervals merged) and sleep.
    expect(refreshMetricWindow).toHaveBeenCalledTimes(2);
    const steps = refreshMetricWindow.mock.calls.find((c) => c[1].key === "steps")!;
    expect(steps[2].toISOString()).toBe("2026-11-09T00:29:00.000Z"); // −1h pad
    expect(steps[3].toISOString()).toBe("2026-11-09T04:05:00.000Z"); // +1h pad
    // Sessions are time-windowed (#55), so sleep re-reads only its own window.
    expect(refreshMetricWindow.mock.calls.some((c) => c[1].key === "sleep")).toBe(true);
    const { rows } = await pool.query("SELECT DISTINCT status FROM health_webhook_events");
    expect(rows).toEqual([{ status: "done" }]);
  });

  it("a weight burst triggers one Withings sync and no Google read", async () => {
    const user = await newUser();
    await enqueueWebhookEvents(
      db,
      [0, 1, 2].map((i) =>
        event(user, {
          dataType: "weight",
          rangeStart: new Date(Date.UTC(2026, 10, 9, i)),
          rangeEnd: new Date(Date.UTC(2026, 10, 9, i, 1)),
        })
      ),
      new Date("2026-11-09T05:00:00Z")
    );
    const { d, withingsSync, refreshMetricWindow } = deps();
    await processHealthWebhookQueue(db, d);
    expect(withingsSync).toHaveBeenCalledTimes(1);
    expect(withingsSync).toHaveBeenCalledWith(user);
    expect(refreshMetricWindow).not.toHaveBeenCalled();
  });

  it("a re-delivery that lands mid-processing re-queues instead of completing", async () => {
    const user = await newUser();
    await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T05:00:00Z"));
    const { d, refreshMetricWindow } = deps();
    refreshMetricWindow.mockImplementation(async () => {
      await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T06:30:00Z"));
      return { upserted: 1, truncated: false };
    });
    await processHealthWebhookQueue(db, d);
    const { rows } = await pool.query("SELECT status, attempts FROM health_webhook_events");
    expect(rows).toEqual([{ status: "pending", attempts: 0 }]);
  });

  it("fails terminally when the connection is no longer active, and retries other errors", async () => {
    const user = await newUser();
    await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T05:00:00Z"));
    const inactive = deps();
    vi.mocked(inactive.d.service.getConnection).mockResolvedValue(null);
    await processHealthWebhookQueue(db, inactive.d);
    let { rows } = await pool.query("SELECT status FROM health_webhook_events");
    expect(rows).toEqual([{ status: "failed" }]);

    await pool.query("DELETE FROM health_webhook_events WHERE user_id = $1", [user]);
    await enqueueWebhookEvents(db, [event(user)], new Date("2026-11-09T05:00:00Z"));
    const flaky = deps();
    flaky.refreshMetricWindow.mockRejectedValue(new Error("HTTP 503"));
    await processHealthWebhookQueue(db, flaky.d);
    ({ rows } = await pool.query("SELECT status, attempts, last_error FROM health_webhook_events"));
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1 });
    // Fixed Korean message — never the provider's error text.
    expect(rows[0].last_error).not.toContain("503");
  });

  it("leaves the cross-user rows of another user untouched", async () => {
    const a = await newUser();
    const b = await newUser();
    await enqueueWebhookEvents(db, [event(a), event(b)], new Date("2026-11-09T05:00:00Z"));
    const { d } = deps();
    vi.mocked(d.service.getConnection).mockImplementation(async (userId: string) =>
      userId === a ? ({ userId, status: "active" } as never) : null
    );
    await processHealthWebhookQueue(db, d);
    const rows = await db
      .select({
        userId: schema.healthWebhookEvents.userId,
        status: schema.healthWebhookEvents.status,
      })
      .from(schema.healthWebhookEvents)
      .where(eq(schema.healthWebhookEvents.userId, a));
    expect(rows).toEqual([{ userId: a, status: "done" }]);
  });
});
