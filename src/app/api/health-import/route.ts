/**
 * On-device Health Connect import.
 *
 * POST /api/health-import?apikey={key}   — ingest (phone automation, API key)
 *   Body: a JSON array of records, or { "records": [ ... ] }.
 * GET  /api/health-import                — verify (browser, session) what landed
 *
 * Fed by a phone automation (MacroDroid/Tasker + a Health Connect reader) to
 * backfill sleep / exercise (and any scalar) that Google's cloud sync doesn't
 * carry to the Google Health API. Idempotent (onConflictDoNothing on the
 * (userId, metric, sampleAt, source) unique key), so re-pushing is safe.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, healthSamples } from "@/db";
import type { NewHealthSample } from "@/db/schema";
import {
  bodyExceedsLimit,
  enforceRateLimit,
  logIngestionFailure,
  verifyApiKey,
} from "@/lib/api-auth";
import { withAuth } from "@/lib/api-handler";
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
    return NextResponse.json(
      { error: "invalid JSON", bytes: Buffer.byteLength(text) },
      { status: 400 }
    );
  }

  // The plugin reads one record type per call and emits UNLABELED records, so let
  // the caller name it via ?type= / ?metric= (falls back to field inference).
  const typeHint =
    request.nextUrl.searchParams.get("type") ?? request.nextUrl.searchParams.get("metric");
  const rows = parseImportBatch(authed.id, body, typeHint);
  if (rows.length === 0) {
    // Body arrived but nothing parsed — log the shape (keys only, no values) so a
    // record-shape mismatch on the phone side can be diagnosed.
    const sample = Array.isArray(body) ? body[0] : (body as { records?: unknown[] })?.records?.[0];
    logger.warn("[health-import] parsed 0 records", {
      userId: authed.id,
      bytes: Buffer.byteLength(text),
      typeHint,
      firstKeys:
        sample && typeof sample === "object" ? Object.keys(sample as object) : typeof sample,
    });
    return NextResponse.json({
      imported: 0,
      received: 0,
      hint: "0 records parsed — add ?type=<RecordType> to the URL or check the JSON shape",
    });
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

/**
 * Verification view — open in a browser while signed in. Shows what's actually in
 * health_samples per metric (count + date range) + the newest sleep rows, so the
 * import can be confirmed without digging through logs.
 */
export const GET = withAuth(async ({ user }) => {
  const db = getDb();

  const byMetric = await db
    .select({
      metric: healthSamples.metric,
      count: sql<number>`count(*)::int`,
      earliest: sql<string>`min(sample_at)::text`,
      latest: sql<string>`max(sample_at)::text`,
    })
    .from(healthSamples)
    .where(eq(healthSamples.userId, user.id))
    .groupBy(healthSamples.metric);

  const recentSleep = await db
    .select({
      sampleAt: sql<string>`sample_at::text`,
      minutes: healthSamples.value,
      source: healthSamples.source,
    })
    .from(healthSamples)
    .where(and(eq(healthSamples.userId, user.id), eq(healthSamples.metric, "sleep")))
    .orderBy(desc(healthSamples.sampleAt))
    .limit(5);

  return NextResponse.json({
    byMetric: byMetric.sort((a, b) => a.metric.localeCompare(b.metric)),
    recentSleep,
  });
});
