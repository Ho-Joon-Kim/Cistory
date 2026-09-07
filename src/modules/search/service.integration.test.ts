import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commits, notificationLogs, savedPlaces, transactions, trips, visits } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { searchRecords } from "./service";
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
    const first = await searchRecords(ctx.db(), owner, input);
    const second = await searchRecords(ctx.db(), owner, { ...input, page: 2 });
    expect(first.items).toHaveLength(30);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(31);
    expect((await searchRecords(ctx.db(), owner, { ...input, source: "visit" })).items).toEqual([]);
  });
});
