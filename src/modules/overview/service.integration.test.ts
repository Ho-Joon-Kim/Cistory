import { describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { type PeriodDomainEnvelope, periodSnapshots } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { invalidateRecoveredPeriods } from "@/modules/data-status/recovery";
import { createDatabaseOverviewStore, createOverviewService } from "./service";

const COMPUTED_AT = "2026-11-09T00:00:00.000Z";

function envelope(data: unknown): PeriodDomainEnvelope {
  return { status: "ready", computedAt: COMPUTED_AT, computeVersion: 5, errorCode: null, data };
}

// Stale-while-revalidate depends on every write path that re-queues a snapshot
// leaving its envelopes in place. Pin that against the real UPDATE/UPSERTs.
describe("overview stale snapshots against PostgreSQL", () => {
  const harness = useTransactionalDb();

  async function readyMonth(periodKey: string) {
    const db = harness.db();
    const userId = await insertTestUser(db);
    await db.insert(periodSnapshots).values({
      userId,
      periodType: "month",
      periodKey,
      status: "ready",
      computeVersion: 5,
      coding: envelope({ totalCommits: 42 }),
      spending: envelope({ netSpend: 1000 }),
      updatedAt: new Date(COMPUTED_AT),
    });
    return userId;
  }

  it("keeps serving the last computed data after a recovery invalidation", async () => {
    const db = harness.db() as unknown as Database;
    const userId = await readyMonth("2026-10");

    await invalidateRecoveredPeriods(
      db,
      userId,
      "2026-10-05",
      "2026-10-06",
      new Date("2026-11-10T01:00:00Z"),
      { narratives: false }
    );

    const response = await createOverviewService(createDatabaseOverviewStore(db)).getSnapshot(
      userId,
      "month",
      "2026-10"
    );
    expect(response).toMatchObject({
      status: "pending",
      stale: true,
      computedAt: COMPUTED_AT,
      domains: {
        coding: { data: { totalCommits: 42 } },
        spending: { data: { netSpend: 1000 } },
        location: null,
      },
    });
  });

  it("keeps the last computed data when a user requests a recompute", async () => {
    const db = harness.db() as unknown as Database;
    const userId = await readyMonth("2026-09");
    const service = createOverviewService(createDatabaseOverviewStore(db));

    await service.requestRecompute(userId, "month", "2026-09", new Date("2026-11-10T01:00:00Z"));

    await expect(service.getSnapshot(userId, "month", "2026-09")).resolves.toMatchObject({
      status: "pending",
      stale: true,
      domains: { coding: { data: { totalCommits: 42 } } },
    });
  });
});
