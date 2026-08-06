import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `getSubwayUsage`/`getSubwayInsights` run raw SQL against Postgres
 * (window functions, PostGIS-adjacent joins) — there is no in-memory
 * Postgres in this test suite, and this fix deliberately makes no DB calls
 * (see the enclosing PR: the live data needs a human-reviewed re-run, not a
 * test touching it). So this file pins two things instead:
 *
 *   1. A pure-JS reference model of the `numbered_matches` CTE shared by
 *      all three fixed query sites — `ROW_NUMBER() OVER (PARTITION BY
 *      COALESCE(session_id, id) ORDER BY sub_start_time, sub_end_time,
 *      id)` — exercised against the same shapes the SQL has to handle
 *      (multi-leg sessions, a same-sub_start_time tie, unsessioned rows).
 *      If the CTE's PARTITION BY / ORDER BY ever changes, this model must
 *      change with it — they are not auto-synced.
 *   2. A source-text guard (same technique as ../../../db/raw-sql-now.test.ts)
 *      asserting the actual SQL in usage.ts contains that exact clause
 *      shape and no longer references the stored (segment-local)
 *      `leg_order` column at all.
 */

interface FakeMatch {
  id: string;
  sessionId: string | null;
  subStartTime: string; // ISO, second resolution — matches GPS timestamp precision
  subEndTime: string;
  lineId: string;
}

/** `ORDER BY sub_start_time, sub_end_time, id` — see file header. */
function compareByOrderClause(a: FakeMatch, b: FakeMatch): number {
  return (
    a.subStartTime.localeCompare(b.subStartTime) ||
    a.subEndTime.localeCompare(b.subEndTime) ||
    a.id.localeCompare(b.id)
  );
}

/** Mirrors `numbered_matches.leg_rn` — see file header. */
function deriveLegRn(matches: FakeMatch[]): Map<string, number> {
  const partitionKey = (m: FakeMatch) => m.sessionId ?? `__self:${m.id}`;
  const groups = new Map<string, FakeMatch[]>();
  for (const m of matches) {
    const key = partitionKey(m);
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }
  const legRn = new Map<string, number>();
  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort(compareByOrderClause);
    for (let i = 0; i < sorted.length; i++) legRn.set(sorted[i].id, i + 1);
  }
  return legRn;
}

/** Mirrors the `transfer_count` FILTER in getSubwayUsage's aggRes query. */
function transferCount(matches: FakeMatch[]): number {
  const legRn = deriveLegRn(matches);
  return matches.filter((m) => (legRn.get(m.id) ?? 1) > 1).length;
}

/** Mirrors the m1/m2 adjacency join used by both pairsRes and transferRes. */
function adjacentPairs(matches: FakeMatch[]): Array<{ fromId: string; toId: string }> {
  const legRn = deriveLegRn(matches);
  const bySessionAndRn = new Map<string, FakeMatch>();
  for (const m of matches) {
    if (m.sessionId === null) continue;
    bySessionAndRn.set(`${m.sessionId}:${legRn.get(m.id)}`, m);
  }
  const pairs: Array<{ fromId: string; toId: string }> = [];
  for (const m of matches) {
    if (m.sessionId === null) continue;
    const rn = legRn.get(m.id) as number;
    const next = bySessionAndRn.get(`${m.sessionId}:${rn + 1}`);
    if (next) pairs.push({ fromId: m.id, toId: next.id });
  }
  return pairs;
}

describe("session-local leg ordering derived from time (usage.ts numbered_matches)", () => {
  it("matches what session-local leg_order used to give: a 3-leg session counts 2 transfers, chained in order", () => {
    const matches: FakeMatch[] = [
      {
        id: "m1",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:00:00Z",
        subEndTime: "2026-08-01T00:10:00Z",
        lineId: "L1",
      },
      {
        id: "m2",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:12:00Z",
        subEndTime: "2026-08-01T00:20:00Z",
        lineId: "L2",
      },
      {
        id: "m3",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:22:00Z",
        subEndTime: "2026-08-01T00:30:00Z",
        lineId: "L3",
      },
    ];
    expect(transferCount(matches)).toBe(2);
    expect(adjacentPairs(matches)).toEqual([
      { fromId: "m1", toId: "m2" },
      { fromId: "m2", toId: "m3" },
    ]);
  });

  it("a single-leg session contributes zero transfers and no adjacency pairs", () => {
    const matches: FakeMatch[] = [
      {
        id: "m1",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:00:00Z",
        subEndTime: "2026-08-01T00:10:00Z",
        lineId: "L1",
      },
    ];
    expect(transferCount(matches)).toBe(0);
    expect(adjacentPairs(matches)).toEqual([]);
  });

  it("distinct sessions never pair with each other, even when interleaved in time", () => {
    const matches: FakeMatch[] = [
      {
        id: "a1",
        sessionId: "sA",
        subStartTime: "2026-08-01T00:00:00Z",
        subEndTime: "2026-08-01T00:05:00Z",
        lineId: "L1",
      },
      {
        id: "b1",
        sessionId: "sB",
        subStartTime: "2026-08-01T00:06:00Z",
        subEndTime: "2026-08-01T00:11:00Z",
        lineId: "L2",
      },
      {
        id: "a2",
        sessionId: "sA",
        subStartTime: "2026-08-01T00:12:00Z",
        subEndTime: "2026-08-01T00:17:00Z",
        lineId: "L3",
      },
    ];
    // a1 and a2 are session sA's legs 1 and 2, but b1 sits between them in
    // time — the partition must keep b1 out of sA's chain.
    expect(adjacentPairs(matches)).toEqual([{ fromId: "a1", toId: "a2" }]);
    expect(transferCount(matches)).toBe(1); // only a2, not b1
  });

  it("ties on sub_start_time break deterministically by sub_end_time, then id — not the input/scan order", () => {
    // legB and legC start at the identical instant (the trap called out in
    // the task: two legs of one session can share a sub_start_time). Without
    // a tiebreaker, ROW_NUMBER's order across ties is arbitrary and could
    // swap on every query, silently flipping which line pairs with which.
    const base: FakeMatch[] = [
      {
        id: "legA",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:00:00Z",
        subEndTime: "2026-08-01T00:05:00Z",
        lineId: "L1",
      },
      // Tie on subStartTime; legB ends earlier so it must sort first.
      {
        id: "legC",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:05:00Z",
        subEndTime: "2026-08-01T00:12:00Z",
        lineId: "L3",
      },
      {
        id: "legB",
        sessionId: "s1",
        subStartTime: "2026-08-01T00:05:00Z",
        subEndTime: "2026-08-01T00:09:00Z",
        lineId: "L2",
      },
    ];
    const expected = [
      { fromId: "legA", toId: "legB" },
      { fromId: "legB", toId: "legC" },
    ];
    // `adjacentPairs` (like the SQL join it mirrors) enumerates pairs in
    // scan order, not a fixed order — sort by fromId so this compares the
    // *set* of identified pairs, which is the property under test.
    const byFrom = (a: { fromId: string }, b: { fromId: string }) =>
      a.fromId.localeCompare(b.fromId);

    // Order-independence: shuffling the input must not change which pairs
    // are found, proving the tiebreak — not scan/insertion order — decides
    // ties.
    expect([...adjacentPairs(base)].sort(byFrom)).toEqual(expected);
    expect([...adjacentPairs([...base].reverse())].sort(byFrom)).toEqual(expected);
    expect([...adjacentPairs([base[1], base[2], base[0]])].sort(byFrom)).toEqual(expected);
  });

  it("an unsessioned (session_id IS NULL) row is its own singleton: never a transfer, never adjacent to anything", () => {
    const matches: FakeMatch[] = [
      {
        id: "orphan1",
        sessionId: null,
        subStartTime: "2026-08-01T00:00:00Z",
        subEndTime: "2026-08-01T00:05:00Z",
        lineId: "L1",
      },
      // A second orphan at a time that would make it "leg 2" under a naive
      // PARTITION BY session_id (which groups all NULLs into one bucket).
      {
        id: "orphan2",
        sessionId: null,
        subStartTime: "2026-08-01T00:06:00Z",
        subEndTime: "2026-08-01T00:11:00Z",
        lineId: "L2",
      },
      {
        id: "grouped1",
        sessionId: "s1",
        subStartTime: "2026-08-01T01:00:00Z",
        subEndTime: "2026-08-01T01:05:00Z",
        lineId: "L3",
      },
      {
        id: "grouped2",
        sessionId: "s1",
        subStartTime: "2026-08-01T01:06:00Z",
        subEndTime: "2026-08-01T01:11:00Z",
        lineId: "L4",
      },
    ];
    const legRn = deriveLegRn(matches);
    // Both orphans rank as leg 1 of "their own session" — the COALESCE(id)
    // partition — not leg 1/2 of one shared NULL bucket.
    expect(legRn.get("orphan1")).toBe(1);
    expect(legRn.get("orphan2")).toBe(1);
    expect(transferCount(matches)).toBe(1); // only grouped2
    expect(adjacentPairs(matches)).toEqual([{ fromId: "grouped1", toId: "grouped2" }]);
  });
});

/**
 * Extracts the bodies of `` sql`...` `` template literals, same technique as
 * ../../../db/raw-sql-now.test.ts, so prose in comments (which legitimately
 * still says "leg_order" to explain the fix) can't hide a real regression
 * and can't produce a false positive either. Walks `${...}` interpolations
 * by depth so an embedded expression cannot end the literal early.
 */
function readTemplateBody(source: string, start: number): string {
  let i = start;
  let depth = 0;
  let body = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      body += source.slice(i, i + 2);
      i += 2;
    } else if (ch === "$" && source[i + 1] === "{") {
      depth++;
      i += 2;
    } else if (ch === "}" && depth > 0) {
      depth--;
      i++;
    } else if (ch === "`" && depth === 0) {
      break;
    } else {
      body += ch;
      i++;
    }
  }
  return body;
}

function extractSqlTemplates(source: string): string[] {
  const blocks: string[] = [];
  const tag = /\bsql\s*`/g;
  let match = tag.exec(source);
  while (match) {
    const body = readTemplateBody(source, match.index + match[0].length);
    blocks.push(body);
    tag.lastIndex = match.index + match[0].length + body.length;
    match = tag.exec(source);
  }
  return blocks;
}

describe("usage.ts source guards (mirrors db/raw-sql-now.test.ts's technique)", () => {
  const source = readFileSync(fileURLToPath(new URL("./usage.ts", import.meta.url)), "utf-8");
  const sqlBlocks = extractSqlTemplates(source);

  it("discovers SQL template blocks (guards against a glob/regex typo)", () => {
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(6);
  });

  it("no query derives ordering from the stored (segment-local) leg_order column anymore", () => {
    for (const block of sqlBlocks) {
      expect(block).not.toMatch(/leg_order/);
    }
  });

  it("all three fixed sites share the same PARTITION BY / ORDER BY shape", () => {
    const joined = sqlBlocks.join("\n---\n");
    const cteMatches = joined.match(
      /PARTITION BY COALESCE\(m\.session_id, m\.id\)\s*\n\s*ORDER BY m\.sub_start_time, m\.sub_end_time, m\.id/g
    );
    expect(cteMatches).toHaveLength(3);
  });

  it("transfer_count and the adjacency joins key off the derived leg_rn, not leg_order", () => {
    const joined = sqlBlocks.join("\n---\n");
    expect(joined).toMatch(/leg_rn > 1/);
    expect(joined).toMatch(/m2\.leg_rn = m1\.leg_rn \+ 1/);
  });
});
