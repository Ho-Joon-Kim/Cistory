import { describe, expect, it } from "vitest";

/**
 * Guard against a bare `now()` being used to WRITE a timestamp in raw SQL.
 *
 * `timestamp` columns hold UTC wall time when Drizzle writes them, but a bare
 * `now()` is cast timestamptz→timestamp using the SESSION timezone — Asia/Seoul on
 * this server — so it stores KST wall time instead, 9 hours off from everything the
 * query builder writes. That mismatch has already shipped twice: `7790bb5`/`671aa1a`
 * fixed it in the overview precompute, and the health daily-summary rollup was fixed
 * the same way later. Raw-SQL writes must bind a JS Date through
 * `timestampParam(column, date)` (and read back via `timestampFromDriver`).
 *
 * Reading is a different matter and stays legitimate: comparing a stored naive
 * timestamp against `now()` casts the stored value back using the same session
 * timezone, which round-trips correctly for the columns still on the KST convention
 * (`location_processing_days.processing_started_at` depends on exactly that). So this
 * test does not ban `now()` — it pins the known occurrences, all of which are reads,
 * and fails on anything new so the author has to decide which side they are on.
 *
 * If this test fails, either switch the write to `timestampParam`, or add the file
 * here with a note on why its `now()` is a read.
 */
const ALLOWED: Record<string, number> = {
  // `(now() at time zone 'Asia/Seoul')::date` — today's KST date, for filtering and
  // for splitting past-vs-today in the day-status rollup.
  "/src/app/api/settings/location-backfill/route.ts": 6,
  // `last_refreshed_at < now() - interval '350 days'` — staleness comparison.
  "/src/lib/cron.ts": 1,
  // A 45-day window bound, plus two stale-lease comparisons against
  // `processing_started_at`, which is stored KST and so must be compared this way.
  "/src/modules/location/cron-processing.ts": 3,
  // `(now() at time zone 'Asia/Seoul')::date` — day-range bounds.
  "/src/modules/location/services/backfill-orchestrator.ts": 2,
};

/**
 * Extract the bodies of ``sql`...` `` template literals, so the JS helper `now()`
 * from `src/lib/utils.ts` and any prose mentioning `now()` in a comment are ignored.
 * Walks `${...}` interpolations by depth so an embedded expression cannot end the
 * literal early.
 */
/** Read one template literal body starting just after its opening backtick. */
function readTemplateBody(source: string, start: number): { body: string; end: number } {
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
  return { body, end: i };
}

function extractSqlTemplates(source: string): string[] {
  const blocks: string[] = [];
  // Matches `sql`, `sql.raw`, and the generic form `sql<number>` used for typed rows.
  const tag = /\bsql(?:\.raw)?(?:<[^>`]*>)?\s*`/g;
  let match = tag.exec(source);
  while (match) {
    const { body, end } = readTemplateBody(source, match.index + match[0].length);
    blocks.push(body);
    tag.lastIndex = end;
    match = tag.exec(source);
  }
  return blocks;
}

/** Count SQL `now()` calls, excluding `Date.now()` / `performance.now()`. */
function countSqlNow(source: string): number {
  return extractSqlTemplates(source).reduce((total, block) => {
    const hits = block.match(/(?<![.\w])now\s*\(\s*\)/gi);
    return total + (hits?.length ?? 0);
  }, 0);
}

const sources = import.meta.glob("/src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("raw SQL never writes a timestamp with a bare now()", () => {
  const entries = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));

  it("discovers source files (guards against a glob typo)", () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it("only the pinned read-side occurrences exist", () => {
    const found: Record<string, number> = {};
    for (const [path, source] of entries) {
      const count = countSqlNow(source);
      if (count > 0) found[path] = count;
    }
    expect(found).toEqual(ALLOWED);
  });

  it("ignores the JS now() helper and Date.now()", () => {
    expect(countSqlNow("const t = now(); const u = Date.now();")).toBe(0);
    expect(countSqlNow("// a comment about now() in raw SQL")).toBe(0);
  });

  it("still catches a now() inside a sql template", () => {
    expect(countSqlNow("await db.execute(sql`UPDATE t SET updated_at = now()`);")).toBe(1);
    // An interpolation must not end the literal early, so the trailing now() is seen.
    const interp = ["$", "{param}"].join("");
    expect(countSqlNow(`sql\`SELECT ${interp} WHERE a < now() - interval '1 day'\``)).toBe(1);
  });

  it("sees through the generic form, which a plain `sql\\`` match would miss", () => {
    expect(countSqlNow("const c = sql<number>`count(*) filter (where a < now())::int`;")).toBe(1);
  });
});
