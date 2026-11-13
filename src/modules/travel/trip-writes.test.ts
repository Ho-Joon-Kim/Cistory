import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import { createManualTrip, updateTrip } from "./service";

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
