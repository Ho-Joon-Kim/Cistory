// Bounded fixture benchmark; never uses DATABASE_URL or loads .env files.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import pg from "pg";
const connectionString = process.env.TEST_DATABASE_URL;
assert(connectionString, "Set TEST_DATABASE_URL to the disposable localhost:5433 test database");
const url = new URL(connectionString);
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5433" && url.pathname === "/cistory_test", "Refusing any non-test database");
const client = new pg.Client({ connectionString });
const userId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const statsResult = (rows, total) => {
  const result = { total, pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) if (row.status in result && row.status !== "total") result[row.status] = Number(row.count);
  return result;
};
const idsSql = "SELECT id FROM bench_commits WHERE user_id = $1";
const joinSql = "SELECT s.status, count(*) AS count FROM bench_commits c LEFT JOIN bench_summaries s ON s.commit_id = c.id WHERE c.user_id = $1 GROUP BY s.status";
async function oldQuery() {
  const start = performance.now();
  const idsRows = (await client.query(idsSql, [userId])).rows;
  const ids = idsRows.map((row) => row.id);
  const sql = `SELECT status, count(*) AS count FROM bench_summaries WHERE commit_id IN (${ids.map((_, i) => `$${i + 1}`).join(",")}) GROUP BY status`;
  const rows = (await client.query(sql, ids)).rows;
  const result = statsResult(rows, ids.length);
  const elapsedMs = performance.now() - start;
  return { elapsedMs, result, statements: 2, parameters: ids.length + 1,
    sqlBytes: Buffer.byteLength(idsSql + sql), parameterJsonBytes: bytes([userId]) + bytes(ids),
    resultJsonBytes: bytes(idsRows) + bytes(rows) };
}
async function newQuery() {
  const start = performance.now();
  const rows = (await client.query(joinSql, [userId])).rows;
  const result = statsResult(rows, rows.reduce((sum, row) => sum + Number(row.count), 0));
  const elapsedMs = performance.now() - start;
  return { elapsedMs, result, statements: 1, parameters: 1, sqlBytes: Buffer.byteLength(joinSql),
    parameterJsonBytes: bytes([userId]), resultJsonBytes: bytes(rows) };
}
await client.connect();
try {
  assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, "cistory_test");
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '15s'");
  // Full column/index definitions, temp copies: no writes or locks on application rows.
  await client.query("CREATE TEMP TABLE bench_commits (LIKE public.commits INCLUDING ALL) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE bench_summaries (LIKE public.commit_summaries INCLUDING ALL) ON COMMIT DROP");
  await client.query(`INSERT INTO bench_commits (id,user_id,sha,message,author_name,committed_at,repo_full_name,created_at)
    SELECT md5(i::text), CASE WHEN i <= 10000 THEN $1::uuid ELSE $2::uuid END,
      md5(i::text) || '12345678', repeat('fixture commit ',8), 'fixture', now(), 'fixture/repo', now()
    FROM generate_series(1,20000) AS i`, [userId, otherId]);
  await client.query(`INSERT INTO bench_summaries (id,commit_id,summary,status,created_at,updated_at)
    SELECT md5('summary-' || i), md5(i::text), repeat('summary ',40),
      CASE WHEN i > 10000 THEN 'completed' ELSE (ARRAY['pending','processing','completed','failed'])[i % 5] END,
      now(),now() FROM generate_series(1,20000) AS i WHERE i > 10000 OR i % 5 <> 0`);
  await client.query("ANALYZE bench_commits");
  await client.query("ANALYZE bench_summaries");
  const expected = { total: 10000, pending: 2000, processing: 2000, completed: 2000, failed: 2000 };
  for (let i = 0; i < 2; i++) { assert.deepEqual((await oldQuery()).result, expected); assert.deepEqual((await newQuery()).result, expected); }
  const oldRuns = [], newRuns = [];
  for (let i = 0; i < 9; i++) {
    if (i % 2) { newRuns.push(await newQuery()); oldRuns.push(await oldQuery()); }
    else { oldRuns.push(await oldQuery()); newRuns.push(await newQuery()); }
  }
  for (const run of [...oldRuns, ...newRuns]) assert.deepEqual(run.result, expected);
  const summarize = (runs) => ({ ...runs[0], elapsedMs: undefined, medianMs: Number(median(runs.map((r) => r.elapsedMs)).toFixed(3)), minMs: Number(Math.min(...runs.map((r) => r.elapsedMs)).toFixed(3)), maxMs: Number(Math.max(...runs.map((r) => r.elapsedMs)).toFixed(3)) });
  console.log(JSON.stringify({ fixture: { commits: 20000, targetUserCommits: 10000, summaries: 18000, targetWithoutSummary: 2000 }, warmups: 2, measuredRunsEach: 9, old: summarize(oldRuns), join: summarize(newRuns), postgres: (await client.query("SHOW server_version")).rows[0].server_version }, null, 2));
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
