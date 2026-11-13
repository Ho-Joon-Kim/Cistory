import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import {
  createSavedPlace,
  deleteSavedPlace,
  parseSavedPlaceCreate,
  parseSavedPlaceUpdate,
  updateSavedPlace,
} from "./saved-places";

describe("parse helpers", () => {
  it("normalizes a create body", () => {
    expect(parseSavedPlaceCreate({ name: " 집 ", lat: 1, lon: 2, radiusM: 10 })).toEqual({
      value: { name: "집", lat: 1, lon: 2, radiusM: 50, category: null, address: null },
    });
    expect(parseSavedPlaceCreate({ name: "x" })).toEqual({ error: "위도와 경도가 필요합니다" });
  });

  it("rejects an empty update", () => {
    expect(parseSavedPlaceUpdate({})).toEqual({ error: "수정할 항목이 없습니다" });
    expect(parseSavedPlaceUpdate({ tripExclusionRadiusM: null })).toEqual({
      value: { tripExclusionRadiusM: null },
    });
  });
});

describe("saved place writes", () => {
  const input = { name: "집", lat: 1, lon: 2, radiusM: 100, category: null, address: null };

  it("runs inTx after the insert with before=null", async () => {
    const fake = createMockDb([[{ id: "p1", ...input }]]);
    const inTx = vi.fn(async () => {});
    const place = await createSavedPlace("user-1", input, { inTx, database: fake.db });
    expect(place.id).toBe("p1");
    expect(inTx).toHaveBeenCalledWith(fake.db, { before: null, after: place });
    expect(fake.writes("values")[0]).toMatchObject({ userId: "user-1" });
  });

  it("propagates an inTx failure so the transaction rolls back", async () => {
    const fake = createMockDb([[{ id: "p1" }]]);
    await expect(
      createSavedPlace("user-1", input, {
        database: fake.db,
        inTx: async () => {
          throw new Error("revoked");
        },
      })
    ).rejects.toThrow("revoked");
  });

  it("passes before and after to inTx on update, scoped to the user", async () => {
    const before = { id: "p1", name: "old" };
    const after = { id: "p1", name: "new" };
    const fake = createMockDb([[], [before], [after]]);
    const inTx = vi.fn(async () => {});
    const result = await updateSavedPlace(
      "user-1",
      "p1",
      { name: "new" },
      { inTx, database: fake.db }
    );
    expect(result).toEqual(after);
    expect(inTx).toHaveBeenCalledWith(fake.db, { before, after });
    expect(fake.whereParams()).toEqual([
      ["p1", "user-1"],
      ["p1", "user-1"],
    ]);
  });

  it("returns null without calling inTx when the place is missing", async () => {
    const fake = createMockDb([[], []]);
    const inTx = vi.fn(async () => {});
    expect(await updateSavedPlace("user-1", "p1", { name: "x" }, { inTx, database: fake.db })).toBe(
      null
    );
    expect(await deleteSavedPlace("user-1", "p1", { inTx, database: createMockDb().db })).toBe(
      null
    );
    expect(inTx).not.toHaveBeenCalled();
  });

  it("passes the deleted row as before on delete", async () => {
    const row = { id: "p1" };
    const fake = createMockDb([[], [row]]);
    const inTx = vi.fn(async () => {});
    await deleteSavedPlace("user-1", "p1", { inTx, database: fake.db });
    expect(inTx).toHaveBeenCalledWith(fake.db, { before: row, after: null });
  });
});
