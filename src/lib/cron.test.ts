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
  // toss reparse collaborator
  reparseNotifications: vi.fn(),
  // db state, set per-test
  dbUsers: [] as Record<string, unknown>[],
  dbExecRows: [] as Record<string, unknown>[],
  dbExecRowBatches: [] as Record<string, unknown>[][],
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual, // keep real `users`/`syncJobs` columns — the sql`` templates reference them
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => Promise.resolve(m.dbUsers) }) }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      execute: () => Promise.resolve({ rows: m.dbExecRowBatches.shift() ?? m.dbExecRows }),
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
vi.mock("@/modules/transaction/reparse-service", () => ({
  reparseNotifications: m.reparseNotifications,
}));

import {
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
  it("runs location before trip detection and continues after an earlier failure", async () => {
    const calls: string[] = [];

    await runBootCatchUp({
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

    expect(calls).toEqual(["sync", "spending", "location", "trips", "subway"]);
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
  it("runs the per-day pipeline and subway steps for an OwnTracks user", async () => {
    m.dbUsers = [{ id: "u1" }];
    await processYesterdayLocations("test");

    expect(m.runAnomalyDetectionForDay).toHaveBeenCalledWith("u1", DATE_STR);
    expect(m.detectAndPersistVisits).toHaveBeenCalledWith("u1", DATE_STR);
    expect(m.detectAndPersistTracks).toHaveBeenCalledWith("u1", DATE_STR);
    expect(m.matchSubwayTrips).toHaveBeenCalledWith("u1", DATE_STR);
    // legsInserted is 0, so transfer grouping is correctly skipped.
    expect(m.groupMatchesIntoSessions).not.toHaveBeenCalled();
    expect(m.discoverMissingSubwayCities).toHaveBeenCalledWith("u1");
  });

  it("groups subway transfers when a day has matched legs", async () => {
    m.matchSubwayTrips.mockResolvedValue({ legsInserted: 2 });
    m.dbUsers = [{ id: "u1" }];
    await processYesterdayLocations("test");

    expect(m.groupMatchesIntoSessions).toHaveBeenCalledWith("u1", DATE_STR);
  });

  it("skips when no users have OwnTracks configured", async () => {
    m.dbUsers = [];
    await processYesterdayLocations("test");

    expect(m.runAnomalyDetectionForDay).not.toHaveBeenCalled();
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
