import { type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { localDaySql } from "@/db/sql";
import { getKstDateWindow } from "@/lib/date-key";
import type { SearchCounts, SearchInput, SearchItem, SearchResponse } from "./types";

type Row = Omit<SearchItem, "href"> & {
  linkDate: string | null;
  repository: string | null;
  sha: string | null;
  amount: number | string | null;
  category: string | null;
};

const PAGE_SIZE = 30;

/** Read only, owner-scoped search. PostgreSQL applies filtering and pagination. */
export async function searchRecords(
  db: Database,
  userId: string,
  input: SearchInput
): Promise<SearchResponse> {
  const { start, end } = getKstDateWindow(input.from, input.to);
  // App timestamps are UTC stored in timestamp WITHOUT time zone. Explicit
  // casts avoid interpreting parameters in the connection's session timezone.
  const lower = start.toISOString();
  const upper = end.toISOString();
  const pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
  const match = (fields: SQL[]) =>
    input.q
      ? sql`(${sql.join(
          fields.map((field) => sql`${field} ILIKE ${pattern}`),
          sql` OR `
        )})`
      : sql`true`;
  const sources: Record<SearchItem["source"], SQL> = {
    commit: sql`SELECT id::text, 'commit'::text AS source,
      left(split_part(message, E'\n', 1), 300) AS title, left(repo_full_name, 500) AS description,
      committed_at AS occurred_at, committed_at AS link_at, repo_full_name AS repository, sha,
      NULL::float8 AS amount, NULL::text AS category
      FROM commits WHERE user_id = ${userId} AND committed_at >= ${lower}::timestamp
      AND committed_at < ${upper}::timestamp
      AND ${match([sql`message`, sql`repo_full_name`])}`,
    spending: sql`SELECT id::text, 'spending'::text AS source, left(merchant, 300) AS title,
      left(concat_ws(' · ', amount::text || '원', category, override_note), 500) AS description,
      transacted_at AS occurred_at, transacted_at AS link_at, NULL::text AS repository, NULL::text AS sha,
      amount::float8 AS amount, category
      FROM transactions WHERE user_id = ${userId} AND transacted_at >= ${lower}::timestamp
      AND transacted_at < ${upper}::timestamp
      AND ${match([sql`merchant`, sql`category`, sql`override_note`])}
      ${input.category ? sql`AND category = ${input.category}` : sql``}`,
    visit: sql`SELECT v.id::text, 'visit'::text AS source,
      left(coalesce(p.name, v.place_name, v.address, '방문 기록'), 300) AS title,
      left(concat_ws(' · ', v.city, v.address), 500) AS description,
      greatest(v.start_time, ${lower}::timestamp) AS occurred_at, v.start_time AS link_at, NULL::text AS repository, NULL::text AS sha,
      NULL::float8 AS amount, NULL::text AS category
      FROM visits v LEFT JOIN saved_places p ON p.id = v.saved_place_id AND p.user_id = ${userId}
      WHERE v.user_id = ${userId} AND v.start_time < ${upper}::timestamp
      AND v.end_time >= ${lower}::timestamp
      AND ${match([sql`v.place_name`, sql`p.name`, sql`v.address`, sql`v.city`])}`,
    trip: sql`SELECT id::text, 'trip'::text AS source, left(name, 300) AS title,
      left(concat_ws(' · ', start_date || ' ~ ' || end_date, notes), 500) AS description,
      greatest(start_date, ${input.from})::timestamp - interval '9 hours' AS occurred_at, NULL::timestamp AS link_at, NULL::text AS repository, NULL::text AS sha,
      NULL::float8 AS amount, NULL::text AS category
      FROM trips WHERE user_id = ${userId} AND start_date <= ${input.to}
      AND end_date >= ${input.from}
      AND ${match([sql`name`, sql`notes`, sql`visited_cities`, sql`visited_countries`])}`,
  };
  // A category filter means "spending in that category"; an hour window can't
  // apply to trips (whole days), so both narrow the branch set.
  const eligible = (Object.keys(sources) as SearchItem["source"][]).filter(
    (key) => (!input.category || key === "spending") && (!input.hours || key !== "trip")
  );
  const hourFilter = input.hours
    ? (() => {
        const hour = sql`extract(hour from (link_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'))`;
        const { from, to } = input.hours;
        return from < to
          ? sql`WHERE ${hour} >= ${from} AND ${hour} < ${to}`
          : sql`WHERE (${hour} >= ${from} OR ${hour} < ${to})`;
      })()
    : sql``;
  const selected = (
    input.source === "all" ? eligible : eligible.filter((k) => k === input.source)
  ).map((key) => sources[key]);
  const union = (parts: SQL[]) =>
    parts.length ? sql.join(parts, sql` UNION ALL `) : sources.commit;
  const empty = selected.length === 0;
  const [result, countRows] = await Promise.all([
    empty
      ? Promise.resolve({ rows: [] as Row[] })
      : db.execute<Row>(sql`
    SELECT id, source, title, description,
      ${localDaySql(sql`occurred_at`)}::text AS date,
      ${localDaySql(sql`link_at`)}::text AS "linkDate", repository, sha, amount, category,
      to_char(coalesce(link_at, occurred_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "occurredAt"
    FROM (${union(selected)}) records
    ${hourFilter}
    ORDER BY occurred_at DESC, source ASC, id ASC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${(input.page - 1) * PAGE_SIZE}
  `),
    eligible.length === 0
      ? Promise.resolve({ rows: [] as { source: string; count: number }[] })
      : db.execute<{ source: string; count: number }>(sql`
    SELECT source, count(*)::int AS count
    FROM (${union(eligible.map((key) => sources[key]))}) records
    ${hourFilter}
    GROUP BY source
  `),
  ]);
  const counts: SearchCounts = { commit: 0, spending: 0, visit: 0, trip: 0 };
  for (const row of countRows.rows) {
    if (row.source in counts) counts[row.source as keyof SearchCounts] = Number(row.count);
  }
  return {
    items: result.rows
      .slice(0, PAGE_SIZE)
      .map(({ linkDate, repository, sha, amount, category, ...row }) => {
        let href = `/dashboard?date=${encodeURIComponent(linkDate ?? row.date)}`;
        if (row.source === "trip") href = `/travel/${encodeURIComponent(row.id)}`;
        if (row.source === "commit" && repository && sha) {
          href = `https://github.com/${repository.split("/").map(encodeURIComponent).join("/")}/commit/${encodeURIComponent(sha)}`;
        }
        return {
          ...row,
          amount: amount === null || amount === undefined ? null : Number(amount),
          category: category ?? null,
          repository: row.source === "commit" ? repository : null,
          href,
        };
      }),
    hasMore: input.page < 100 && result.rows.length > PAGE_SIZE,
    page: input.page,
    counts,
  };
}
