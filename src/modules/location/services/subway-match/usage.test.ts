import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { subwayTripMatches } from "@/db";
import { timestampParam } from "@/db/sql";
import { numberedMatchesCte } from "./usage";

/**
 * `getSubwayUsage`/`getSubwayInsights` run raw SQL against Postgres (window
 * functions, PostGIS-adjacent joins) — there is no in-memory Postgres in
 * this test suite (checked: no pg-mem/testcontainers/pglite dependency,
 * nothing in vitest.config.mts/vitest.setup.ts spins one up), and this fix
 * deliberately makes no DB calls. So this file pins three things instead:
 *
 *   1. `numberedMatchesCte`'s *actual* generated SQL and bound parameters,
 *      rendered via `PgDialect#sqlToQuery` (no DB connection needed — it's
 *      pure query-string assembly) — the real function that ships to
 *      production, not a parallel description of it. This is what pins the
 *      user scope and the KST-aligned date binding structurally, and is
 *      what would have caught this fix's own first-draft bug (binding a
 *      bare JS Date instead of routing it through `timestampParam`).
 *   2. A pure-JS reference model of the ordering *algorithm* the CTE
 *      implements — exercised against shapes the SQL has to handle
 *      (multi-leg sessions, a same-sub_start_time tie, unsessioned rows).
 *      This model imports nothing from usage.ts, so it cannot detect a
 *      defect in the shipped SQL — only in the reasoning the SQL is
 *      supposed to encode. Concretely, it would NOT catch: the SELECT
 *      list's `l1`/`l2` aliases being swapped so every transfer pair
 *      reports backwards, or a missing `user_id` filter turning into a
 *      cross-user data leak. Those need the query to actually run — an
 *      integration test, which is out of scope here (no DB access) and is
 *      not simulated by this file.
 *   3. Source-text guards (same technique as ../../../db/raw-sql-now.test.ts)
 *      pinning that no `sql\`` block anywhere in usage.ts still derives
 *      ordering from the stored (segment-local) `leg_order` column, that
 *      all three sites actually call the shared builder rather than
 *      re-inlining their own copy of the CTE, that none of the file's seven
 *      date-filtered queries binds a bare `fromDate`/`toExclusiveDate`
 *      (`numberedMatchesCte` only made the 3 CTE-consuming sites
 *      structurally safe — the other 4 still bind inline, with zero
 *      structural coverage until this guard), and that the `user_id` scope
 *      survives at its expected count across all five template locations.
 */

describe("numberedMatchesCte — the actual SQL and params it generates", () => {
  const dialect = new PgDialect();
  const userId = "11111111-1111-1111-1111-111111111111";
  const fromDate = new Date("2026-08-01T00:00:00.000Z");
  const toExclusiveDate = new Date("2026-09-01T00:00:00.000Z");

  function render() {
    const { sql: text, params } = dialect.sqlToQuery(
      numberedMatchesCte(userId, fromDate, toExclusiveDate)
    );
    // Collapse whitespace so incidental reformatting of the template
    // literal (indentation, line breaks) can't break this test — only a
    // semantic change to the clauses themselves should.
    return { normalized: text.replace(/\s+/g, " ").trim(), params };
  }

  it("scopes to exactly one user via a bound parameter, not string interpolation", () => {
    const { normalized, params } = render();
    expect(normalized).toMatch(/WHERE m\.user_id = \$1::uuid/);
    expect(params[0]).toBe(userId);
  });

  it("binds both date bounds through timestampParam, not a raw Date — the Commit-1 regression this test exists to catch", () => {
    const { normalized, params } = render();
    expect(normalized).toMatch(/AND m\.sub_start_time >= \$2/);
    expect(normalized).toMatch(/AND m\.sub_start_time < \$3/);

    // A bare `${fromDate}` would bind the JS Date object itself as the
    // parameter (node-postgres then serializes it in the process
    // timezone). timestampParam maps it through the column's own driver
    // mapping first, producing a string — asserting the type and exact
    // value here is what catches a regression back to raw interpolation.
    const expectedFrom = timestampParam(subwayTripMatches.subStartTime, fromDate);
    const expectedTo = timestampParam(subwayTripMatches.subStartTime, toExclusiveDate);
    expect(typeof params[1]).toBe("string");
    expect(typeof params[2]).toBe("string");
    expect(params[1]).toBe(expectedFrom);
    expect(params[2]).toBe(expectedTo);
    expect(params).toEqual([userId, expectedFrom, expectedTo]);
  });

  it("partitions by COALESCE(session_id, id) and orders by sub_start_time, sub_end_time, id", () => {
    const { normalized } = render();
    expect(normalized).toMatch(/PARTITION BY COALESCE\(m\.session_id, m\.id\)/);
    expect(normalized).toMatch(/ORDER BY m\.sub_start_time, m\.sub_end_time, m\.id/);
    expect(normalized).toMatch(/AS leg_rn/);
  });

  it("reads from subway_trip_matches and names the CTE numbered_matches", () => {
    const { normalized } = render();
    expect(normalized).toMatch(/^numbered_matches AS \(/);
    expect(normalized).toMatch(/FROM subway_trip_matches m/);
  });
});

describe("usage.ts source guards (mirrors db/raw-sql-now.test.ts's technique)", () => {
  const source = readFileSync(fileURLToPath(new URL("./usage.ts", import.meta.url)), "utf-8");

  it("all three sites call the shared builder instead of re-inlining their own CTE", () => {
    const calls = source.match(/numberedMatchesCte\(userId, fromDate, toExclusiveDate\)/g);
    expect(calls).toHaveLength(3);
  });

  // `numberedMatchesCte` made the 3 CTE-consuming sites structurally safe,
  // but 4 of the 7 date-filtered queries (getSubwayInsights's aggRes/
  // lineRes, getSubwayUsage's linesRes/stationsRes) still bind fromDate/
  // toExclusiveDate inline, with zero structural coverage — this file
  // already shipped the raw-Date bug once (see the file's own header
  // comment). This must run against the RAW `source` string, not
  // `extractSqlTemplates`'s output below: that helper's depth-walk strips
  // the `${` `}` interpolation delimiters as it flattens a template into a
  // body string, so a bare `${fromDate}` no longer looks like `${fromDate}`
  // by the time it reaches `sqlBlocks` — this guard would silently never
  // fire if it ran against that extracted text instead of `source`.
  it("no query binds a bare fromDate/toExclusiveDate — every date bound must route through timestampParam", () => {
    expect(source).not.toMatch(/\$\{\s*(fromDate|toExclusiveDate)\s*\}/);
  });

  // Same reasoning, for the user_id scope: 4 sites still write
  // `m.user_id = ${userId}::uuid` inline (the 5th copy lives inside
  // numberedMatchesCte, shared by the other 3 sites). Pinning the exact
  // count catches either a filter quietly dropped (a cross-user data leak)
  // or a stray duplicate, without needing per-query line numbers that
  // would drift as the file is edited.
  it("every date-filtered query keeps its user_id scope (5 occurrences: 4 inline + 1 inside numberedMatchesCte)", () => {
    const calls = source.match(/m\.user_id = \$\{userId\}::uuid/g);
    expect(calls).toHaveLength(5);
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

describe("usage.ts SQL-template source guards", () => {
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

  it("transfer_count and the adjacency joins key off the derived leg_rn, not leg_order", () => {
    const joined = sqlBlocks.join("\n---\n");
    expect(joined).toMatch(/leg_rn > 1/);
    expect(joined).toMatch(/m2\.leg_rn = m1\.leg_rn \+ 1/);
  });
});

/**
 * Reference model of the ordering *algorithm* `numberedMatchesCte`
 * implements — NOT a test of the SQL itself (see file header for exactly
 * what this can and cannot catch). Kept as executable documentation of the
 * null-partition and tie-break reasoning, which is easy to get backwards
 * when read as prose.
 */
interface FakeMatch {
  id: string;
  sessionId: string | null;
  subStartTime: string; // ISO, second resolution — matches GPS timestamp precision
  subEndTime: string;
  lineId: string;
}

/** Mirrors `numbered_matches`'s `ORDER BY sub_start_time, sub_end_time, id`. */
function compareByOrderClause(a: FakeMatch, b: FakeMatch): number {
  return (
    a.subStartTime.localeCompare(b.subStartTime) ||
    a.subEndTime.localeCompare(b.subEndTime) ||
    a.id.localeCompare(b.id)
  );
}

/** Mirrors `numbered_matches.leg_rn`. */
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

describe("reference model of the numbered_matches ordering algorithm (does not execute the real SQL — see file header)", () => {
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
