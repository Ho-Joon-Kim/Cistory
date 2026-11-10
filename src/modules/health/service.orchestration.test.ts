import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Crypto is mocked to identity-ish transforms so token (de)encryption is
// deterministic and needs no key — lets us assert non-rotation by value.
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => {
    if (!v.startsWith("enc:")) throw new Error("bad ciphertext");
    return v.slice(4);
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

import type { Database } from "@/db";
import { healthConnections, healthRawPages, healthSamples, healthSyncState } from "@/db/schema";
import {
  GoogleHealthApiError,
  GoogleHealthAuthError,
} from "@/lib/adapters/google-health/interface";
import { buildTimeFilter, HEALTH_METRICS, HealthSyncService, SESSION_CONFIGS } from "./service";

// ── Fake DB ──────────────────────────────────────────────────────────────────
// A minimal drizzle stand-in: select() resolves table-keyed fixture rows;
// insert/update/delete/execute/transaction record their calls so we can assert
// orchestration (which watermark advanced, which table was cleared) without a PG.
interface FakeCfg {
  connectionRows?: Record<string, unknown>[];
  syncStateRows?: Record<string, unknown>[];
  /** Merge healthSyncState upserts back into syncStateRows (single-metric tests),
   *  so successive runs resume from the watermark the previous run wrote. */
  persistSyncState?: boolean;
  /** min(sample_at) for the rollup backfill's lower bound (healthSamples select). */
  oldestSample?: Date | null;
}
function fakeDb(cfg: FakeCfg = {}) {
  const rec = {
    updates: [] as { table: unknown; payload: Record<string, unknown> }[],
    inserts: [] as { table: unknown; values: unknown; conflict?: "nothing" | "update" }[],
    deletes: [] as unknown[],
    executes: 0,
  };
  const resolveFor = (table: unknown) => {
    if (table === healthConnections) return Promise.resolve(cfg.connectionRows ?? []);
    if (table === healthSyncState) return Promise.resolve(cfg.syncStateRows ?? []);
    if (table === healthSamples) return Promise.resolve([{ oldest: cfg.oldestSample ?? null }]);
    return Promise.resolve([]);
  };
  const select = () => {
    let table: unknown;
    const b: Record<string, unknown> = {
      from: (t: unknown) => {
        table = t;
        return b;
      },
      where: () => b,
      // Every service select() ends in .limit(1), so the terminal await lands
      // here — no thenable needed on the builder itself.
      limit: () => resolveFor(table),
    };
    return b;
  };
  const db = {
    select,
    update: (table: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        rec.updates.push({ table, payload });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const entry: (typeof rec.inserts)[number] = { table, values };
        rec.inserts.push(entry);
        if (table === healthSyncState && cfg.persistSyncState) {
          cfg.syncStateRows = [{ ...(cfg.syncStateRows?.[0] ?? {}), ...(values as object) }];
        }
        return {
          onConflictDoNothing: () => {
            entry.conflict = "nothing";
            return Promise.resolve();
          },
          onConflictDoUpdate: () => {
            entry.conflict = "update";
            return Promise.resolve();
          },
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        rec.deletes.push(table);
        return Promise.resolve();
      },
    }),
    execute: () => {
      rec.executes++;
      return Promise.resolve({ rows: [] });
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  } as unknown as Database;
  return { db, rec };
}

const activeConn = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  status: "active",
  // Fresh cached token by default so getValidToken short-circuits (no refresh);
  // the getValidToken tests override these to null to force the refresh path.
  accessTokenEnc: "enc:cached-at",
  accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  refreshTokenEnc: "enc:stored-refresh",
  scope: "s",
  googleSub: "sub",
  lastSyncedAt: null,
  backfillFloor: new Date("2026-01-01T00:00:00Z"),
  backfillCompletedAt: new Date("2026-01-02T00:00:00Z"),
  ...over,
});

// Inject a fake adapter onto the private slot so no real client/env is needed.
function withAdapter(svc: HealthSyncService, adapter: Record<string, unknown>) {
  (svc as unknown as { adapter: unknown }).adapter = adapter;
  return svc;
}

describe("syncUser — lastSyncedAt gate on failure (fix #24)", () => {
  it("does NOT advance lastSyncedAt when every metric fails", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    // Non-auth failure per metric (e.g. 403) → listPageWithAuth rethrows without a
    // refresh attempt, so every metric errors and the gate keeps lastSyncedAt.
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints: vi.fn().mockRejectedValue(new GoogleHealthApiError("forbidden", 403)),
    });
    const res = await svc.syncUser("u1");
    expect(res.skipped).toBe(false);
    const finalUpdate = rec.updates.at(-1);
    expect(finalUpdate?.table).toBe(healthConnections);
    // total failure ⇒ no lastSyncedAt key at all, but the error IS recorded
    expect(finalUpdate?.payload).not.toHaveProperty("lastSyncedAt");
    expect(finalUpdate?.payload.lastSyncError).toBeTruthy();
  });

  it("advances lastSyncedAt when at least one metric succeeds", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    // Every metric returns one empty page → succeeds with 0 samples, no error.
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints: vi.fn().mockResolvedValue({ dataPoints: [] }),
      dailyRollUp: vi.fn().mockResolvedValue({ rollupDataPoints: [] }),
      getIdentity: vi.fn().mockResolvedValue({ healthUserId: "1234" }),
    });
    await svc.syncUser("u1");
    const finalUpdate = rec.updates.at(-1);
    expect(finalUpdate?.payload).toHaveProperty("lastSyncedAt");
    expect(finalUpdate?.payload.lastSyncError).toBeNull();
  });

  it("skips entirely when there is no active connection", async () => {
    const { db, rec } = fakeDb({ connectionRows: [] });
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints: vi.fn() });
    const res = await svc.syncUser("u1");
    expect(res.skipped).toBe(true);
    expect(rec.updates).toHaveLength(0);
  });
});

describe("forward sync — page-cap truncation does not advance the watermark (fix #2)", () => {
  it("leaves syncedThrough unset when the window is truncated", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    // Adapter never stops paginating → the cap trips → truncated=true.
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints: vi.fn().mockResolvedValue({ dataPoints: [], nextPageToken: "endless" }),
    });
    await (
      svc as unknown as {
        syncMetricForward: (c: unknown, m: unknown, n: Date) => Promise<number>;
      }
    ).syncMetricForward(activeConn(), { key: "steps", agg: "sum", valueKey: "count" }, new Date());
    // setSyncState is an insert into healthSyncState — none should have happened.
    expect(rec.inserts.some((i) => i.table === healthSyncState)).toBe(false);
  });

  it("advances syncedThrough on a clean (non-truncated) window", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints: vi.fn().mockResolvedValue({ dataPoints: [] }), // no nextPageToken → done
    });
    await (
      svc as unknown as {
        syncMetricForward: (c: unknown, m: unknown, n: Date) => Promise<number>;
      }
    ).syncMetricForward(activeConn(), { key: "steps", agg: "sum", valueKey: "count" }, new Date());
    const syncStateWrite = rec.inserts.find((i) => i.table === healthSyncState);
    expect(syncStateWrite).toBeDefined();
    expect((syncStateWrite!.values as { syncedThrough?: Date }).syncedThrough).toBeInstanceOf(Date);
  });
});

describe("backfill — all-time walk, gap-proof stop (presence probe)", () => {
  const config = {
    key: "steps",
    dataType: "steps",
    wrapper: "steps",
    timeShape: "interval",
    filterField: "steps.interval.start_time",
    valueKey: "count",
    agg: "sum",
  };
  const deepFloor = new Date("2020-01-01T00:00:00Z"); // far past → floor won't trip first
  const runBackfill = (svc: HealthSyncService) =>
    (
      svc as unknown as {
        backfillMetric: (c: unknown, m: unknown, f: Date) => Promise<{ reachedFloor: boolean }>;
      }
    ).backfillMetric(activeConn(), config, deepFloor);

  it("stops at the first empty window when NO data remains below the cursor", async () => {
    const { db } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    // Every call empty: the window fetch AND the presence probe find nothing.
    const listDataPoints = vi.fn().mockResolvedValue({ dataPoints: [] });
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints });
    const done = await runBackfill(svc);
    expect(done.reachedFloor).toBe(true);
    // one window fetch + one presence probe, then done — not the full 4-chunk run
    expect(listDataPoints).toHaveBeenCalledTimes(2);
  });

  it("does NOT stop on an empty window when older data exists beyond the gap", async () => {
    const { db } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    // pageSize 1 = the presence probe → data exists somewhere below (a gap, not the
    // end). Larger page = the window fetch → this specific window is empty.
    const listDataPoints = vi.fn().mockImplementation((opts: { pageSize?: number }) =>
      Promise.resolve({
        dataPoints:
          opts.pageSize === 1
            ? [{ steps: { interval: { startTime: "2025-01-01T00:00:00Z" }, count: "1" } }]
            : [],
      })
    );
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints });
    const done = await runBackfill(svc);
    // gap traversed: all 4 chunks walked, not stopped; not done (more remains below)
    expect(done.reachedFloor).toBe(false);
    const probeCalls = listDataPoints.mock.calls.filter((c) => c[0].pageSize === 1);
    expect(probeCalls.length).toBe(4); // probed on every empty window, kept going
  });
});

describe("rollup metrics (dailyRollUp) — total_calories", () => {
  const totalCalories = HEALTH_METRICS.find((c) => c.key === "total_calories")!;
  const rollupPoint = (y: number, m: number, d: number, kcal: number) => ({
    civilStartTime: { date: { year: y, month: m, day: d }, time: {} },
    civilEndTime: { date: { year: y, month: m, day: d + 1 }, time: {} },
    totalCalories: { kcalSum: kcal },
  });
  type Priv = {
    syncMetricForward: (c: unknown, m: unknown, n: Date) => Promise<number>;
    backfillRollupMetric: (
      c: unknown,
      m: unknown,
      f: Date,
      listPending: boolean
    ) => Promise<{ upserted: number; reachedFloor: boolean }>;
  };

  it("forward sync reads by civil-date range with the google-wearables family", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const dailyRollUp = vi
      .fn()
      .mockResolvedValue({ rollupDataPoints: [rollupPoint(2026, 11, 9, 2100)] });
    const listDataPoints = vi.fn();
    const svc = withAdapter(new HealthSyncService(db), { dailyRollUp, listDataPoints });
    const now = new Date("2026-11-10T03:00:00Z"); // 12:00 KST
    const n = await (svc as unknown as Priv).syncMetricForward(activeConn(), totalCalories, now);
    expect(n).toBe(1);
    expect(listDataPoints).not.toHaveBeenCalled(); // rollup-only types 400 on list
    const opts = dailyRollUp.mock.calls[0][0];
    expect(opts.dataType).toBe("total-calories");
    expect(opts.dataSourceFamily).toBe("google-wearables");
    expect(opts.windowSizeDays).toBe(1);
    // fallback since = now − 7d (11-03) minus a day → 11-02; through tomorrow (exclusive 11-12).
    expect(opts.range).toEqual({
      start: { year: 2026, month: 11, day: 2 },
      end: { year: 2026, month: 11, day: 12 },
    });
    const ins = rec.inserts.find((i) => i.table === healthSamples);
    const row = (ins!.values as Array<Record<string, unknown>>)[0];
    expect(row.metric).toBe("total_calories");
    expect(row.source).toBe("rollup:google-wearables");
    expect(row.value).toBe(2100);
    // 2026-11-09 anchored at 12:00 KST = 03:00Z
    expect((row.sampleAt as Date).toISOString()).toBe("2026-11-09T03:00:00.000Z");
    expect(rec.inserts.some((i) => i.table === healthSyncState)).toBe(true);
  });

  it("follows nextPageToken and does not advance the watermark when truncated", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const dailyRollUp = vi.fn().mockResolvedValue({ rollupDataPoints: [], nextPageToken: "more" });
    const svc = withAdapter(new HealthSyncService(db), { dailyRollUp });
    await (svc as unknown as Priv).syncMetricForward(activeConn(), totalCalories, new Date());
    expect(dailyRollUp.mock.calls.length).toBeGreaterThan(1);
    expect(dailyRollUp.mock.calls[1][0].pageToken).toBe("more");
    expect(rec.inserts.some((i) => i.table === healthSyncState)).toBe(false);
  });

  it("backfill keeps walking through empty chunks down to the oldest observed day", async () => {
    const oldest = new Date(Date.now() - 200 * 86_400_000);
    const { db, rec } = fakeDb({
      connectionRows: [activeConn()],
      syncStateRows: [],
      oldestSample: oldest,
    });
    const dailyRollUp = vi.fn().mockResolvedValue({ rollupDataPoints: [] });
    const svc = withAdapter(new HealthSyncService(db), { dailyRollUp });
    const done = await (svc as unknown as Priv).backfillRollupMetric(
      activeConn(),
      totalCalories,
      new Date("2020-01-01T00:00:00Z"),
      false
    );
    // Empty months are real (design §8), so an empty chunk never ends the walk.
    expect(dailyRollUp).toHaveBeenCalledTimes(4);
    expect(done.reachedFloor).toBe(false);
    const cursorWrites = rec.inserts.filter((i) => i.table === healthSyncState);
    expect(cursorWrites).toHaveLength(4);
  });

  it("backfill stamps the floor once it passes the oldest observed day", async () => {
    const floor = new Date("2020-01-01T00:00:00Z");
    const { db, rec } = fakeDb({
      connectionRows: [activeConn()],
      syncStateRows: [],
      oldestSample: new Date(Date.now() - 10 * 86_400_000),
    });
    const dailyRollUp = vi.fn().mockResolvedValue({ rollupDataPoints: [] });
    const svc = withAdapter(new HealthSyncService(db), { dailyRollUp });
    const done = await (svc as unknown as Priv).backfillRollupMetric(
      activeConn(),
      totalCalories,
      floor,
      false
    );
    expect(done.reachedFloor).toBe(true);
    // 7d start → 11d lower bound = one chunk, then the floor stamp.
    expect(dailyRollUp).toHaveBeenCalledTimes(1);
    const last = rec.inserts.filter((i) => i.table === healthSyncState).at(-1);
    expect((last!.values as { backfilledFrom: Date }).backfilledFrom).toEqual(floor);
  });

  it("backfill waits (not done) while list metrics may still extend the bound", async () => {
    const { db } = fakeDb({
      connectionRows: [activeConn()],
      syncStateRows: [],
      oldestSample: new Date(Date.now() - 10 * 86_400_000),
    });
    const svc = withAdapter(new HealthSyncService(db), {
      dailyRollUp: vi.fn().mockResolvedValue({ rollupDataPoints: [] }),
    });
    const done = await (svc as unknown as Priv).backfillRollupMetric(
      activeConn(),
      totalCalories,
      new Date("2020-01-01T00:00:00Z"),
      true
    );
    expect(done.reachedFloor).toBe(false);
  });

  it("backfill with no observed samples at all makes no calls", async () => {
    const { db } = fakeDb({
      connectionRows: [activeConn()],
      syncStateRows: [],
      oldestSample: null,
    });
    const dailyRollUp = vi.fn();
    const svc = withAdapter(new HealthSyncService(db), { dailyRollUp });
    const done = await (svc as unknown as Priv).backfillRollupMetric(
      activeConn(),
      totalCalories,
      new Date("2020-01-01T00:00:00Z"),
      false
    );
    expect(dailyRollUp).not.toHaveBeenCalled();
    expect(done.reachedFloor).toBe(true);
  });
});

describe("ensureHealthUserId — webhook mapping", () => {
  it("stores the identity's healthUserId when missing", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    const getIdentity = vi.fn().mockResolvedValue({ healthUserId: "5550001" });
    const svc = withAdapter(new HealthSyncService(db), { getIdentity });
    const conn = activeConn({ userId: "id-u1", healthUserId: null });
    await svc.ensureHealthUserId(conn as never);
    expect(getIdentity).toHaveBeenCalledWith("cached-at");
    const write = rec.updates.find((u) => "healthUserId" in u.payload);
    expect(write?.payload.healthUserId).toBe("5550001");
  });

  it("is a no-op when already stored", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    const getIdentity = vi.fn();
    const svc = withAdapter(new HealthSyncService(db), { getIdentity });
    await svc.ensureHealthUserId(activeConn({ healthUserId: "x" }) as never);
    expect(getIdentity).not.toHaveBeenCalled();
    expect(rec.updates).toHaveLength(0);
  });

  it("swallows a lookup failure and throttles the retry", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    const getIdentity = vi.fn().mockRejectedValue(new GoogleHealthApiError("forbidden", 403));
    const svc = withAdapter(new HealthSyncService(db), { getIdentity });
    const conn = activeConn({ userId: "id-u2", healthUserId: null });
    await expect(svc.ensureHealthUserId(conn as never)).resolves.toBeUndefined();
    await svc.ensureHealthUserId(conn as never);
    expect(getIdentity).toHaveBeenCalledTimes(1);
    expect(rec.updates).toHaveLength(0);
  });
});

describe("sessions — time-windowed forward sync + backfill", () => {
  const session = (key: string) => SESSION_CONFIGS.find((c) => c.key === key)!;
  type Internals = {
    syncMetricForward: (c: unknown, m: unknown, n: Date) => Promise<number>;
    backfillMetric: (
      c: unknown,
      m: unknown,
      f: Date
    ) => Promise<{ upserted: number; reachedFloor: boolean }>;
  };
  const internals = (svc: HealthSyncService) => svc as unknown as Internals;

  it("upserts parsed workouts (DO UPDATE) and records the raw page", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const point = {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      exercise: {
        interval: { startTime: "2026-07-11T09:30:00Z" },
        exerciseType: "BIKING",
        displayName: "자전거",
        activeDuration: "660s",
      },
    };
    const listDataPoints = vi.fn().mockResolvedValue({ dataPoints: [point] });
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints });
    const now = new Date("2026-07-12T00:00:00Z");
    expect(await internals(svc).syncMetricForward(activeConn(), session("exercise"), now)).toBe(1);

    // First run: no watermark → 7d fallback, as a civil day padded by one.
    expect(listDataPoints.mock.calls[0][0].filter).toBe(
      'exercise.interval.civil_start_time >= "2026-07-04"'
    );
    const ins = rec.inserts.find((i) => i.table === healthSamples);
    expect(ins?.conflict).toBe("update");
    const row = (ins!.values as Array<Record<string, unknown>>)[0];
    expect(row.metric).toBe("exercise");
    expect(row.value).toBe(11); // 660s → 11 min
    expect((row.valueJson as { displayName?: string }).displayName).toBe("자전거");
    expect(rec.inserts.some((i) => i.table === healthRawPages)).toBe(true);
    // No daily summary for sessions (a workout list / hypnogram, not a scalar).
    expect(rec.executes).toBe(0);
    const state = rec.inserts.find((i) => i.table === healthSyncState);
    expect((state!.values as { syncedThrough?: Date }).syncedThrough).toEqual(now);
  });

  it("keeps sleep stages and re-reads a week behind the watermark", async () => {
    const syncedThrough = new Date("2026-07-20T00:00:00Z");
    const { db, rec } = fakeDb({
      connectionRows: [activeConn()],
      syncStateRows: [{ metric: "sleep", syncedThrough }],
    });
    const point = {
      dataSource: { platform: "FITBIT" },
      sleep: {
        interval: { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T10:16:00Z" },
        type: "STAGES",
        stages: [
          { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T07:38:30Z", type: "AWAKE" },
        ],
      },
    };
    const listDataPoints = vi.fn().mockResolvedValue({ dataPoints: [point] });
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints });
    await internals(svc).syncMetricForward(
      activeConn(),
      session("sleep"),
      new Date("2026-07-27T00:00:00Z")
    );
    // A night uploaded after the previous window closed is still picked up.
    expect(listDataPoints.mock.calls[0][0].filter).toBe(
      'sleep.interval.end_time >= "2026-07-13T00:00:00.000Z"'
    );
    const row = (
      rec.inserts.find((i) => i.table === healthSamples)!.values as Array<Record<string, unknown>>
    )[0];
    expect(row.metric).toBe("sleep");
    expect(row.value).toBe(172);
    expect((row.valueJson as { stages?: unknown[] }).stages).toHaveLength(1);
  });

  // Postgres rejects a DO UPDATE insert that hits one conflict row twice, and the
  // live exercise history really does repeat identities (938 points, 927 distinct).
  it("collapses a repeated identity within a page before the DO UPDATE insert", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const dup = (displayName: string) => ({
      dataSource: { platform: "FITBIT" },
      exercise: { interval: { startTime: "2026-07-11T09:30:00Z" }, displayName },
    });
    const other = {
      dataSource: { application: { packageName: "com.withings.wiscale2" } },
      exercise: { interval: { startTime: "2026-07-11T09:30:00Z" } },
    };
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints: vi.fn().mockResolvedValue({ dataPoints: [dup("a"), dup("b"), other] }),
    });
    const n = await internals(svc).syncMetricForward(
      activeConn(),
      session("exercise"),
      new Date("2026-07-12T00:00:00Z")
    );
    expect(n).toBe(2); // same start + same source collapses; another source survives
    const rows = rec.inserts.find((i) => i.table === healthSamples)!.values as Array<{
      source: string;
      valueJson: { displayName?: string };
    }>;
    expect(rows.map((r) => r.source)).toEqual(["FITBIT", "com.withings.wiscale2"]);
    expect(rows[0].valueJson.displayName).toBe("a");
  });

  it("syncUser time-filters both session types (no unfiltered read remains)", async () => {
    const { db } = fakeDb({ connectionRows: [activeConn()] });
    const listDataPoints = vi.fn().mockResolvedValue({ dataPoints: [] });
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints });
    await svc.syncUser("u1");
    const byType = (t: string) =>
      listDataPoints.mock.calls.map((c) => c[0]).filter((o) => o.dataType === t);
    expect(byType("exercise")[0]?.filter).toMatch(/^exercise\.interval\.civil_start_time >= "/);
    expect(byType("sleep")[0]?.filter).toMatch(/^sleep\.interval\.end_time >= "/);
    for (const call of listDataPoints.mock.calls) expect(call[0].filter).not.toBe("");
  });

  it("the presence probe uses the civil filter and ends an exhausted walk", async () => {
    const { db } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const listDataPoints = vi.fn().mockResolvedValue({ dataPoints: [] });
    const svc = withAdapter(new HealthSyncService(db), { listDataPoints });
    const floor = new Date("2020-01-01T00:00:00Z");
    const done = await internals(svc).backfillMetric(activeConn(), session("exercise"), floor);
    expect(done.reachedFloor).toBe(true);
    expect(listDataPoints).toHaveBeenCalledTimes(2); // one window + one probe
    const probe = listDataPoints.mock.calls[1][0];
    expect(probe.pageSize).toBe(1);
    expect(probe.filter).toMatch(
      /^exercise\.interval\.civil_start_time >= "2019-12-31" AND exercise\.interval\.civil_start_time < "\d{4}-\d\d-\d\d"$/
    );
  });

  // The bug: a 10-page unfiltered read only ever saw the newest ~250 workouts, while
  // the real account has 938 (38 pages) back to 2025-07-08. The windowed walk must
  // reach all of them across bounded runs.
  describe("reaches more history than the old 10-page cap, across bounded runs", () => {
    const NOW = new Date("2026-11-09T03:00:00Z");
    const OLDEST = Date.UTC(2025, 6, 8, 0, 0, 0); // 2025-07-08
    const COUNT = 938;
    const PAGE = 25; // what the API actually returns per exercise page
    const step = (NOW.getTime() - 8 * 86_400_000 - OLDEST) / (COUNT - 1);
    const workouts = Array.from({ length: COUNT }, (_, i) => ({
      dataSource: { platform: "FITBIT" },
      exercise: {
        interval: { startTime: new Date(OLDEST + i * step).toISOString() },
        activeDuration: "600s",
      },
    }));
    const kstDay = (iso: string) =>
      new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

    // A fake API that honours the civil_start_time filter and pages newest-first.
    const fakeList = vi.fn(
      async (opts: { filter?: string; pageSize?: number; pageToken?: string }) => {
        const lo = opts.filter?.match(/>= "([\d-]+)"/)?.[1] ?? "0000";
        const hi = opts.filter?.match(/< "([\d-]+)"/)?.[1] ?? "9999";
        const hits = workouts
          .filter((w) => {
            const d = kstDay(w.exercise.interval.startTime);
            return d >= lo && d < hi;
          })
          .reverse();
        const size = Math.min(opts.pageSize ?? PAGE, PAGE);
        const offset = Number(opts.pageToken ?? 0);
        const next = offset + size < hits.length ? String(offset + size) : undefined;
        return { dataPoints: hits.slice(offset, offset + size), nextPageToken: next };
      }
    );

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("imports every workout back to 2025-07-08, a bounded chunk count per run", async () => {
      const fake = fakeDb({ connectionRows: [activeConn()], persistSyncState: true });
      const svc = withAdapter(new HealthSyncService(fake.db), { listDataPoints: fakeList });
      const floor = new Date("2021-11-01T00:00:00Z");
      const config = session("exercise");

      await internals(svc).syncMetricForward(activeConn(), config, NOW);
      let runs = 0;
      let done = { upserted: 0, reachedFloor: false };
      while (!done.reachedFloor && runs < 50) {
        const before = fakeList.mock.calls.filter((c) => (c[0].pageSize ?? 0) !== 1).length;
        done = await internals(svc).backfillMetric(activeConn(), config, floor);
        runs++;
        // ≤ 4 chunks/run → each run reads a bounded window, never the whole history
        const windowPages = fakeList.mock.calls.filter((c) => (c[0].pageSize ?? 0) !== 1).length;
        expect(windowPages - before).toBeLessThanOrEqual(4 * 3);
      }

      expect(done.reachedFloor).toBe(true);
      expect(runs).toBeGreaterThan(1); // resumed from the stored cursor across runs
      const stored = new Set(
        fake.rec.inserts
          .filter((i) => i.table === healthSamples)
          .flatMap((i) => i.values as Array<{ sampleAt: Date }>)
          .map((r) => r.sampleAt.toISOString())
      );
      expect(stored.size).toBe(COUNT); // vs. 10 pages × 25 = 250 under the old cap
      expect([...stored].sort()[0]).toBe(new Date(OLDEST).toISOString());
      // Done = cursor stamped at the floor, so the next tick skips this metric.
      expect((fake.rec.inserts.at(-1)!.values as { backfilledFrom?: Date }).backfilledFrom).toEqual(
        floor
      );
    });

    it("each run resumes at the cursor the previous run stored", async () => {
      const fake = fakeDb({ connectionRows: [activeConn()], persistSyncState: true });
      const svc = withAdapter(new HealthSyncService(fake.db), { listDataPoints: fakeList });
      const floor = new Date("2021-11-01T00:00:00Z");
      const config = session("exercise");
      await internals(svc).backfillMetric(activeConn(), config, floor);
      const cursor = fake.rec.inserts.filter((i) => i.table === healthSyncState).at(-1)!.values as {
        backfilledFrom: Date;
      };
      // first run: anchored at now−7d, walked 4 × 14 days
      expect(cursor.backfilledFrom).toEqual(new Date(NOW.getTime() - (7 + 56) * 86_400_000));
      fakeList.mockClear();
      await internals(svc).backfillMetric(activeConn(), config, floor);
      expect(fakeList.mock.calls[0][0].filter).toBe(
        buildTimeFilter(
          config,
          new Date(cursor.backfilledFrom.getTime() - 14 * 86_400_000),
          cursor.backfilledFrom
        )
      );
    });
  });
});

describe("disconnect — clears sync watermarks (fix #11)", () => {
  it("deletes both the connection and its sync_state", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    const svc = withAdapter(new HealthSyncService(db), {
      revokeToken: vi.fn().mockResolvedValue(undefined),
    });
    await svc.disconnect("u1");
    expect(rec.deletes).toContain(healthConnections);
    expect(rec.deletes).toContain(healthSyncState);
  });
});

describe("getValidToken — Google refresh-token non-rotation", () => {
  it("preserves the stored refresh token when the refresh omits one", async () => {
    const stale = activeConn({ accessTokenEnc: null, accessTokenExpiresAt: null });
    const { db, rec } = fakeDb({ connectionRows: [stale] });
    const refreshToken = vi.fn().mockResolvedValue({
      accessToken: "new-at",
      refreshToken: "stored-refresh", // adapter echoes the preserved token
      expiresAt: new Date(Date.now() + 3600_000),
      scope: "s",
      googleSub: "sub",
    });
    const svc = withAdapter(new HealthSyncService(db), { refreshToken });
    const token = await svc.getValidToken(stale as never);
    expect(token).toBe("new-at");
    const write = rec.updates.find(
      (u) => u.table === healthConnections && "refreshTokenEnc" in u.payload
    );
    expect(write?.payload.accessTokenEnc).toBe("enc:new-at");
    expect(write?.payload.refreshTokenEnc).toBe("enc:stored-refresh"); // unchanged
    expect(write?.payload.status).toBe("active");
  });

  it("flips needs_reauth only on a confirmed auth error", async () => {
    const stale = activeConn({ accessTokenEnc: null, accessTokenExpiresAt: null });
    const { db, rec } = fakeDb({ connectionRows: [stale] });
    const svc = withAdapter(new HealthSyncService(db), {
      refreshToken: vi.fn().mockRejectedValue(new GoogleHealthAuthError("invalid_grant", 400)),
    });
    await expect(svc.getValidToken(stale as never)).rejects.toBeInstanceOf(GoogleHealthAuthError);
    const reauth = rec.updates.find((u) => u.payload.status === "needs_reauth");
    expect(reauth).toBeDefined();
  });
});

describe("ECG / IRN — optional-scope sync", () => {
  const ECG_SCOPE = "https://www.googleapis.com/auth/googlehealth.ecg.readonly";
  const IRN_SCOPE = "https://www.googleapis.com/auth/googlehealth.irn.readonly";
  const ecgPoint = {
    dataSource: { platform: "FITBIT" },
    electrocardiogram: {
      interval: { startTime: "2026-11-10T01:00:00Z" },
      resultClassification: "NORMAL_SINUS_RHYTHM",
      beatsPerMinuteAvg: "70",
      waveformSamples: [1, 2, 3],
    },
  };
  const dataTypesCalled = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.map((c) => (c[0] as { dataType: string }).dataType);

  it("never requests ECG/IRN without the optional scopes (no 403 noise)", async () => {
    const { db } = fakeDb({ connectionRows: [activeConn()], syncStateRows: [] });
    const listDataPoints = vi.fn().mockResolvedValue({ dataPoints: [] });
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints,
      dailyRollUp: vi.fn().mockResolvedValue({ rollupDataPoints: [] }),
      getIdentity: vi.fn().mockResolvedValue({ healthUserId: null }),
    });
    await svc.syncUser("u1");
    expect(dataTypesCalled(listDataPoints)).not.toContain("electrocardiogram");
    expect(dataTypesCalled(listDataPoints)).not.toContain("irregular-rhythm-notification");
  });

  it("syncs ECG from the backfill floor with a >=-only filter and stores no waveform", async () => {
    const conn = activeConn({ scope: `openid ${ECG_SCOPE}`, healthUserId: "h" });
    const { db, rec } = fakeDb({ connectionRows: [conn], syncStateRows: [] });
    const listDataPoints = vi
      .fn()
      .mockImplementation((opts: { dataType: string }) =>
        Promise.resolve({ dataPoints: opts.dataType === "electrocardiogram" ? [ecgPoint] : [] })
      );
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints,
      dailyRollUp: vi.fn().mockResolvedValue({ rollupDataPoints: [] }),
    });
    await svc.syncUser("u1");
    const ecgCall = listDataPoints.mock.calls.find((c) => c[0].dataType === "electrocardiogram");
    expect(ecgCall?.[0].filter).toBe(
      'electrocardiogram.interval.start_time >= "2026-01-01T00:00:00.000Z"'
    );
    expect(ecgCall?.[0].filter).not.toContain("<");
    expect(dataTypesCalled(listDataPoints)).not.toContain("irregular-rhythm-notification");
    const ecgRows = rec.inserts
      .filter((i) => i.table === healthSamples)
      .flatMap((i) => i.values as Array<Record<string, unknown>>)
      .filter((r) => r.metric === "ecg");
    expect(ecgRows).toHaveLength(1);
    expect(ecgRows[0]).toMatchObject({ value: 70, source: "FITBIT" });
    expect(JSON.stringify(ecgRows[0].valueJson)).not.toContain("waveform");
  });

  it("falls back to an unfiltered IRN read when its filter field is rejected", async () => {
    const conn = activeConn({ scope: `openid ${IRN_SCOPE}`, healthUserId: "h" });
    const { db } = fakeDb({ connectionRows: [conn], syncStateRows: [] });
    const listDataPoints = vi
      .fn()
      .mockImplementation((opts: { dataType: string; filter: string }) => {
        if (opts.dataType === "irregular-rhythm-notification" && opts.filter) {
          return Promise.reject(new GoogleHealthApiError("bad filter", 400));
        }
        return Promise.resolve({ dataPoints: [] });
      });
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints,
      dailyRollUp: vi.fn().mockResolvedValue({ rollupDataPoints: [] }),
    });
    await svc.syncUser("u1");
    const irnFilters = listDataPoints.mock.calls
      .filter((c) => c[0].dataType === "irregular-rhythm-notification")
      .map((c) => c[0].filter);
    expect(irnFilters).toEqual([
      'irregular_rhythm_notification.interval.start_time >= "2026-01-01T00:00:00.000Z"',
      "",
    ]);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
