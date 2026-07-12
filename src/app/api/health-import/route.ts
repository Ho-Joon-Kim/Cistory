/**
 * On-device Health Connect import.
 *
 * POST /api/health-import?apikey={key}
 * Body: a JSON array of records, or { "records": [ ... ] }.
 *
 * Fed by a phone automation (MacroDroid/Tasker + a Health Connect reader) to
 * backfill sleep / exercise (and any scalar) that Google's cloud sync doesn't
 * carry to the Google Health API. Idempotent (onConflictDoNothing on the
 * (userId, metric, sampleAt, source) unique key), so re-pushing is safe.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getDb, healthSamples } from "@/db";
import type { NewHealthSample } from "@/db/schema";
import {
  bodyExceedsLimit,
  enforceRateLimit,
  logIngestionFailure,
  verifyApiKey,
} from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { parseImportBatch } from "@/modules/health/import";

// Larger than the shared 10KB ingestion cap — this is an authenticated push of
// the user's own history, sent in batches, so a bigger body is expected.
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const INSERT_CHUNK = 500;

export async function POST(request: NextRequest) {
  const rate = enforceRateLimit(request, "health-import");
  if (!rate.allowed) {
    logIngestionFailure("health-import", "rate_limited", request);
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const apikey = request.nextUrl.searchParams.get("apikey");
  const authed = await verifyApiKey(apikey, "healthImportApiKey");
  if (!authed) {
    logIngestionFailure("health-import", "auth_failed", request);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = await request.text();
  if (bodyExceedsLimit(text) && Buffer.byteLength(text, "utf8") > MAX_IMPORT_BODY_BYTES) {
    logIngestionFailure("health-import", "body_too_large", request);
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const rows = parseImportBatch(authed.id, body);
  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, received: 0 });
  }

  const db = getDb();
  let imported = 0;
  try {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk: NewHealthSample[] = rows.slice(i, i + INSERT_CHUNK);
      await db.insert(healthSamples).values(chunk).onConflictDoNothing();
      imported += chunk.length;
    }
  } catch (error) {
    logger.error("[health-import] insert failed", {
      userId: authed.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }

  logger.info("[health-import] imported", { userId: authed.id, rows: rows.length });
  return NextResponse.json({ imported, received: rows.length });
}
