/**
 * OwnTracks Data Ingestion API
 *
 * POST /api/owntracks?apikey={key}
 * Receives location data from OwnTracks app.
 * Authentication via API key in query parameter.
 * Always returns [] per OwnTracks protocol (silent on auth failure).
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { locationPoints, users } from "@/db/schema";
import {
  bodyExceedsLimit,
  checkBodySize,
  enforceRateLimit,
  logIngestionFailure,
  verifyApiKey,
} from "@/lib/api-auth";
import { roundCoord } from "@/lib/geo";
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

// NextResponse wraps a ReadableStream body that is consumed on first send,
// so a module-level singleton would return an empty body on every request
// after the first — OwnTracks then fails to parse `[]` as JSON and re-queues
// the message indefinitely. Always build a fresh response per request.
const emptyResponse = () => NextResponse.json([]);

export async function POST(request: NextRequest) {
  try {
    const body = checkBodySize(request);
    if (!body.ok) {
      logIngestionFailure("owntracks", "body_too_large", request);
      // Still return OwnTracks-compatible response shape
      return emptyResponse();
    }

    const rate = enforceRateLimit(request, "owntracks");
    if (!rate.allowed) {
      logIngestionFailure("owntracks", "rate_limited", request);
      return emptyResponse();
    }

    const apikey = request.nextUrl.searchParams.get("apikey");
    const authed = await verifyApiKey(apikey, "ownTracksApiKey");
    if (!authed) {
      logIngestionFailure("owntracks", "auth_failed", request);
      return emptyResponse();
    }

    const userId = authed.id;
    const db = getDb();

    // Content-Length can be omitted or understated — re-check the actual body.
    const rawBody = await request.text();
    if (bodyExceedsLimit(rawBody)) {
      logIngestionFailure("owntracks", "body_too_large", request);
      return emptyResponse();
    }
    const payload = JSON.parse(rawBody) as OwnTracksPayload | OwnTracksPayload[];

    const payloads = Array.isArray(payload) ? payload : [payload];
    const locationPayloads = payloads.filter((p) => p._type === "location");

    if (locationPayloads.length === 0) {
      return emptyResponse();
    }

    const now = new Date();
    const rows = locationPayloads.map((p) => ({
      userId,
      lat: roundCoord(p.lat),
      lon: roundCoord(p.lon),
      accuracy: p.acc ?? null,
      altitude: p.alt ?? null,
      velocity: p.vel ?? null,
      battery: p.batt ?? null,
      trackerId: p.tid ?? null,
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

    return emptyResponse();
  } catch (error) {
    logger.error("OwnTracks ingestion error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return emptyResponse();
  }
}
