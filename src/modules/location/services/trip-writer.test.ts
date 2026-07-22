import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { DetectedTrip } from "./trip-detector";
import {
  planTripReconciliation,
  reconcileDetectedTrips,
  regenerateDetectedTrips,
} from "./trip-writer";

const candidate = (
  startDate: string,
  endDate: string,
  name = `${startDate} trip`
): DetectedTrip => ({
  name,
  startDate,
  endDate,
  visitedCities: [],
  visitedCountries: [],
  isOverseas: false,
  totalDistanceMeters: null,
});

describe("planTripReconciliation", () => {
  it("replaces an overlapping shorter auto trip with the expanded candidate", () => {
    const result = planTripReconciliation(
      [
        {
          id: "auto-short",
          startDate: "2026-07-16",
          endDate: "2026-07-17",
          autoDetected: true,
        },
      ],
      [candidate("2026-07-15", "2026-07-18")],
      false
    );

    expect(result.deleteAutoIds).toEqual(["auto-short"]);
    expect(result.acceptedCandidates).toEqual([
      expect.objectContaining({ startDate: "2026-07-15", endDate: "2026-07-18" }),
    ]);
  });

  it("preserves manual trips and skips candidates that overlap them", () => {
    const result = planTripReconciliation(
      [
        {
          id: "manual",
          startDate: "2026-07-10",
          endDate: "2026-07-20",
          autoDetected: false,
        },
      ],
      [candidate("2026-07-15", "2026-07-18")],
      false
    );

    expect(result).toMatchObject({
      deleteAutoIds: [],
      acceptedCandidates: [],
      manualSkipped: 1,
    });
  });

  it("full regeneration deletes every auto row but never a manual row", () => {
    const result = planTripReconciliation(
      [
        { id: "auto-a", startDate: "2025-03-08", endDate: "2025-03-10", autoDetected: true },
        { id: "manual", startDate: "2025-04-01", endDate: "2025-04-03", autoDetected: false },
        { id: "auto-b", startDate: "2026-01-01", endDate: "2026-01-03", autoDetected: true },
      ],
      [candidate("2025-05-01", "2025-05-03")],
      true
    );

    expect(result.deleteAutoIds).toEqual(["auto-a", "auto-b"]);
    expect(result.acceptedCandidates).toHaveLength(1);
  });
});

function fakeDatabase(options: { failInsert?: boolean } = {}) {
  const events: string[] = [];
  const insertedRows: unknown[] = [];
  const existingRows = [
    { id: "auto-short", startDate: "2026-07-16", endDate: "2026-07-17", autoDetected: true },
  ];

  const tx = {
    execute: vi.fn(async () => {
      events.push("lock");
      return { rows: [] };
    }),
    select: vi.fn(() => ({
      from: () => ({
        where: async () => {
          events.push("select");
          return existingRows;
        },
      }),
    })),
    delete: vi.fn(() => ({
      where: async () => {
        events.push("delete");
        return { rowCount: 1 };
      },
    })),
    insert: vi.fn(() => ({
      values: async (rows: unknown[]) => {
        events.push("insert");
        if (options.failInsert) throw new Error("insert failed");
        insertedRows.push(...rows);
      },
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: async () => {
          events.push("watermark");
        },
      }),
    })),
  };
  const db = {
    transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) => {
      events.push("begin");
      try {
        const result = await operation(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    }),
  } as unknown as Database;

  return { db, events, insertedRows };
}

describe("trip write transaction", () => {
  it("locks before re-reading state and advances the watermark in the same transaction", async () => {
    const fake = fakeDatabase();

    const result = await reconcileDetectedTrips("user-1", [candidate("2026-07-15", "2026-07-18")], {
      watermarkThrough: "2026-07-22",
      database: fake.db,
    });

    expect(result).toMatchObject({ inserted: 1, replaced: 1, skipped: 0 });
    expect(fake.events).toEqual([
      "begin",
      "lock",
      "select",
      "delete",
      "insert",
      "watermark",
      "commit",
    ]);
    expect(fake.insertedRows).toEqual([
      expect.objectContaining({ userId: "user-1", autoDetected: true }),
    ]);
  });

  it("propagates an insertion failure so the transaction rolls back", async () => {
    const fake = fakeDatabase({ failInsert: true });

    await expect(
      regenerateDetectedTrips("user-1", [candidate("2026-07-15", "2026-07-18")], fake.db)
    ).rejects.toThrow("insert failed");

    expect(fake.events.at(-1)).toBe("rollback");
    expect(fake.events).not.toContain("commit");
    expect(fake.events).not.toContain("watermark");
  });

  it("advances a successful watermark even when no trip is detected", async () => {
    const fake = fakeDatabase();

    const result = await reconcileDetectedTrips("user-1", [], {
      watermarkThrough: "2026-07-22",
      database: fake.db,
    });

    expect(result.inserted).toBe(0);
    expect(fake.events).toEqual(["begin", "lock", "select", "watermark", "commit"]);
  });

  it("serializes concurrent reconciliations so the final state has no duplicate", async () => {
    let rows: Array<{
      id: string;
      startDate: string;
      endDate: string;
      autoDetected: boolean;
    }> = [];
    let nextId = 1;
    let lockTail = Promise.resolve();
    const database = {
      transaction: async (operation: (tx: Record<string, unknown>) => Promise<unknown>) => {
        let releaseLock = () => {};
        const previous = lockTail;
        lockTail = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        const tx = {
          execute: async () => {
            await previous;
            return { rows: [] };
          },
          select: () => ({ from: () => ({ where: async () => rows.map((row) => ({ ...row })) }) }),
          delete: () => ({
            where: async () => {
              rows = rows.filter((row) => !row.autoDetected);
              return { rowCount: 1 };
            },
          }),
          insert: () => ({
            values: async (values: Array<{ startDate: string; endDate: string }>) => {
              rows.push(
                ...values.map((value) => ({
                  id: `new-${nextId++}`,
                  startDate: value.startDate,
                  endDate: value.endDate,
                  autoDetected: true,
                }))
              );
            },
          }),
          update: () => ({ set: () => ({ where: async () => ({ rowCount: 1 }) }) }),
        };
        try {
          return await operation(tx);
        } finally {
          releaseLock();
        }
      },
    } as unknown as Database;

    await Promise.all([
      reconcileDetectedTrips("user-1", [candidate("2026-07-15", "2026-07-18")], {
        database,
      }),
      reconcileDetectedTrips("user-1", [candidate("2026-07-15", "2026-07-18")], {
        database,
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startDate: "2026-07-15", endDate: "2026-07-18" });
  });
});
