import { describe, expect, it } from "vitest";
import { placeCache, savedPlaces } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { nearestKoreanAddresses } from "./saved-place-address";

// Far from any other test's coordinates: place_cache is global (no user_id), and
// other files' uncommitted rows are invisible anyway, but stay clear regardless.
const LAT = 33.1234;
const LON = 126.4321;

async function cache(db: TestDb, lat: number, lon: number, address: string) {
  await db.insert(placeCache).values({
    latKey: lat,
    lonKey: lon,
    placeName: address,
    address,
    provider: "kakao",
    resolvedAt: new Date(),
  });
}

async function place(db: TestDb, userId: string, lat = LAT, lon = LON) {
  const now = new Date();
  const [row] = await db
    .insert(savedPlaces)
    .values({
      userId,
      name: "회사",
      lat,
      lon,
      address: "Nonhyeon-dong, Gangnam-gu, Seoul",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: savedPlaces.id });
  return row.id;
}

describe("nearestKoreanAddresses against PostgreSQL", () => {
  const ctx = useTransactionalDb();

  it("picks the nearest Korean cached address within range, owner-scoped", async () => {
    const db = ctx.db();
    const me = await insertTestUser(db);
    const other = await insertTestUser(db);

    // Nearer but romanized / mixed: never chosen.
    await cache(db, LAT + 0.0001, LON, "Jeju-si, Jeju-do, South Korea");
    await cache(db, LAT, LON + 0.0001, "제주시 Yeon-dong 123");
    // Korean, in range: the farther one loses to the nearer one.
    await cache(db, LAT + 0.0015, LON, "제주 제주시 연동 먼곳");
    await cache(db, LAT + 0.0005, LON - 0.0005, "제주 제주시 연동 가까운곳");
    // Korean but out of range on one axis.
    const far = await place(db, me, LAT + 0.01, LON);
    await cache(db, LAT + 0.01, LON + 0.0025, "제주 제주시 범위밖");

    const mine = await place(db, me);
    const theirs = await place(db, other);

    const result = await nearestKoreanAddresses(db, me, [mine, far, theirs]);
    expect(result.get(mine)).toBe("제주 제주시 연동 가까운곳");
    // No Korean address within ±0.002° of it.
    expect(result.has(far)).toBe(false);
    // Another user's saved place is never resolved, even when its id is passed.
    expect(result.has(theirs)).toBe(false);
    expect(result.size).toBe(1);

    // The other user gets their own place resolved.
    const forOther = await nearestKoreanAddresses(db, other, [theirs, mine]);
    expect([...forOther]).toEqual([[theirs, "제주 제주시 연동 가까운곳"]]);
  });

  it("returns nothing without ids", async () => {
    const db = ctx.db();
    const me = await insertTestUser(db);
    expect((await nearestKoreanAddresses(db, me, [])).size).toBe(0);
  });
});
