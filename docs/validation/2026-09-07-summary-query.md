# Summary statistics JOIN measurement

The old `GET /api/summaries/process` first transfers every user commit ID to Node, then sends
those IDs back as an `IN` list to group summary statuses. The replacement groups a user-scoped
LEFT JOIN in PostgreSQL, retaining commits without summaries in `total`.

A bounded comparison on 2026-09-07 used Node 24.20.0, `pg`, and disposable PostgreSQL 17.10 at
localhost:5433. Two temporary tables copied the application column/index definitions with
`LIKE ... INCLUDING ALL`. They contained 20,000 commits across two users and 18,000 summaries.
The target user had 10,000 commits: 2,000 in each summary status and 2,000 without any summary.
The other user's 10,000 completed summaries test that the filter does not contaminate counts.
No application rows were modified; the transaction was rolled back and the connection closed.

Both variants returned exactly:

```json
{"total":10000,"pending":2000,"processing":2000,"completed":2000,"failed":2000}
```

After two warmups per variant, nine measurements per variant alternated execution order:

| Measurement | ID lookup + IN | LEFT JOIN aggregate |
| --- | ---: | ---: |
| Median application elapsed time | 18.330 ms | 7.490 ms |
| Min–max | 16.994–20.995 ms | 7.105–7.820 ms |
| SQL statements per request | 2 | 1 |
| Bound parameters per request | 10,001 | 1 |
| SQL text bytes | 59,031 | 144 |
| Parameters serialized as JSON, bytes | 350,041 | 40 |
| Result rows serialized as JSON, bytes | 420,150 | 180 |

The JOIN took about **59% less time (2.45× faster)** in this fixture. The major structural gain
is eliminating the 10,000-ID round trip and growing parameter list. The small extra null-status
aggregate group is intentional: it preserves the historical total of all user commits.

Elapsed time includes SQL/parameter construction, local Docker transport, result materialization,
and application result reduction using `pg`; it excludes HTTP authentication, Drizzle query
builder overhead, and fixture setup. Byte figures are exact UTF-8 SQL and JSON representation
sizes, **not measured PostgreSQL wire traffic**. These warm-cache local measurements are not a
production latency guarantee; hardware, concurrent Docker builds, data distribution, and cache
state differ. The selected fixture uses 32-character text IDs.

Reproduce against the disposable test database only:

```sh
TEST_DATABASE_URL=postgresql://cistory_test:cistory_test@localhost:5433/cistory_test \
  node docs/validation/summary-query-benchmark.mjs
```

The script refuses other hosts/ports/database names and never loads `.env` or `DATABASE_URL`.
