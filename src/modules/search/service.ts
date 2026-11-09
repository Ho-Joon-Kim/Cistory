import { type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { localDaySql } from "@/db/sql";
import { getKstDateWindow } from "@/lib/date-key";
import type { SearchCounts, SearchInput, SearchItem, SearchResponse } from "./types";

type Row = Omit<SearchItem, "href"> & {
  linkDate: string | null;
  koreanAddress: string | null;
  groupTotal: number | null;
  repository: string | null;
  sha: string | null;
  amount: number | string | null;
  category: string | null;
};

const PAGE_SIZE = 30;
/** Commits per (day, repository) shown in the mixed "전체" view. */
const COLLAPSED_COMMITS = 3;

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
      NULL::float8 AS amount, NULL::text AS category, NULL::float8 AS lat, NULL::float8 AS lon
      FROM commits WHERE user_id = ${userId} AND committed_at >= ${lower}::timestamp
      AND committed_at < ${upper}::timestamp
      AND ${match([sql`message`, sql`repo_full_name`])}
      ${input.repo ? sql`AND repo_full_name = ${input.repo}` : sql``}`,
    spending: sql`SELECT id::text, 'spending'::text AS source, left(merchant, 300) AS title,
      left(concat_ws(' · ', amount::text || '원', category, override_note), 500) AS description,
      transacted_at AS occurred_at, transacted_at AS link_at, NULL::text AS repository, NULL::text AS sha,
      amount::float8 AS amount, category, NULL::float8 AS lat, NULL::float8 AS lon
      FROM transactions WHERE user_id = ${userId} AND transacted_at >= ${lower}::timestamp
      AND transacted_at < ${upper}::timestamp
      AND ${match([sql`merchant`, sql`category`, sql`override_note`])}
      ${input.category ? sql`AND category = ${input.category}` : sql``}`,
    visit: sql`SELECT v.id::text, 'visit'::text AS source,
      left(coalesce(p.name, v.place_name, v.address, '방문 기록'), 300) AS title,
      left(CASE
        WHEN v.address ~ '[가-힣]' THEN v.address
        WHEN coalesce(v.country_name, '대한민국') IN ('대한민국', '한국', 'South Korea', 'Korea')
          THEN coalesce(v.city, '')
        ELSE concat_ws(' · ', v.city, v.country_name)
      END, 500) AS description,
      greatest(v.start_time, ${lower}::timestamp) AS occurred_at, v.start_time AS link_at, NULL::text AS repository, NULL::text AS sha,
      NULL::float8 AS amount, NULL::text AS category,
      CASE WHEN v.address ~ '[가-힣]' OR coalesce(v.country_name, '대한민국') NOT IN ('대한민국', '한국', 'South Korea', 'Korea')
        THEN NULL ELSE v.center_lat END AS lat,
      v.center_lon AS lon
      FROM visits v LEFT JOIN saved_places p ON p.id = v.saved_place_id AND p.user_id = ${userId}
      WHERE v.user_id = ${userId} AND v.start_time < ${upper}::timestamp
      AND v.end_time >= ${lower}::timestamp
      AND ${match([sql`v.place_name`, sql`p.name`, sql`v.address`, sql`v.city`])}`,
    trip: sql`SELECT id::text, 'trip'::text AS source, left(name, 300) AS title,
      left(concat_ws(' · ', start_date || ' ~ ' || end_date, notes), 500) AS description,
      greatest(start_date, ${input.from})::timestamp - interval '9 hours' AS occurred_at, NULL::timestamp AS link_at, NULL::text AS repository, NULL::text AS sha,
      NULL::float8 AS amount, NULL::text AS category, NULL::float8 AS lat, NULL::float8 AS lon
      FROM trips WHERE user_id = ${userId} AND start_date <= ${input.to}
      AND end_date >= ${input.from}
      AND ${match([sql`name`, sql`notes`, sql`visited_cities`, sql`visited_countries`])}`,
  };
  // A category filter means "spending in that category" (a repository filter,
  // "commits in that repository"); an hour window can't
  // apply to trips (whole days), so both narrow the branch set.
  const eligible = (Object.keys(sources) as SearchItem["source"][]).filter(
    (key) =>
      (!input.category || key === "spending") &&
      (!input.repo || key === "commit") &&
      (!input.hours || key !== "trip")
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
  // "전체" collapses commits per KST day and repository to their newest three
  // rows (each row carries the group's full size), so one day's burst of commits
  // reads as a single group and can't fill the first page on its own, hiding
  // that period's spending and visits. A single-source tab keeps every row.
  const collapse = input.source === "all" && selected.length > 1;
  const [result, countRows] = await Promise.all([
    empty
      ? Promise.resolve({ rows: [] as Row[] })
      : db.execute<Row>(sql`
    WITH base AS (
      SELECT id, source, title, description, occurred_at, lat, lon,
        ${localDaySql(sql`occurred_at`)}::text AS date,
        ${localDaySql(sql`link_at`)}::text AS "linkDate", repository, sha, amount, category,
        to_char(coalesce(link_at, occurred_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "occurredAt",
        row_number() OVER (
          PARTITION BY ${localDaySql(sql`occurred_at`)}, source, repository
          ORDER BY occurred_at DESC, id ASC
        ) AS group_rank,
        count(*) OVER (PARTITION BY ${localDaySql(sql`occurred_at`)}, source, repository)::int
          AS group_total
      FROM (${union(selected)}) records
      ${hourFilter}
    ),
    page AS (
      SELECT * FROM base
      ${collapse ? sql`WHERE source <> 'commit' OR group_rank <= ${COLLAPSED_COMMITS}` : sql``}
      ORDER BY occurred_at DESC, source ASC, id ASC
      LIMIT ${PAGE_SIZE + 1} OFFSET ${(input.page - 1) * PAGE_SIZE}
    )
    SELECT page.id, page.source, page.title, page.description, page.date, page."linkDate",
      page.repository, page.sha, page.amount, page.category, page."occurredAt",
      CASE WHEN page.source = 'commit' THEN page.group_total END AS "groupTotal",
      ko.address AS "koreanAddress"
    FROM page
    LEFT JOIN LATERAL (
      -- Romanized geocodes (Google/Mapbox for a Korean coordinate) read badly next
      -- to Korean place names: borrow the nearest Korean address already cached
      -- within ~200 m. Only the visible page is looked up.
      SELECT pc.address FROM place_cache pc
      WHERE page.lat IS NOT NULL AND pc.address ~ '[가-힣]'
        AND pc.lat_key BETWEEN page.lat - 0.002 AND page.lat + 0.002
        AND pc.lon_key BETWEEN page.lon - 0.002 AND page.lon + 0.002
      ORDER BY (pc.lat_key - page.lat) ^ 2 + (pc.lon_key - page.lon) ^ 2
      LIMIT 1
    ) ko ON true
    ORDER BY page.occurred_at DESC, page.source ASC, page.id ASC
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
      .map(({ linkDate, repository, sha, amount, category, koreanAddress, groupTotal, ...row }) => {
        let href = `/dashboard?date=${encodeURIComponent(linkDate ?? row.date)}`;
        if (row.source === "trip") href = `/travel/${encodeURIComponent(row.id)}`;
        if (row.source === "commit" && repository && sha) {
          href = `https://github.com/${repository.split("/").map(encodeURIComponent).join("/")}/commit/${encodeURIComponent(sha)}`;
        }
        const description =
          row.source === "visit" ? visitRegion(koreanAddress ?? row.description) : row.description;
        return {
          ...row,
          description,
          amount: amount === null || amount === undefined ? null : Number(amount),
          category: category ?? null,
          repository: row.source === "commit" ? repository : null,
          ...(collapse && row.source === "commit" && groupTotal
            ? { groupTotal: Number(groupTotal) }
            : {}),
          href,
        };
      }),
    hasMore: input.page < 100 && result.rows.length > PAGE_SIZE,
    page: input.page,
    counts,
  };
}

/**
 * A visit's place line at neighbourhood level: "서울 강남구 논현동 193-4" →
 * "서울 강남구 논현동". Trailing lot/building numbers are noise in a result list.
 */
export function visitRegion(address: string): string {
  const parts = address.trim().split(/\s+/);
  while (parts.length > 1 && /^[\d-]+(번지)?$|^\d/.test(parts.at(-1) ?? "")) parts.pop();
  return parts.join(" ");
}
