import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import { createManualTrip, deleteTrip, updateTrip } from "./service";

describe("createManualTrip", () => {
  it("inserts a manual trip under the lock and hands the row to inTx", async () => {
    const row = { id: "trip-1", name: "제주" };
    const fake = createMockDb([[], [row]]);
    const inTx = vi.fn(async () => {});
    const created = await createManualTrip(
      "user-1",
      { name: "제주", startDate: "2026-11-01", endDate: "2026-11-02" },
      { inTx, database: fake.db }
    );
    expect(created).toEqual(row);
    expect(fake.calls[0].op).toBe("execute");
    expect(fake.executeParams()[0]).toEqual(["trip-write:user-1"]);
    expect(inTx).toHaveBeenCalledWith(fake.db, { before: null, after: row });
  });
});

function pendingRanges(fake: ReturnType<typeof createMockDb>) {
  return fake.calls.filter(
    (call) =>
      call.op === "update" &&
      call.chain.some(
        (step) =>
          step.method === "set" && (step.args[0] as { status?: string }).status === "pending"
      )
  );
}

describe("trip write overview invalidation", () => {
  it("re-queues the created trip's range", async () => {
    const row = { id: "trip-1", startDate: "2026-11-01", endDate: "2026-11-03" };
    const fake = createMockDb([[], [row], []]);
    await createManualTrip(
      "user-1",
      { name: "제주", startDate: "2026-11-01", endDate: "2026-11-03" },
      { database: fake.db }
    );
    expect(pendingRanges(fake)).toHaveLength(1);
    const params = fake.whereParams().at(-1) as unknown[];
    // recent keys run from the first day to 13 days past the last (their 14-day window).
    expect(params.slice(0, 3)).toEqual(["user-1", "2026-11-01", "2026-11-16"]);
  });

  it("re-queues both the old and the new range of an edited trip", async () => {
    const before = { id: "trip-1", startDate: "2026-01-10", endDate: "2026-01-12" };
    const after = { id: "trip-1", startDate: "2026-03-01", endDate: "2026-03-02" };
    const fake = createMockDb([[], [before], [after], [], []]);
    await updateTrip(
      "user-1",
      "trip-1",
      { startDate: "2026-03-01", endDate: "2026-03-02" },
      { database: fake.db }
    );
    expect(pendingRanges(fake)).toHaveLength(2);
    const [oldRange, newRange] = fake.whereParams().slice(-2) as unknown[][];
    expect(oldRange.slice(1, 3)).toEqual(["2026-01-10", "2026-01-25"]);
    expect(newRange.slice(1, 3)).toEqual(["2026-03-01", "2026-03-15"]);
  });

  it("merges overlapping old/new ranges into one re-queue", async () => {
    const before = { id: "trip-1", startDate: "2026-03-01", endDate: "2026-03-03" };
    const after = { id: "trip-1", startDate: "2026-03-02", endDate: "2026-03-05" };
    const fake = createMockDb([[], [before], [after], []]);
    await updateTrip("user-1", "trip-1", { endDate: "2026-03-05" }, { database: fake.db });
    expect(pendingRanges(fake)).toHaveLength(1);
    expect((fake.whereParams().at(-1) as unknown[]).slice(1, 3)).toEqual([
      "2026-03-01",
      "2026-03-18",
    ]);
  });
});

describe("updateTrip", () => {
  it("only sets provided fields, promotes to manual, and passes before/after", async () => {
    const before = { id: "trip-1", name: "old", autoDetected: true };
    const after = { id: "trip-1", name: "new", autoDetected: false };
    const fake = createMockDb([[], [before], [after]]);
    const inTx = vi.fn(async () => {});
    const result = await updateTrip(
      "user-1",
      "trip-1",
      { name: "new", startDate: null },
      { inTx, database: fake.db }
    );
    expect(result).toEqual(after);
    const set = fake.writes("set")[0] as Record<string, unknown>;
    expect(set).toMatchObject({ name: "new", autoDetected: false });
    expect(set).not.toHaveProperty("startDate");
    expect(set).not.toHaveProperty("notes");
    expect(inTx).toHaveBeenCalledWith(fake.db, { before, after });
    expect(fake.whereParams()).toEqual([
      ["trip-1", "user-1"],
      ["trip-1", "user-1"],
    ]);
  });

  it("returns null for a missing or foreign trip without writing", async () => {
    const fake = createMockDb([[], []]);
    const inTx = vi.fn(async () => {});
    expect(await updateTrip("user-2", "trip-1", { name: "x" }, { inTx, database: fake.db })).toBe(
      null
    );
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
    expect(inTx).not.toHaveBeenCalled();
  });

  it("clears notes when null is passed explicitly", async () => {
    const fake = createMockDb([[], [{ id: "trip-1" }], [{ id: "trip-1" }]]);
    await updateTrip("user-1", "trip-1", { notes: null }, { database: fake.db });
    expect(fake.writes("set")[0]).toMatchObject({ notes: null });
  });
});

describe("deleteTrip", () => {
  it("deletes the owner's trip under the lock, hands it to inTx and re-queues its range", async () => {
    const row = { id: "trip-1", name: "제주", startDate: "2026-11-01", endDate: "2026-11-03" };
    const fake = createMockDb([[], [row], []]);
    const inTx = vi.fn(async () => {});
    const deleted = await deleteTrip("user-1", "trip-1", { inTx, database: fake.db });
    expect(deleted).toEqual(row);
    expect(fake.executeParams()[0]).toEqual(["trip-write:user-1"]);
    expect(fake.calls[1].op).toBe("delete");
    expect(fake.whereParams()[0]).toEqual(["trip-1", "user-1"]);
    expect(inTx).toHaveBeenCalledWith(fake.db, { before: row, after: null });
    expect(pendingRanges(fake)).toHaveLength(1);
    expect((fake.whereParams().at(-1) as unknown[]).slice(0, 3)).toEqual([
      "user-1",
      "2026-11-01",
      "2026-11-16",
    ]);
  });

  it("returns null for a missing or foreign trip without invalidating", async () => {
    const fake = createMockDb([[], []]);
    const inTx = vi.fn(async () => {});
    expect(await deleteTrip("user-2", "trip-1", { inTx, database: fake.db })).toBe(null);
    expect(inTx).not.toHaveBeenCalled();
    expect(pendingRanges(fake)).toHaveLength(0);
  });
});
