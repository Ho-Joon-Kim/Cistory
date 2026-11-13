import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { commits, notificationLogs, savedPlaces, transactions, trips, visits } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { findSpendingMatchEvidence, searchRecords } from "./service";
import type { SearchInput } from "./types";

const input: SearchInput = { from: "2026-09-02", to: "2026-09-02", q: "", source: "all", page: 1 };
const now = new Date("2026-09-02T03:00:00Z");
describe("unified record search against PostgreSQL", () => {
  const ctx = useTransactionalDb();
  const commit = async (userId: string, at: string, message = "commit", id = randomUUID()) => {
    await ctx
      .db()
      .insert(commits)
      .values({
        id,
        userId,
        sha: randomUUID(),
        authorName: "fixture",
        message,
        committedAt: new Date(at),
        createdAt: now,
        repoFullName: "owner/repository",
      });
    return id;
  };
  it("isolates all sources by owner, joins saved names by owner, and includes interval overlaps", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    const other = await insertTestUser(db);
    const [otherPlace] = await db
      .insert(savedPlaces)
      .values({
        userId: other,
        name: "private foreign place",
        lat: 0,
        lon: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    for (const userId of [owner, other]) {
      await commit(userId, now.toISOString());
      const [log] = await db
        .insert(notificationLogs)
        .values({ userId, rawPayload: "{}", receivedAt: now })
        .returning();
      await db.insert(transactions).values({
        userId,
        notificationLogId: log.id,
        type: "withdrawal",
        amount: 1000,
        merchant: "shop",
        accountName: "fixture",
        rawTitle: "",
        rawText: "",
        transactedAt: now,
        createdAt: now,
      });
      await db.insert(visits).values({
        userId,
        centerLat: 0,
        centerLon: 0,
        radiusM: 10,
        startTime: new Date("2026-09-01T03:00:00Z"),
        endTime: now,
        durationSeconds: 86400,
        placeName: "visible place",
        savedPlaceId: otherPlace.id,
        calculatedAt: now,
      });
      await db.insert(trips).values({
        userId,
        name: "trip",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        createdAt: now,
        updatedAt: now,
      });
    }
    const result = await searchRecords(db, owner, input);
    expect(result.items).toHaveLength(4);
    expect(new Set(result.items.map((item) => item.source))).toEqual(
      new Set(["commit", "spending", "visit", "trip"])
    );
    expect(result.items.every((item) => item.date === input.from)).toBe(true);
    expect(result.items.find((item) => item.source === "visit")?.title).toBe("visible place");
    expect(result.items.find((item) => item.source === "visit")?.href).toBe(
      "/dashboard?date=2026-09-01"
    );
    expect(result.items.find((item) => item.source === "commit")?.href).toMatch(
      /^https:\/\/github\.com\/owner\/repository\/commit\//
    );
    expect((await searchRecords(db, owner, { ...input, q: "private foreign" })).items).toEqual([]);
    const [ownPlace] = await db
      .insert(savedPlaces)
      .values({
        userId: owner,
        name: "renamed place",
        lat: 1,
        lon: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db.insert(visits).values({
      userId: owner,
      centerLat: 1,
      centerLon: 1,
      radiusM: 10,
      startTime: now,
      endTime: now,
      durationSeconds: 0,
      savedPlaceId: ownPlace.id,
      calculatedAt: now,
    });
    expect((await searchRecords(db, owner, { ...input, q: "renamed" })).items[0].title).toBe(
      "renamed place"
    );
  });
  it("uses exact inclusive KST days even with a non-UTC database session", async () => {
    await ctx.client().query("SET LOCAL TIME ZONE 'America/New_York'");
    const owner = await insertTestUser(ctx.db());
    await commit(owner, "2026-09-01T14:59:59.999Z", "before");
    const first = await commit(owner, "2026-09-01T15:00:00Z", "start");
    const last = await commit(owner, "2026-09-02T14:59:59.999Z", "end");
    await commit(owner, "2026-09-02T15:00:00Z", "after");
    expect((await searchRecords(ctx.db(), owner, input)).items.map((item) => item.id)).toEqual([
      last,
      first,
    ]);
  });
  it("treats SQL wildcard and quote characters literally and matches case-insensitively", async () => {
    const owner = await insertTestUser(ctx.db());
    await commit(owner, now.toISOString(), "100%_\\O'Reilly");
    await commit(owner, now.toISOString(), "100xxO'Reilly");
    expect(
      (await searchRecords(ctx.db(), owner, { ...input, q: "100%_\\o'reilly" })).items
    ).toHaveLength(1);
    expect(
      (await searchRecords(ctx.db(), owner, { ...input, q: "' OR true --" })).items
    ).toHaveLength(0);
  });
  it("paginates tied timestamps deterministically without duplicates and filters source", async () => {
    const owner = await insertTestUser(ctx.db());
    for (let n = 0; n < 31; n++) await commit(owner, now.toISOString(), "tie");
    const commitsOnly = { ...input, source: "commit" as const };
    const first = await searchRecords(ctx.db(), owner, commitsOnly);
    const second = await searchRecords(ctx.db(), owner, { ...commitsOnly, page: 2 });
    expect(first.items).toHaveLength(30);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(31);
    expect((await searchRecords(ctx.db(), owner, { ...input, source: "visit" })).items).toEqual([]);
  });
  it("counts every source, filters by KST hour window and spending category", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    // 09:00 KST and 21:30 KST on 2026-09-02.
    await commit(owner, "2026-09-02T00:00:00Z", "morning");
    await commit(owner, "2026-09-02T12:30:00Z", "evening");
    for (const [category, at] of [
      ["food", "2026-09-02T12:00:00Z"],
      ["cafe", "2026-09-02T01:00:00Z"],
    ] as const) {
      const [log] = await db
        .insert(notificationLogs)
        .values({ userId: owner, rawPayload: "{}", receivedAt: now })
        .returning();
      await db.insert(transactions).values({
        userId: owner,
        notificationLogId: log.id,
        type: "withdrawal",
        amount: 16400,
        merchant: `${category} shop`,
        accountName: "fixture",
        rawTitle: "",
        rawText: "",
        category,
        transactedAt: new Date(at),
        createdAt: now,
      });
    }
    const all = await searchRecords(db, owner, input);
    expect(all.counts).toEqual({ commit: 2, spending: 2, visit: 0, trip: 0 });
    const spend = all.items.find((item) => item.source === "spending");
    expect(spend?.amount).toBe(16400);
    expect(all.items.find((item) => item.title === "evening")?.repository).toBe("owner/repository");
    const evening = await searchRecords(db, owner, { ...input, hours: { from: 18, to: 24 } });
    expect(evening.items.map((item) => item.title).sort()).toEqual(["evening", "food shop"]);
    expect(evening.counts).toEqual({ commit: 1, spending: 1, visit: 0, trip: 0 });
    const food = await searchRecords(db, owner, { ...input, category: "food" });
    expect(food.items.map((item) => item.title)).toEqual(["food shop"]);
    expect(food.counts).toEqual({ commit: 0, spending: 1, visit: 0, trip: 0 });
  });
  it("collapses a day's commits per repository in the mixed view and filters by repository", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    for (let n = 0; n < 40; n++) {
      await commit(owner, new Date(now.getTime() - n * 60_000).toISOString(), `c${n}`);
    }
    await db.insert(commits).values({
      id: randomUUID(),
      userId: owner,
      sha: randomUUID(),
      authorName: "fixture",
      message: "other repo",
      committedAt: now,
      createdAt: now,
      repoFullName: "owner/other",
    });
    const [log] = await db
      .insert(notificationLogs)
      .values({ userId: owner, rawPayload: "{}", receivedAt: now })
      .returning();
    await db.insert(transactions).values({
      userId: owner,
      notificationLogId: log.id,
      type: "withdrawal",
      amount: 5000,
      merchant: "early shop",
      accountName: "fixture",
      rawTitle: "",
      rawText: "",
      transactedAt: new Date(now.getTime() - 60 * 60_000),
      createdAt: now,
    });
    const mixed = await searchRecords(db, owner, input);
    const repoRows = mixed.items.filter((i) => i.repository === "owner/repository");
    expect(repoRows).toHaveLength(3);
    expect(repoRows.every((i) => i.groupTotal === 40)).toBe(true);
    // Type counts cover the whole day's group, not the three rows shown.
    expect(repoRows[0].groupTypes).toEqual({ other: 40 });
    expect(mixed.items.some((i) => i.title === "early shop")).toBe(true);
    expect(mixed.hasMore).toBe(false);
    expect(mixed.counts?.commit).toBe(41);
    const onlyCommits = await searchRecords(db, owner, { ...input, source: "commit" });
    expect(onlyCommits.items).toHaveLength(30);
    expect(onlyCommits.items[0].groupTotal).toBeUndefined();
    // "other repo" shares c0's timestamp, so pick the repository row explicitly.
    const firstRepoCommit = onlyCommits.items.find((i) => i.repository === "owner/repository");
    expect(firstRepoCommit?.groupTypes).toEqual({ other: 40 });
    const repo = await searchRecords(db, owner, { ...input, repo: "owner/other" });
    expect(repo.items.map((i) => i.title)).toEqual(["other repo"]);
    expect(repo.counts).toEqual({ commit: 1, spending: 0, visit: 0, trip: 0 });
  });
  it("prefers a nearby Korean address over a romanized geocode for visits", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    await db.execute(sql`INSERT INTO place_cache (lat_key, lon_key, place_name, address, provider, resolved_at)
      VALUES (37.5081, 127.0312, '', '서울 강남구 논현동 193-4', 'kakao', now())
      ON CONFLICT DO NOTHING`);
    await db.insert(visits).values({
      userId: owner,
      centerLat: 37.508313,
      centerLon: 127.031434,
      radiusM: 10,
      startTime: now,
      endTime: now,
      durationSeconds: 0,
      placeName: "집",
      city: "서울",
      countryName: "대한민국",
      address: "Nonhyeon-dong, 06112, Gangnam-gu, Seoul, South Korea",
      calculatedAt: now,
    });
    const result = await searchRecords(db, owner, { ...input, source: "visit" });
    expect(result.items[0].description).toBe("서울 강남구 논현동");
  });
  it("excludes opted-out spending ids from the page and counts, owner-scoped evidence", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    const other = await insertTestUser(db);
    const tx = async (userId: string, merchant: string, rawTitle: string) => {
      const [log] = await db
        .insert(notificationLogs)
        .values({ userId, rawPayload: "{}", receivedAt: now })
        .returning();
      const [row] = await db
        .insert(transactions)
        .values({
          userId,
          notificationLogId: log.id,
          type: "deposit",
          amount: 30000,
          merchant,
          accountName: "fixture",
          rawTitle,
          rawText: "",
          transactedAt: now,
          createdAt: now,
        })
        .returning();
      return row.id;
    };
    const transfer = await tx(owner, "김철수", "김철수님이 30,000원을 보냈어요");
    const card = await tx(owner, "김밥천국", "30,000원 결제");
    await tx(other, "김영희", "김영희님이 30,000원을 보냈어요");

    const evidence = await findSpendingMatchEvidence(db, owner, { ...input, q: "김" });
    expect(evidence.map((e) => e.id).sort()).toEqual([transfer, card].sort());
    expect(evidence.find((e) => e.id === transfer)?.rawTitle).toBe(
      "김철수님이 30,000원을 보냈어요"
    );
    expect(await findSpendingMatchEvidence(db, owner, input)).toEqual([]);

    const all = await searchRecords(db, owner, { ...input, q: "김" });
    expect(all.counts?.spending).toBe(2);
    const hidden = await searchRecords(
      db,
      owner,
      { ...input, q: "김" },
      { excludeSpendingIds: [transfer] }
    );
    expect(hidden.items.map((i) => i.id)).toEqual([card]);
    expect(hidden.counts?.spending).toBe(1);
  });
});
