import { describe, expect, it } from "vitest";
import { planSessionAssignments, type SessionAssignment } from "./session-grouper";

/**
 * `subway_trip_matches` carries a unique index on
 * `(transportationSegmentId, legOrder)` — `idx_stm_segment_leg`. That column
 * is written once, by the matcher, and is never touched again here: this
 * grouper only ever assigns `session_id`, which has no uniqueness
 * constraint. These tests pin that contract (no `legOrder` in the output)
 * and reproduce the shape that broke the pre-fix "renumber leg_order to a
 * session-local position" design, to guard against it coming back.
 */

interface FakeRow {
  segmentId: string;
  legOrder: number;
  sessionId?: string;
}

/**
 * Applies `assignments` step by step against an in-memory "table" and
 * asserts the `idx_stm_segment_leg` invariant — no two rows sharing a
 * `segmentId` may share a `legOrder` — holds after *every* write, not just
 * at the end. Since `planSessionAssignments` never sets `legOrder`, every
 * row's `legOrder` here is whatever the seed (i.e. the matcher) gave it,
 * and the invariant holds by construction; this harness exists to make that
 * an explicit, checked property rather than an implicit one.
 */
function applySessionAssignmentsAndAssertNoCollision(
  assignments: SessionAssignment[],
  seedRows: Record<string, FakeRow>
): void {
  const table = new Map<string, FakeRow>(
    Object.entries(seedRows).map(([id, row]) => [id, { ...row }])
  );

  for (const assignment of assignments) {
    const row = table.get(assignment.id);
    if (!row) throw new Error(`unknown row id in assignment: ${assignment.id}`);
    row.sessionId = assignment.sessionId;
    // Defensive: if a regression reintroduces a `legOrder` field onto
    // SessionAssignment (the exact pre-fix bug), apply it too, so this
    // harness — and the regression test below — catches the collision
    // rather than silently ignoring the extra field.
    const maybeLegOrder = (assignment as unknown as { legOrder?: number }).legOrder;
    if (maybeLegOrder !== undefined) row.legOrder = maybeLegOrder;

    const seen = new Map<string, string>();
    for (const [id, r] of table) {
      const key = `${r.segmentId}:${r.legOrder}`;
      const collidingId = seen.get(key);
      if (collidingId) {
        throw new Error(
          `idx_stm_segment_leg violation after assignment for id=${assignment.id}: ` +
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

describe("planSessionAssignments", () => {
  it("returns an empty sequence for empty input", () => {
    expect(planSessionAssignments([], sequentialSessionIds())).toEqual([]);
  });

  it("never assigns a legOrder — only id and sessionId", () => {
    const groups = [[{ id: "a" }, { id: "b" }], [{ id: "c" }]];
    const assignments = planSessionAssignments(groups, sequentialSessionIds());

    for (const assignment of assignments) {
      expect(assignment).not.toHaveProperty("legOrder");
      expect(Object.keys(assignment).sort()).toEqual(["id", "sessionId"]);
    }
  });

  it("assigns one shared sessionId per group, and every id exactly once", () => {
    const groups = [
      [{ id: "g1-a" }, { id: "g1-b" }, { id: "g1-c" }],
      [{ id: "g2-a" }],
      [{ id: "g3-a" }, { id: "g3-b" }],
    ];
    const assignments = planSessionAssignments(groups, sequentialSessionIds());

    expect(assignments).toHaveLength(6);
    const byId = new Map(assignments.map((a) => [a.id, a]));
    for (const group of groups) {
      const sessionIds = new Set(group.map((row) => byId.get(row.id)?.sessionId));
      expect(sessionIds.size).toBe(1);
      expect([...sessionIds][0]).toBeDefined();
    }
    // Distinct groups get distinct sessions.
    expect(byId.get("g1-a")?.sessionId).not.toBe(byId.get("g2-a")?.sessionId);
    expect(byId.get("g2-a")?.sessionId).not.toBe(byId.get("g3-a")?.sessionId);
  });

  it("load-bearing regression: a segment's two legs landing as the first leg of two different sessions group successfully instead of rolling back", () => {
    // Reproduces the real production shape (measured on the live DB: 47
    // matches left with session_id NULL across 12 days). Transportation
    // segment "S" was split into two legs by the matcher (matcher-assigned
    // legOrder 0 and 1, segment-local — see matcher.ts's Case A). The
    // grouper's time-order walk puts each leg into a *different* transfer
    // session, and in each session that leg is the first one.
    //
    // Under the pre-fix design (renumber leg_order to session-local
    // position), BOTH legs would be reassigned position 0 — a permanent
    // collision on idx_stm_segment_leg's (transportation_segment_id,
    // leg_order) key on their *final* values. That's a different failure
    // shape than the transient mid-renumber collision commit b75f0b9's
    // park/assign scheme fixed: this one collides on final state, so
    // reordering the UPDATE sequence cannot help (confirmed against all 12
    // affected days). See session-grouper.ts's file header for why the fix
    // is to stop renumbering leg_order at all, rather than to reorder
    // writes further.
    const groups = [
      [{ id: "legS0" }, { id: "otherLeg-t1" }], // legS0 is the first leg of session A
      [{ id: "legS1" }, { id: "otherLeg-t2" }], // legS1 is the first leg of session B
    ];
    const assignments = planSessionAssignments(groups, sequentialSessionIds());

    // The fix: session assignment never touches leg_order, so applying it
    // can never re-collide legS0 and legS1 on (segmentId="S", legOrder=0) —
    // the matcher's original 0/1 split stays untouched and unique.
    const seed: Record<string, FakeRow> = {
      legS0: { segmentId: "S", legOrder: 0 },
      "otherLeg-t1": { segmentId: "T1", legOrder: 0 },
      legS1: { segmentId: "S", legOrder: 1 },
      "otherLeg-t2": { segmentId: "T2", legOrder: 0 },
    };
    expect(() => applySessionAssignmentsAndAssertNoCollision(assignments, seed)).not.toThrow();

    // Sanity: legS0 and legS1 really did land in different sessions — this
    // is genuinely the "different sessions" shape, not a same-session no-op.
    const byId = new Map(assignments.map((a) => [a.id, a]));
    expect(byId.get("legS0")?.sessionId).not.toBe(byId.get("legS1")?.sessionId);
  });
});
