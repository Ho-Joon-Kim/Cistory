import { type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { localDaySql } from "@/db/sql";
import { getKstDateWindow } from "@/lib/date-key";
import type { SearchInput, SearchItem, SearchResponse } from "./types";

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
      committed_at AS occurred_at, committed_at AS link_at, repo_full_name AS repository, sha
      FROM commits WHERE user_id = ${userId} AND committed_at >= ${lower}::timestamp
      AND committed_at < ${upper}::timestamp
      AND ${match([sql`message`, sql`repo_full_name`])}`,
    spending: sql`SELECT id::text, 'spending'::text AS source, left(merchant, 300) AS title,
      left(concat_ws(' · ', amount::text || '원', category, override_note), 500) AS description,
      transacted_at AS occurred_at, transacted_at AS link_at, NULL::text AS repository, NULL::text AS sha
      FROM transactions WHERE user_id = ${userId} AND transacted_at >= ${lower}::timestamp
      AND transacted_at < ${upper}::timestamp
      AND ${match([sql`merchant`, sql`category`, sql`override_note`])}`,
    visit: sql`SELECT v.id::text, 'visit'::text AS source,
      left(coalesce(p.name, v.place_name, v.address, '방문 기록'), 300) AS title,
      left(concat_ws(' · ', v.city, v.address), 500) AS description,
      greatest(v.start_time, ${lower}::timestamp) AS occurred_at, v.start_time AS link_at, NULL::text AS repository, NULL::text AS sha
      FROM visits v LEFT JOIN saved_places p ON p.id = v.saved_place_id AND p.user_id = ${userId}
      WHERE v.user_id = ${userId} AND v.start_time < ${upper}::timestamp
      AND v.end_time >= ${lower}::timestamp
      AND ${match([sql`v.place_name`, sql`p.name`, sql`v.address`, sql`v.city`])}`,
    trip: sql`SELECT id::text, 'trip'::text AS source, left(name, 300) AS title,
      left(concat_ws(' · ', start_date || ' ~ ' || end_date, notes), 500) AS description,
      greatest(start_date, ${input.from})::timestamp - interval '9 hours' AS occurred_at, NULL::timestamp AS link_at, NULL::text AS repository, NULL::text AS sha
      FROM trips WHERE user_id = ${userId} AND start_date <= ${input.to}
      AND end_date >= ${input.from}
      AND ${match([sql`name`, sql`notes`, sql`visited_cities`, sql`visited_countries`])}`,
  };
  const selected = input.source === "all" ? Object.values(sources) : [sources[input.source]];
  const result = await db.execute<
    Omit<SearchItem, "href"> & {
      linkDate: string | null;
      repository: string | null;
      sha: string | null;
    }
  >(sql`
    SELECT id, source, title, description,
      ${localDaySql(sql`occurred_at`)}::text AS date,
      ${localDaySql(sql`link_at`)}::text AS "linkDate", repository, sha
    FROM (${sql.join(selected, sql` UNION ALL `)}) records
    ORDER BY occurred_at DESC, source ASC, id ASC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${(input.page - 1) * PAGE_SIZE}
  `);
  return {
    items: result.rows.slice(0, PAGE_SIZE).map(({ linkDate, repository, sha, ...row }) => {
      let href = `/dashboard?date=${encodeURIComponent(linkDate ?? row.date)}`;
      if (row.source === "trip") href = `/travel/${encodeURIComponent(row.id)}`;
      if (row.source === "commit" && repository && sha) {
        href = `https://github.com/${repository.split("/").map(encodeURIComponent).join("/")}/commit/${encodeURIComponent(sha)}`;
      }
      return { ...row, href };
    }),
    hasMore: input.page < 100 && result.rows.length > PAGE_SIZE,
    page: input.page,
  };
}
