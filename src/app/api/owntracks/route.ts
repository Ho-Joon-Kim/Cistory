/**
 * OwnTracks Data Ingestion API
 *
 * POST /api/owntracks?apikey={key}
 * Receives location data from OwnTracks app.
 * Authentication via API key in query parameter.
 * Always returns [] per OwnTracks protocol.
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { locationPoints, users } from "@/db/schema";
import { logger } from "@/lib/logger";

interface OwnTracksPayload {
  _type: string;
  lat: number;
  lon: number;
  acc?: number;
  alt?: number;
  vel?: number;
  batt?: number;
  tid?: string;
  t?: string;
  tst: number;
}

const EMPTY_RESPONSE = NextResponse.json([]);

export async function POST(request: NextRequest) {
  try {
    const apikey = request.nextUrl.searchParams.get("apikey");
    if (!apikey) {
      return EMPTY_RESPONSE;
    }

    const db = getDb();

    const userResult = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.ownTracksApiKey, apikey))
      .limit(1);

    if (userResult.length === 0) {
      return EMPTY_RESPONSE;
    }

    const userId = userResult[0].id;
    const body = (await request.json()) as OwnTracksPayload | OwnTracksPayload[];

    const payloads = Array.isArray(body) ? body : [body];
    const locationPayloads = payloads.filter((p) => p._type === "location");

    if (locationPayloads.length === 0) {
      return EMPTY_RESPONSE;
    }

    const now = new Date();
    const rows = locationPayloads.map((p) => ({
      userId,
      lat: p.lat,
      lon: p.lon,
      accuracy: p.acc ?? null,
      altitude: p.alt ?? null,
      velocity: p.vel ?? null,
      battery: p.batt ?? null,
      trackerId: p.tid ?? null,
      trigger: p.t ?? null,
      timestamp: new Date(p.tst * 1000),
      createdAt: now,
    }));

    await db.insert(locationPoints).values(rows).onConflictDoNothing();

    // Update user's last known location (most recent by timestamp)
    const latest = rows.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    await db
      .update(users)
      .set({ lastLat: latest.lat, lastLon: latest.lon, updatedAt: now })
      .where(eq(users.id, userId));

    return EMPTY_RESPONSE;
  } catch (error) {
    logger.error("OwnTracks ingestion error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_RESPONSE;
  }
}
