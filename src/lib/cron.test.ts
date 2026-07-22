import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Cron smoke: call the exported job bodies directly (the cron.schedule
// registrations themselves are out of scope) and assert they wire the right
// services with the right call-shape. Every collaborator is mocked — no DB, no
// network, no real adapters — so this proves "the job calls the right things in
// the right shape", not "the things work". vi.hoisted holds the spies so the
// vi.mock factories (hoisted above imports) can close over them.
const m = vi.hoisted(() => ({
  // sync job collaborators
  reviveStaleProcessing: vi.fn(),
  initialSync: vi.fn(),
  syncUserCommits: vi.fn(),
  processPendingSummaries: vi.fn(),
  syncUser: vi.fn(),
  hasActiveAccounts: vi.fn(),
  syncUserAccounts: vi.fn(),
  backfillPendingAccounts: vi.fn(),
  withingsSyncUser: vi.fn(),
  healthSyncUser: vi.fn(),
  healthBackfill: vi.fn(),
  maybeRefreshDataUsage: vi.fn(),
  getGitHubToken: vi.fn(),
  // location pipeline collaborators
  runAnomalyDetectionForDay: vi.fn(),
  detectAndPersistVisits: vi.fn(),
  detectAndPersistTracks: vi.fn(),
  matchSubwayTrips: vi.fn(),
  groupMatchesIntoSessions: vi.fn(),
  discoverMissingSubwayCities: vi.fn(),
  detectAndPersistTrips: vi.fn(),
  rebuildDailyLocationHeatmap: vi.fn(),
  runOverviewPrecompute: vi.fn(),
  processNarrativeBatch: vi.fn(),
  // toss reparse collaborator
  reparseNotifications: vi.fn(),
  // db state, set per-test
  dbUsers: [] as Record<string, unknown>[],
  dbExecRows: [] as Record<string, unknown>[],
  dbExecRowBatches: [] as Record<string, unknown>[][],
  dbExecQueries: [] as SQL[],
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual, // keep real `users`/`syncJobs` columns — the sql`` templates reference them
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => Promise.resolve(m.dbUsers) }) }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      execute: (query: SQL) => {
        m.dbExecQueries.push(query);
        return Promise.resolve({ rows: m.dbExecRowBatches.shift() ?? m.dbExecRows });
      },
    }),
  };
});

vi.mock("@/lib/auth-helpers", () => ({ getGitHubToken: m.getGitHubToken }));
vi.mock("@/lib/data-usage", () => ({ maybeRefreshDataUsage: m.maybeRefreshDataUsage }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));
vi.mock("@/modules/summary/service", () => ({
  createSummaryService: vi.fn(() => ({ processPendingSummaries: m.processPendingSummaries })),
  SummaryService: { reviveStaleProcessing: m.reviveStaleProcessing },
}));
vi.mock("@/modules/sync/service", () => ({
  createSyncService: vi.fn(() => ({
    initialSync: m.initialSync,
    syncUserCommits: m.syncUserCommits,
  })),
}));
vi.mock("@/modules/wakatime/service", () => ({
  createWakaTimeSyncService: vi.fn(() => ({ syncUser: m.syncUser })),
}));
vi.mock("@/modules/portfolio/service", () => ({
  createPortfolioSyncService: vi.fn(() => ({
    hasActiveAccounts: m.hasActiveAccounts,
    syncUserAccounts: m.syncUserAccounts,
    backfillPendingAccounts: m.backfillPendingAccounts,
  })),
}));
vi.mock("@/modules/withings/service", () => ({
  createWithingsSyncService: vi.fn(() => ({ syncUser: m.withingsSyncUser })),
}));
vi.mock("@/modules/health/service", () => ({
  createHealthSyncService: vi.fn(() => ({
    syncUser: m.healthSyncUser,
    backfillPendingConnections: m.healthBackfill,
  })),
}));
vi.mock("@/modules/subway/service", () => ({
  refreshAllSubwaySystems: vi.fn(),
  seedSubwaySystemsIfEmpty: vi.fn(),
}));
vi.mock("@/modules/location/services/anomaly-filter", () => ({
  runAnomalyDetectionForDay: m.runAnomalyDetectionForDay,
}));
vi.mock("@/modules/location/services/visit-persister", () => ({
  detectAndPersistVisits: m.detectAndPersistVisits,
}));
vi.mock("@/modules/location/services/track-persister", () => ({
  detectAndPersistTracks: m.detectAndPersistTracks,
}));
vi.mock("@/modules/location/services/subway-match/matcher", () => ({
  matchSubwayTrips: m.matchSubwayTrips,
}));
vi.mock("@/modules/location/services/subway-match/session-grouper", () => ({
  groupMatchesIntoSessions: m.groupMatchesIntoSessions,
}));
vi.mock("@/modules/location/services/subway-discovery", () => ({
  discoverMissingSubwayCities: m.discoverMissingSubwayCities,
}));
vi.mock("@/modules/location/services/trip-detector", () => ({
  detectAndPersistTrips: m.detectAndPersistTrips,
}));
vi.mock("@/modules/overview/aggregate/location", () => ({
  rebuildDailyLocationHeatmap: m.rebuildDailyLocationHeatmap,
}));
vi.mock("@/modules/overview/precompute", () => ({
  runOverviewPrecompute: m.runOverviewPrecompute,
}));
vi.mock("@/modules/overview/narrative", () => ({
  createDatabaseNarrativeStore: vi.fn(() => ({})),
  createNarrativeService: vi.fn(() => ({ processAutoBatch: m.processNarrativeBatch })),
}));
vi.mock("@/lib/adapters/ai/claude", () => ({
  createClaudeAdapter: vi.fn(() => ({ generateText: vi.fn() })),
}));
vi.mock("@/modules/transaction/reparse-service", () => ({
  reparseNotifications: m.reparseNotifications,
}));

import {
  createBootCatchUpJobs,
  generateOverviewNarratives,
  processYesterdayLocations,
  reparseTodayNotifications,
  runBootCatchUp,
  runTripDetection,
  syncAllUsers,
} from "./cron";

const DATE_STR = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

function syncUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    githubLogin: "octocat",
    syncIntervalHours: 1,
    lastSyncedAt: null,
    initialSyncCompleted: true,
    wakatimeApiKey: null,
    wakatimeLastSyncedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.dbUsers = [];
  m.dbExecRows = [];
  m.dbExecRowBatches = [];
  m.dbExecQueries = [];
  m.getGitHubToken.mockResolvedValue("gh-token");
  m.processPendingSummaries.mockResolvedValue(0);
  m.hasActiveAccounts.mockResolvedValue(false);
  m.syncUserAccounts.mockResolvedValue([]);
  m.backfillPendingAccounts.mockResolvedValue([]);
  m.withingsSyncUser.mockResolvedValue({ userId: "u1", measurementsUpserted: 0, skipped: true });
  m.healthSyncUser.mockResolvedValue({ userId: "u1", samplesUpserted: 0, skipped: true });
  m.healthBackfill.mockResolvedValue({ userId: "u1", samplesUpserted: 0, skipped: true });
  m.runAnomalyDetectionForDay.mockResolvedValue({ total: 0 });
  m.detectAndPersistVisits.mockResolvedValue([]);
  m.detectAndPersistTracks.mockResolvedValue({ trackCount: 0, segmentCount: 0 });
  m.matchSubwayTrips.mockResolvedValue({ legsInserted: 0 });
  m.groupMatchesIntoSessions.mockResolvedValue({ multiLegSessions: 0 });
  m.discoverMissingSubwayCities.mockResolvedValue(undefined);
  m.detectAndPersistTrips.mockResolvedValue({
    detected: 0,
    inserted: 0,
    replaced: 0,
    skipped: 0,
  });
  m.rebuildDailyLocationHeatmap.mockResolvedValue(undefined);
  m.runOverviewPrecompute.mockResolvedValue({
    skipped: false,
    published: 0,
    failed: 0,
  });
  m.processNarrativeBatch.mockResolvedValue({ claimed: 0, generated: 0, failed: 0 });
  m.reparseNotifications.mockResolvedValue({ created: 0, updated: 0, skipped: 0 });
});

describe("runTripDetection", () => {
  it("catches up from the durable watermark with a two-day lookbehind", async () => {
    m.dbUsers = [{ id: "u1", tripDetectionLastThrough: "2026-06-30" }];

    await runTripDetection("test");

    expect(m.detectAndPersistTrips).toHaveBeenCalledWith("u1", "2026-06-28", DATE_STR, {
      watermarkThrough: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const call = m.detectAndPersistTrips.mock.calls[0];
    expect(call[2]).toBe(call[3].watermarkThrough);
  });

  it("uses the full-history baseline when no watermark exists", async () => {
    m.dbUsers = [{ id: "u1", tripDetectionLastThrough: null }];

    await runTripDetection("test");

    expect(m.detectAndPersistTrips).toHaveBeenCalledWith(
      "u1",
      "2025-03-08",
      DATE_STR,
      expect.objectContaining({ watermarkThrough: expect.any(String) })
    );
  });

  it("single-flights overlapping cron and boot invocations", async () => {
    let release: (() => void) | undefined;
    m.dbUsers = [{ id: "u1", tripDetectionLastThrough: null }];
    m.detectAndPersistTrips.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ detected: 0, inserted: 0, replaced: 0, skipped: 0 });
        })
    );

    const first = runTripDetection("weekly");
    await vi.waitFor(() => expect(m.detectAndPersistTrips).toHaveBeenCalledOnce());
    await runTripDetection("boot");
    expect(m.detectAndPersistTrips).toHaveBeenCalledOnce();
    release?.();
    await first;
  });

  it("keeps a long ongoing auto trip whole across consecutive runs", async () => {
    m.dbUsers = [{ id: "u1", tripDetectionLastThrough: "2026-06-30" }];
    m.dbExecRowBatches = [
      [{ start_date: "2026-06-24" }],
      [{ start_date: "2026-06-20" }],
      [],
      [{ start_date: "2026-06-20" }],
      [],
    ];

    await runTripDetection("first-week");
    m.dbUsers = [{ id: "u1", tripDetectionLastThrough: "2026-07-07" }];
    await runTripDetection("second-week");

    expect(m.detectAndPersistTrips).toHaveBeenNthCalledWith(
      1,
      "u1",
      "2026-06-20",
      DATE_STR,
      expect.objectContaining({ watermarkThrough: expect.any(String) })
    );
    expect(m.detectAndPersistTrips).toHaveBeenNthCalledWith(
      2,
      "u1",
      "2026-06-20",
      DATE_STR,
      expect.objectContaining({ watermarkThrough: expect.any(String) })
    );
  });
});

describe("runBootCatchUp", () => {
  it("wires overview precompute into the production boot jobs", async () => {
    await createBootCatchUpJobs().overview();

    expect(m.runOverviewPrecompute).toHaveBeenCalledWith(expect.anything(), {
      completedLocationWindows: [],
    });
  });

  it("runs an overview batch before slower catch-up jobs and continues after a failure", async () => {
    const calls: string[] = [];

    await runBootCatchUp({
      overview: async () => {
        calls.push("overview");
      },
      sync: async () => {
        calls.push("sync");
        throw new Error("sync failed");
      },
      spending: async () => {
        calls.push("spending");
      },
      location: async () => {
        calls.push("location");
      },
      trips: async () => {
        calls.push("trips");
      },
      subway: async () => {
        calls.push("subway");
      },
    });

    expect(calls).toEqual(["overview", "sync", "spending", "location", "trips", "subway"]);
  });
});

describe("syncAllUsers", () => {
  it("revives stale summaries then incremental-syncs a due, initialized user", async () => {
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    expect(m.reviveStaleProcessing).toHaveBeenCalledOnce();
    // ANTHROPIC_API_KEY is set by vitest.config.mts, so summaries are processed.
    expect(m.syncUserCommits).toHaveBeenCalledWith("u1", "octocat", "scheduled");
    expect(m.initialSync).not.toHaveBeenCalled();
    expect(m.processPendingSummaries).toHaveBeenCalledWith(20, undefined, "u1");
  });

  it("runs initial sync for an uninitialized user instead of incremental", async () => {
    m.dbUsers = [syncUser({ initialSyncCompleted: false })];
    await syncAllUsers();

    expect(m.initialSync).toHaveBeenCalledWith("u1", "octocat");
    expect(m.syncUserCommits).not.toHaveBeenCalled();
  });

  it("skips portfolio sync when the user has no active accounts", async () => {
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    expect(m.hasActiveAccounts).toHaveBeenCalledWith("u1");
    expect(m.syncUserAccounts).not.toHaveBeenCalled();
    expect(m.backfillPendingAccounts).not.toHaveBeenCalled();
  });

  it("syncs and backfills portfolio when the user has active accounts", async () => {
    m.hasActiveAccounts.mockResolvedValue(true);
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    expect(m.syncUserAccounts).toHaveBeenCalledWith("u1", {
      skipIfSyncedWithinMs: 24 * 60 * 60 * 1000,
    });
    expect(m.backfillPendingAccounts).toHaveBeenCalledWith("u1");
  });

  it("syncs Withings body data for each user behind the 24h gate", async () => {
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    // syncUser self-skips when there's no active connection, so the cron calls it
    // unconditionally with the 24h gate rather than pre-checking.
    expect(m.withingsSyncUser).toHaveBeenCalledWith("u1", {
      skipIfSyncedWithinMs: 24 * 60 * 60 * 1000,
    });
  });

  it("syncs Google Health behind the 24h gate, then progresses backfill", async () => {
    m.healthSyncUser.mockResolvedValue({ userId: "u1", samplesUpserted: 3, skipped: false });
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    expect(m.healthSyncUser).toHaveBeenCalledWith("u1", {
      skipIfSyncedWithinMs: 24 * 60 * 60 * 1000,
    });
    expect(m.healthBackfill).toHaveBeenCalledWith("u1");
  });

  it("still progresses backfill even when the forward sync self-skipped (24h gate)", async () => {
    // Backfill is decoupled from the forward-sync gate so a fresh connection's
    // all-time import advances every tick; backfillPendingConnections self-skips
    // internally once complete or idle.
    m.healthSyncUser.mockResolvedValue({ userId: "u1", samplesUpserted: 0, skipped: true });
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    expect(m.healthBackfill).toHaveBeenCalledWith("u1");
  });

  it("isolates a health sync failure — other integrations still run", async () => {
    m.healthSyncUser.mockRejectedValue(new Error("google health 500"));
    m.dbUsers = [syncUser()];
    await syncAllUsers();

    // The health block throws, but the surrounding per-user loop continues:
    // Withings (earlier) and the data-usage refresh (later) still fire.
    expect(m.withingsSyncUser).toHaveBeenCalled();
    expect(m.maybeRefreshDataUsage).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("exits without syncing when no users have a GitHub token", async () => {
    m.dbUsers = [];
    await syncAllUsers();

    expect(m.reviveStaleProcessing).toHaveBeenCalledOnce(); // runs before the user query
    expect(m.syncUserCommits).not.toHaveBeenCalled();
  });
});

describe("processYesterdayLocations", () => {
  const locationUser = (id: string) => ({ id, ownTracksApiKey: "owntracks-key" });

  it("runs the per-day pipeline and subway steps for an OwnTracks user", async () => {
    m.dbExecRows = [{ d: "2026-07-22" }];
    m.dbUsers = [locationUser("u1")];
    const result = await processYesterdayLocations("test");

    expect(m.runAnomalyDetectionForDay).toHaveBeenCalledWith("u1", DATE_STR);
    expect(m.detectAndPersistVisits).toHaveBeenCalledWith("u1", DATE_STR);
    expect(m.detectAndPersistTracks).toHaveBeenCalledWith("u1", DATE_STR);
    expect(m.rebuildDailyLocationHeatmap).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "2026-07-22",
      expect.any(Date)
    );
    expect(m.matchSubwayTrips).toHaveBeenCalledWith("u1", DATE_STR);
    // legsInserted is 0, so transfer grouping is correctly skipped.
    expect(m.groupMatchesIntoSessions).not.toHaveBeenCalled();
    expect(m.discoverMissingSubwayCities).toHaveBeenCalledWith("u1");
    expect(result.completedLocationWindows).toEqual([
      { userId: "u1", completedThrough: "2026-07-22" },
    ]);
    expect(m.runOverviewPrecompute).toHaveBeenCalledWith(expect.anything(), {
      completedLocationWindows: [{ userId: "u1", completedThrough: "2026-07-22" }],
    });
    expect(m.processNarrativeBatch).toHaveBeenCalledOnce();
    const statements = m.dbExecQueries.map((query) => new PgDialect().sqlToQuery(query).sql);
    expect(statements[0]).toContain("location_processing_days");
    expect(statements.some((statement) => /status.*processing/s.test(statement))).toBe(true);
    expect(statements.some((statement) => /status.*completed/s.test(statement))).toBe(true);
  });

  it("groups subway transfers when a day has matched legs", async () => {
    m.dbExecRows = [{ d: "2026-07-22" }];
    m.matchSubwayTrips.mockResolvedValue({ legsInserted: 2 });
    m.dbUsers = [locationUser("u1")];
    await processYesterdayLocations("test");

    expect(m.groupMatchesIntoSessions).toHaveBeenCalledWith("u1", DATE_STR);
  });

  it("skips core processing when there are no users", async () => {
    m.dbUsers = [];
    await processYesterdayLocations("test");

    expect(m.runAnomalyDetectionForDay).not.toHaveBeenCalled();
    expect(m.runOverviewPrecompute).toHaveBeenCalledWith(expect.anything(), {
      completedLocationWindows: [],
    });
  });

  it("allows finalization for a user without OwnTracks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
    m.dbUsers = [{ id: "no-location", ownTracksApiKey: null }];

    const result = await processYesterdayLocations("test");

    vi.useRealTimers();
    expect(result.completedLocationWindows).toEqual([
      { userId: "no-location", completedThrough: "2026-07-22" },
    ]);
    expect(m.runAnomalyDetectionForDay).not.toHaveBeenCalled();
  });

  it("returns a no-work watermark when an OwnTracks user has no candidate dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
    m.dbUsers = [locationUser("empty-location")];
    m.dbExecRows = [];

    const result = await processYesterdayLocations("test");

    vi.useRealTimers();
    expect(result.completedLocationWindows).toEqual([
      { userId: "empty-location", completedThrough: "2026-07-22" },
    ]);
    expect(m.runAnomalyDetectionForDay).not.toHaveBeenCalled();
  });

  it("keeps completed results when overview precompute fails", async () => {
    m.dbUsers = [locationUser("u1")];
    m.dbExecRows = [{ d: "2026-07-22" }];
    m.runOverviewPrecompute.mockRejectedValueOnce(new Error("overview failed"));

    const result = await processYesterdayLocations("test");

    expect(result.completedLocationWindows).toEqual([
      { userId: "u1", completedThrough: "2026-07-22" },
    ]);
  });

  it("does not hold the location pipeline open for narrative AI latency", async () => {
    let finishNarrative:
      | ((value: { claimed: number; generated: number; failed: number }) => void)
      | null = null;
    m.processNarrativeBatch.mockReturnValue(
      new Promise((resolve) => {
        finishNarrative = resolve;
      })
    );
    m.dbUsers = [];

    await expect(processYesterdayLocations("test")).resolves.toMatchObject({ skipped: false });
    expect(m.processNarrativeBatch).toHaveBeenCalledOnce();
    finishNarrative?.({ claimed: 0, generated: 0, failed: 0 });
  });

  it("includes today in the bounded KST candidate query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
    m.dbUsers = [locationUser("u1")];
    m.dbExecRows = [{ d: "2026-07-22" }];

    await processYesterdayLocations("test");

    vi.useRealTimers();
    expect(m.runAnomalyDetectionForDay).toHaveBeenCalledWith("u1", "2026-07-22");
    const statement = new PgDialect().sqlToQuery(m.dbExecQueries[0]);
    expect(statement.sql).toContain("interval '45 days'");
    expect(statement.sql).toContain("LIMIT 30");
    expect(statement.sql).toMatch(/<=/);
  });

  it("reprocesses the same day through replace-in-window stages without duplicate completion", async () => {
    m.dbUsers = [locationUser("u1")];
    m.dbExecRows = [{ d: "2026-07-22" }];

    const first = await processYesterdayLocations("first");
    const second = await processYesterdayLocations("second");

    expect(m.detectAndPersistVisits).toHaveBeenCalledTimes(2);
    expect(m.detectAndPersistTracks).toHaveBeenCalledTimes(2);
    expect(m.rebuildDailyLocationHeatmap).toHaveBeenCalledTimes(2);
    expect(first.completedLocationWindows).toEqual(second.completedLocationWindows);
  });

  it("does not mark a failed core stage complete and continues with the next user", async () => {
    m.dbUsers = [locationUser("u1"), locationUser("u2")];
    m.dbExecRows = [{ d: "2026-07-22" }];
    m.detectAndPersistVisits.mockRejectedValueOnce(new Error("visit failed"));

    const result = await processYesterdayLocations("test");

    expect(m.detectAndPersistTracks).not.toHaveBeenCalledWith("u1", "2026-07-22");
    expect(m.detectAndPersistTracks).toHaveBeenCalledWith("u2", "2026-07-22");
    expect(m.rebuildDailyLocationHeatmap).not.toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "2026-07-22",
      expect.any(Date)
    );
    expect(result.completedLocationWindows).toEqual([
      { userId: "u2", completedThrough: "2026-07-22" },
    ]);
    const statements = m.dbExecQueries.map((query) => new PgDialect().sqlToQuery(query).sql);
    expect(statements.some((statement) => /status.*failed/s.test(statement))).toBe(true);
  });

  it("does not advance a user watermark past a failed middle date", async () => {
    m.dbUsers = [locationUser("u1")];
    m.dbExecRows = [{ d: "2026-07-20" }, { d: "2026-07-21" }, { d: "2026-07-22" }];
    m.detectAndPersistVisits
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("middle day failed"))
      .mockResolvedValueOnce([]);

    const result = await processYesterdayLocations("test");

    expect(result.days.map((day) => [day.date, day.status])).toEqual([
      ["2026-07-20", "completed"],
      ["2026-07-21", "failed"],
      ["2026-07-22", "completed"],
    ]);
    expect(result.completedLocationWindows).toEqual([]);
    const statement = new PgDialect().sqlToQuery(m.dbExecQueries[0]);
    expect(statement.sql).toContain("location_processing_days");
    expect(statement.sql).toContain("processing_started_at");
    expect(statement.sql).toContain("interval '20 minutes'");
  });

  it("retries a post-anomaly core failure selected from its durable failed marker", async () => {
    m.dbUsers = [locationUser("retry-user")];
    m.dbExecRows = [{ d: "2026-07-10" }];
    m.detectAndPersistVisits.mockRejectedValueOnce(new Error("temporary visit failure"));

    const failed = await processYesterdayLocations("first");
    // The next DB candidate query returns the date because its durable marker
    // is failed, even though anomaly is no longer NULL after the first stage.
    m.dbExecRows = [{ d: "2026-07-10" }];
    const recovered = await processYesterdayLocations("second");

    expect(failed.completedLocationWindows).toEqual([]);
    expect(m.detectAndPersistVisits).toHaveBeenCalledWith("retry-user", "2026-07-10");
    expect(recovered.completedLocationWindows).toEqual([
      { userId: "retry-user", completedThrough: "2026-07-10" },
    ]);
    const candidateSql = new PgDialect().sqlToQuery(m.dbExecQueries[0]).sql;
    expect(candidateSql).toContain("processing.status = 'failed'");
  });
});

describe("generateOverviewNarratives", () => {
  it("runs the bounded catch-up service independently of an exact period boundary", async () => {
    m.processNarrativeBatch.mockResolvedValue({ claimed: 2, generated: 2, failed: 0 });

    await expect(generateOverviewNarratives()).resolves.toEqual({
      skipped: false,
      claimed: 2,
      generated: 2,
      failed: 0,
    });
    expect(m.processNarrativeBatch).toHaveBeenCalledWith();
  });

  it("safely skips automatic generation without an API key", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateOverviewNarratives()).resolves.toEqual({
      skipped: true,
      claimed: 0,
      generated: 0,
      failed: 0,
    });
    process.env.ANTHROPIC_API_KEY = previous;
    expect(m.processNarrativeBatch).not.toHaveBeenCalled();
  });
});

describe("reparseTodayNotifications", () => {
  it("reparses today's KST window for each Toss user", async () => {
    m.dbUsers = [{ id: "u1", githubLogin: "octocat", tossMyName: "홍길동" }];

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 28, 10, 0, 0));
    await reparseTodayNotifications();
    vi.useRealTimers();

    expect(m.reparseNotifications).toHaveBeenCalledTimes(1);
    const [, userId, opts] = m.reparseNotifications.mock.calls[0];
    expect(userId).toBe("u1");
    expect(opts).toMatchObject({ dryRun: false, tossMyName: "홍길동" });
    expect((opts.from as Date).getTime()).toBe(new Date(2026, 5, 28).getTime());
    expect((opts.to as Date).getTime()).toBe(new Date(2026, 5, 29).getTime());
  });

  it("does nothing when no users have Toss configured", async () => {
    m.dbUsers = [];
    await reparseTodayNotifications();

    expect(m.reparseNotifications).not.toHaveBeenCalled();
  });
});
