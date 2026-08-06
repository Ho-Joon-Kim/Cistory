import { describe, expect, it } from "vitest";
import { type LegUpdate, planLegUpdates } from "./session-grouper";

/**
 * `subway_trip_matches` carries a unique index on
 * `(transportationSegmentId, legOrder)`. These tests simulate applying
 * `planLegUpdates`'s returned sequence step by step against an in-memory
 * "table" so we can assert the index invariant holds after *every* write,
 * not just at the end — the real bug only shows up mid-renumber.
 */

interface FakeRow {
  segmentId: string;
  legOrder: number;
  sessionId?: string;
}

function applyAndAssertNoCollision(updates: LegUpdate[], seedRows: Record<string, FakeRow>): void {
  const table = new Map<string, FakeRow>(
    Object.entries(seedRows).map(([id, row]) => [id, { ...row }])
  );

  for (const update of updates) {
    const row = table.get(update.id);
    if (!row) throw new Error(`unknown row id in update: ${update.id}`);
    row.legOrder = update.legOrder;
    if (update.sessionId !== undefined) row.sessionId = update.sessionId;

    const seen = new Map<string, string>();
    for (const [id, r] of table) {
      const key = `${r.segmentId}:${r.legOrder}`;
      const collidingId = seen.get(key);
      if (collidingId) {
        throw new Error(
          `idx_stm_segment_leg violation after update for id=${update.id}: ` +
            `"${collidingId}" and "${id}" both resolve to (segmentId=${r.segmentId}, legOrder=${r.legOrder})`
        );
      }
      seen.set(key, id);
    }
  }
}

function sequentialSessionIds() {
  let n = 0;
  return () => `session-${++n}`;
}

describe("planLegUpdates", () => {
  it("returns an empty sequence for empty input", () => {
    expect(planLegUpdates([], sequentialSessionIds())).toEqual([]);
  });

  it("keeps a single-leg-per-segment day working (common case, no regression)", () => {
    // Two sessions: one with two legs from two different segments, one with
    // a single leg. No segment contributes more than one leg to the whole day.
    const groups = [[{ id: "a" }, { id: "b" }], [{ id: "c" }]];
    const updates = planLegUpdates(groups, sequentialSessionIds());

    const seed: Record<string, FakeRow> = {
      a: { segmentId: "seg-1", legOrder: 0 },
      b: { segmentId: "seg-2", legOrder: 0 },
      c: { segmentId: "seg-3", legOrder: 0 },
    };
    expect(() => applyAndAssertNoCollision(updates, seed)).not.toThrow();

    const finalState: Record<string, { sessionId?: string; legOrder: number }> = {};
    for (const u of updates) finalState[u.id] = { sessionId: u.sessionId, legOrder: u.legOrder };
    // Only the assign-phase entries (with sessionId set) reflect final state;
    // the last write per id in the sequence is always the assign write.
    expect(finalState.a).toEqual({ sessionId: "session-1", legOrder: 0 });
    expect(finalState.b).toEqual({ sessionId: "session-1", legOrder: 1 });
    expect(finalState.c).toEqual({ sessionId: "session-2", legOrder: 0 });
  });

  it("produces a correct final state: one shared sessionId per group, legOrder 0..n-1 in group order", () => {
    const groups = [
      [{ id: "g1-a" }, { id: "g1-b" }, { id: "g1-c" }],
      [{ id: "g2-a" }],
      [{ id: "g3-a" }, { id: "g3-b" }],
    ];
    const updates = planLegUpdates(groups, sequentialSessionIds());

    // Reduce the sequence to each id's last write (the assign-phase write).
    const finalById = new Map<string, LegUpdate>();
    for (const u of updates) finalById.set(u.id, u);

    for (const group of groups) {
      const sessionIds = new Set(group.map((row) => finalById.get(row.id)?.sessionId));
      expect(sessionIds.size).toBe(1);
      expect([...sessionIds][0]).toBeDefined();
      group.forEach((row, i) => {
        expect(finalById.get(row.id)?.legOrder).toBe(i);
      });
    }

    // Park updates (no sessionId) must all precede assign updates (sessionId set).
    const firstAssignIndex = updates.findIndex((u) => u.sessionId !== undefined);
    const lastParkIndex = updates.reduce((acc, u, i) => (u.sessionId === undefined ? i : acc), -1);
    expect(firstAssignIndex).toBeGreaterThan(lastParkIndex);
  });

  it("park values are unique and never collide with matcher-assigned (0..n) values", () => {
    const groups = [
      [{ id: "a" }, { id: "b" }],
      [{ id: "c" }, { id: "d" }],
    ];
    const updates = planLegUpdates(groups, sequentialSessionIds());
    const parkLegOrders = updates.filter((u) => u.sessionId === undefined).map((u) => u.legOrder);

    expect(parkLegOrders).toHaveLength(4);
    expect(new Set(parkLegOrders).size).toBe(4);
    for (const legOrder of parkLegOrders) {
      expect(legOrder).toBeLessThan(0);
    }
  });

  it("regression: a segment split across two sessions never collides on (segmentId, legOrder) at any step", () => {
    // Reproduces the exact production shape: transportation segment "S"
    // produced two legs (leg_order 0 and 1 as inserted by the matcher). The
    // grouper's session split lands the two legs in two different session
    // groups, at positions that don't match their original leg_order:
    //   Group A = [otherLeg (segment T1), legS0 (segment S)]  -> legS0 -> position 1
    //   Group B = [legS1 (segment S), otherLeg2 (segment T2)] -> legS1 -> position 0
    // A naive single-pass renumber (old code) sets legS0's leg_order to 1
    // while legS1 (segment S) still holds its original leg_order = 1,
    // tripping idx_stm_segment_leg mid-renumber.
    const groups = [
      [{ id: "otherLeg-t1" }, { id: "legS0" }],
      [{ id: "legS1" }, { id: "otherLeg-t2" }],
    ];
    const updates = planLegUpdates(groups, sequentialSessionIds());

    const seed: Record<string, FakeRow> = {
      "otherLeg-t1": { segmentId: "T1", legOrder: 0 },
      legS0: { segmentId: "S", legOrder: 0 },
      legS1: { segmentId: "S", legOrder: 1 },
      "otherLeg-t2": { segmentId: "T2", legOrder: 0 },
    };

    expect(() => applyAndAssertNoCollision(updates, seed)).not.toThrow();

    const finalById = new Map<string, LegUpdate>();
    for (const u of updates) finalById.set(u.id, u);
    expect(finalById.get("legS0")?.legOrder).toBe(1);
    expect(finalById.get("legS1")?.legOrder).toBe(0);
    expect(finalById.get("legS0")?.sessionId).not.toBe(finalById.get("legS1")?.sessionId);
  });
});
