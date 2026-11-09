import { desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, savedPlaces } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

/**
 * Korean when it has Hangul and no romanized words: a fallback geocoder can mix
 * them ("목척7길 Jung-gu, Daejeon, South Korea"), which still reads as English.
 */
function isKoreanAddress(address: string | null): boolean {
  return !!address && /[가-힣]/.test(address) && !/[A-Za-z]{3,}/.test(address);
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const places = await db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, user.id))
      .orderBy(desc(savedPlaces.updatedAt));

    // Romanized geocodes ("Nonhyeon-dong, 06112, Gangnam-gu, …") read badly in a
    // Korean UI: offer the nearest Korean address already cached within ~200 m.
    const romanized = places.filter((p) => !isKoreanAddress(p.address));
    const korean = new Map<string, string>();
    if (romanized.length > 0) {
      const rows = await db.execute<{ id: string; address: string }>(sql`
        SELECT sp.id, ko.address FROM saved_places sp
        CROSS JOIN LATERAL (
          SELECT pc.address FROM place_cache pc
          WHERE pc.address ~ '[가-힣]' AND pc.address !~ '[A-Za-z]{3,}'
            AND pc.lat_key BETWEEN sp.lat - 0.002 AND sp.lat + 0.002
            AND pc.lon_key BETWEEN sp.lon - 0.002 AND sp.lon + 0.002
          ORDER BY (pc.lat_key - sp.lat) ^ 2 + (pc.lon_key - sp.lon) ^ 2
          LIMIT 1
        ) ko
        WHERE sp.user_id = ${user.id}
          AND sp.id IN (${sql.join(
            romanized.map((p) => sql`${p.id}::uuid`),
            sql`, `
          )})`);
      for (const row of rows.rows) korean.set(row.id, row.address);
    }

    return NextResponse.json({
      places: places.map((p) => ({
        ...p,
        displayAddress: isKoreanAddress(p.address)
          ? p.address
          : (korean.get(p.id) ?? p.address ?? null),
      })),
    });
  } catch (error) {
    logger.error("Saved places GET error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "저장된 장소를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { name, lat, lon, radiusM, category, address } = body;

    if (!name || typeof name !== "string" || name.length < 1 || name.length > 100) {
      return NextResponse.json({ error: "이름은 1~100자 사이여야 합니다" }, { status: 400 });
    }

    if (typeof lat !== "number" || typeof lon !== "number") {
      return NextResponse.json({ error: "위도와 경도가 필요합니다" }, { status: 400 });
    }

    const radius = typeof radiusM === "number" ? Math.min(500, Math.max(50, radiusM)) : 100;
    const now = new Date();

    const db = getDb();
    const [place] = await db
      .insert(savedPlaces)
      .values({
        userId: user.id,
        name: name.trim(),
        lat,
        lon,
        radiusM: radius,
        category: category || null,
        address: address || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ place }, { status: 201 });
  } catch (error) {
    logger.error("Saved places POST error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "장소를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
