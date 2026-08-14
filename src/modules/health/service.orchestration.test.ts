import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { healthConnections, healthSamples, healthSyncState } from "@/db/schema";
import {
  GoogleHealthApiError,
  GoogleHealthAuthError,
} from "@/lib/adapters/google-health/interface";
import { HealthSyncService, SESSION_CONFIGS } from "./service";

// ── Fake DB ──────────────────────────────────────────────────────────────────
// A minimal drizzle stand-in: select() resolves table-keyed fixture rows;
// insert/update/delete/execute/transaction record their calls so we can assert
// orchestration (which watermark advanced, which table was cleared) without a PG.
interface FakeCfg {
  connectionRows?: Record<string, unknown>[];
  syncStateRows?: Record<string, unknown>[];
}
function fakeDb(cfg: FakeCfg = {}) {
  const rec = {
    updates: [] as { table: unknown; payload: Record<string, unknown> }[],
    inserts: [] as { table: unknown; values: unknown }[],
    deletes: [] as unknown[],
    executes: 0,
  };
  const resolveFor = (table: unknown) => {
    if (table === healthConnections) return Promise.resolve(cfg.connectionRows ?? []);
    if (table === healthSyncState) return Promise.resolve(cfg.syncStateRows ?? []);
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
        rec.inserts.push({ table, values });
        return {
          onConflictDoNothing: () => Promise.resolve(),
          onConflictDoUpdate: () => Promise.resolve(),
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

describe("syncSessions — unfiltered structured session upsert", () => {
  const runSession = (svc: HealthSyncService, key: string) =>
    (
      svc as unknown as { syncSessions: (c: unknown, cfg: unknown) => Promise<number> }
    ).syncSessions(
      activeConn(),
      SESSION_CONFIGS.find((c) => c.key === key)
    );

  it("parses workouts and upserts them into health_samples", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
    const point = {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      exercise: {
        interval: { startTime: "2026-07-11T09:30:00Z" },
        exerciseType: "BIKING",
        displayName: "자전거",
        activeDuration: "660s",
      },
    };
    const svc = withAdapter(new HealthSyncService(db), {
      listDataPoints: vi.fn().mockResolvedValue({ dataPoints: [point] }), // no nextPageToken → one page
    });
    expect(await runSession(svc, "exercise")).toBe(1);
    const ins = rec.inserts.find((i) => i.table === healthSamples);
    expect(ins).toBeDefined();
    const row = (ins!.values as Array<Record<string, unknown>>)[0];
    expect(row.metric).toBe("exercise");
    expect(row.value).toBe(11); // 660s → 11 min
    expect((row.valueJson as { displayName?: string }).displayName).toBe("자전거");
  });

  // Sleep rides the same unfiltered path (its `list` filter 400s like exercise's),
  // but its duration comes from the interval and its stages must survive intact.
  it("parses sleep nights, keeping stages in valueJson", async () => {
    const { db, rec } = fakeDb({ connectionRows: [activeConn()] });
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
    expect(await runSession(svc, "sleep")).toBe(1);
    // Unfiltered read: sleep rejects every time filter, so none may be sent.
    expect(listDataPoints.mock.calls[0][0].filter).toBe("");
    const ins = rec.inserts.find((i) => i.table === healthSamples);
    expect(ins).toBeDefined();
    const row = (ins!.values as Array<Record<string, unknown>>)[0];
    expect(row.metric).toBe("sleep");
    expect(row.value).toBe(172);
    expect((row.valueJson as { stages?: unknown[] }).stages).toHaveLength(1);
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

beforeEach(() => {
  vi.clearAllMocks();
});
