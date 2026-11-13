/**
 * Saved-place reads and writes shared by the web routes and the MCP tools.
 *
 * Updates and deletes run under the per-user trip write lock, since a saved
 * place's trip-exclusion settings feed trip detection.
 */

import { and, desc, eq } from "drizzle-orm";
import { type Database, getDb, savedPlaces } from "@/db";
import type { InTxHook, WriteOptions } from "@/lib/write-hook";
import { isKoreanAddress, nearestKoreanAddresses } from "./services/saved-place-address";
import { withTripWriteLock } from "./services/trip-writer";

export type SavedPlace = typeof savedPlaces.$inferSelect;
export type SavedPlaceView = SavedPlace & { displayAddress: string | null };

type ParseResult<T> = { value: T } | { error: string };

const noop: InTxHook<SavedPlace> = async () => {};

/** Every saved place of the user, most recently updated first. */
export async function listSavedPlaces(
  userId: string,
  database: Database = getDb()
): Promise<SavedPlaceView[]> {
  const places = await database
    .select()
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId))
    .orderBy(desc(savedPlaces.updatedAt));

  // Romanized geocodes ("Nonhyeon-dong, 06112, Gangnam-gu, …") read badly in a
  // Korean UI: offer the nearest Korean address already cached within ~200 m.
  const romanized = places.filter((p) => !isKoreanAddress(p.address));
  const korean = await nearestKoreanAddresses(
    database,
    userId,
    romanized.map((p) => p.id)
  );

  return places.map((p) => ({
    ...p,
    displayAddress: isKoreanAddress(p.address)
      ? p.address
      : (korean.get(p.id) ?? p.address ?? null),
  }));
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface SavedPlaceCreateInput {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  category: string | null;
  address: string | null;
}

/** Validates and normalizes a create request body (radius clamped to 50–500m). */
export function parseSavedPlaceCreate(
  body: Record<string, unknown>
): ParseResult<SavedPlaceCreateInput> {
  const { name, lat, lon, radiusM, category, address } = body;
  if (!name || typeof name !== "string" || name.length < 1 || name.length > 100) {
    return { error: "이름은 1~100자 사이여야 합니다" };
  }
  if (typeof lat !== "number" || typeof lon !== "number") {
    return { error: "위도와 경도가 필요합니다" };
  }
  return {
    value: {
      name: name.trim(),
      lat,
      lon,
      radiusM: typeof radiusM === "number" ? Math.min(500, Math.max(50, radiusM)) : 100,
      category: (category as string) || null,
      address: (address as string) || null,
    },
  };
}

export async function createSavedPlace(
  userId: string,
  input: SavedPlaceCreateInput,
  { inTx = noop, database = getDb() }: WriteOptions<SavedPlace> = {}
): Promise<SavedPlace> {
  const now = new Date();
  return database.transaction(async (tx) => {
    const [place] = await tx
      .insert(savedPlaces)
      .values({
        userId,
        name: input.name,
        lat: input.lat,
        lon: input.lon,
        radiusM: input.radiusM,
        category: input.category,
        address: input.address,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await inTx(tx, { before: null, after: place ?? null });
    return place;
  });
}

// ── Update ──────────────────────────────────────────────────────────────────

export type SavedPlaceUpdates = Partial<
  Pick<
    SavedPlace,
    | "name"
    | "lat"
    | "lon"
    | "radiusM"
    | "category"
    | "address"
    | "excludeFromTrips"
    | "tripExclusionRadiusM"
  >
>;

function parseBasicPlaceUpdates(body: Record<string, unknown>): ParseResult<SavedPlaceUpdates> {
  const updates: SavedPlaceUpdates = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 100) {
      return { error: "이름은 1~100자 사이여야 합니다" };
    }
    updates.name = body.name.trim();
  }
  if (typeof body.lat === "number") updates.lat = body.lat;
  if (typeof body.lon === "number") updates.lon = body.lon;
  if (typeof body.radiusM === "number") {
    updates.radiusM = Math.min(500, Math.max(50, body.radiusM));
  }
  if (body.category !== undefined) updates.category = (body.category as string) || null;
  if (body.address !== undefined) updates.address = (body.address as string) || null;
  return { value: updates };
}

function parseTripExclusionUpdates(body: Record<string, unknown>): ParseResult<SavedPlaceUpdates> {
  const updates: SavedPlaceUpdates = {};
  if (body.excludeFromTrips !== undefined) {
    if (typeof body.excludeFromTrips !== "boolean") {
      return { error: "여행 감지 제외 여부는 boolean이어야 합니다" };
    }
    updates.excludeFromTrips = body.excludeFromTrips;
  }
  if (body.tripExclusionRadiusM !== undefined) {
    if (
      body.tripExclusionRadiusM !== null &&
      (!Number.isInteger(body.tripExclusionRadiusM) ||
        (body.tripExclusionRadiusM as number) < 1_000 ||
        (body.tripExclusionRadiusM as number) > 100_000)
    ) {
      return { error: "여행 제외 반경은 1,000~100,000m 사이여야 합니다" };
    }
    updates.tripExclusionRadiusM = body.tripExclusionRadiusM as number | null;
  }
  return { value: updates };
}

/** Validates an update body. An empty update is an error. */
export function parseSavedPlaceUpdate(
  body: Record<string, unknown>
): ParseResult<SavedPlaceUpdates> {
  const basic = parseBasicPlaceUpdates(body);
  if ("error" in basic) return basic;
  const exclusion = parseTripExclusionUpdates(body);
  if ("error" in exclusion) return exclusion;
  const updates = { ...basic.value, ...exclusion.value };
  if (Object.keys(updates).length === 0) return { error: "수정할 항목이 없습니다" };
  return { value: updates };
}

/** Applies `updates` to the owner's place. Null when it doesn't exist (or isn't theirs). */
export async function updateSavedPlace(
  userId: string,
  placeId: string,
  updates: SavedPlaceUpdates,
  { inTx = noop, database = getDb() }: WriteOptions<SavedPlace> = {}
): Promise<SavedPlace | null> {
  return withTripWriteLock(
    userId,
    async (tx) => {
      const where = and(eq(savedPlaces.id, placeId), eq(savedPlaces.userId, userId));
      const [before] = await tx.select().from(savedPlaces).where(where);
      if (!before) return null;
      const [updated] = await tx
        .update(savedPlaces)
        .set({ ...updates, updatedAt: new Date() })
        .where(where)
        .returning();
      if (!updated) return null;
      await inTx(tx, { before, after: updated });
      return updated;
    },
    database
  );
}

// ── Delete ──────────────────────────────────────────────────────────────────

/** Deletes the owner's place, returning the deleted row (null when absent). */
export async function deleteSavedPlace(
  userId: string,
  placeId: string,
  { inTx = noop, database = getDb() }: WriteOptions<SavedPlace> = {}
): Promise<SavedPlace | null> {
  return withTripWriteLock(
    userId,
    async (tx) => {
      const [row] = await tx
        .delete(savedPlaces)
        .where(and(eq(savedPlaces.id, placeId), eq(savedPlaces.userId, userId)))
        .returning();
      if (!row) return null;
      await inTx(tx, { before: row, after: null });
      return row;
    },
    database
  );
}
