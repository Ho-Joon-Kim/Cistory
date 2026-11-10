import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, healthConnections } from "@/db";
import { enforceRateLimit, logIngestionFailure } from "@/lib/api-auth";
import {
  GOOGLE_HEALTH_SIGNATURE_HEADER,
  GoogleHealthKeysetVerifier,
  KeysetUnavailableError,
} from "@/lib/google-health-webhook-signature";
import { logger } from "@/lib/logger";
import { recordSourceSuccess } from "@/modules/data-status/telemetry";
import {
  isVerificationRequest,
  parseNotifications,
  signatureMode,
  WEBHOOK_MAX_BODY_BYTES,
  type WebhookNotification,
} from "@/modules/health/webhook";
import { enqueueWebhookEvents, type WebhookEventInput } from "@/modules/health/webhook-queue";

/**
 * POST /api/fitbit/webhook — Google Health API webhook receiver (web container).
 *
 * Verifies and enqueues ONLY: Google expects a fast 204 and retries anything
 * else for up to 7 days, and any Google API call or aggregation here would block
 * the web event loop. The cron container's health-webhook task does the work.
 *
 * Order (design §4b): body cap → raw bytes → shared-secret check (401; this is
 * also the verification handshake's "no credentials → 401" leg) → `{"type":
 * "verification"}` → 200 → ECDSA signature (GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE:
 * `log-only` by default, `enforce` rejects 401 / keyset outage 503) → map
 * healthUserId → user → enqueue → 204. DELETE notifications are logged and
 * ignored. Logs carry counts, data types and operations only — never the
 * healthUserId or interval times. Under /api/fitbit, so Sentry's health scrub
 * applies.
 */

const ENDPOINT = "fitbit-webhook";

const verifier = new GoogleHealthKeysetVerifier();
/** Process-lifetime signature outcome counters, logged with every verification. */
const signatureStats = { verified: 0, failed: 0, unavailable: 0 };

function secretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  // Digests are constant-length, so neither value's length leaks via timing.
  const a = createHash("sha256").update(header, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(a, b);
}

function reject(request: NextRequest, status: 401 | 413, reason: "auth_failed" | "body_too_large") {
  logIngestionFailure(ENDPOINT, reason, request);
  const limit = enforceRateLimit(request, "gh-webhook-unauth");
  if (!limit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
    });
  }
  return new NextResponse(null, { status });
}

/**
 * Verify the ECDSA signature and log the outcome with running totals. Returns a
 * response only when the request must be rejected (enforce mode).
 */
async function checkSignature(request: NextRequest, raw: Buffer): Promise<NextResponse | null> {
  const mode = signatureMode();
  const totals = () => ({
    totalVerified: signatureStats.verified,
    totalFailed: signatureStats.failed,
    totalUnavailable: signatureStats.unavailable,
  });
  try {
    const result = await verifier.verify(raw, request.headers.get(GOOGLE_HEALTH_SIGNATURE_HEADER));
    if (result.ok) signatureStats.verified++;
    else signatureStats.failed++;
    logger.info("[HealthWebhook] signature checked", {
      mode,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
      ...totals(),
    });
    return !result.ok && mode === "enforce" ? reject(request, 401, "auth_failed") : null;
  } catch (err) {
    signatureStats.unavailable++;
    logger.warn("[HealthWebhook] signing keyset unavailable", {
      mode,
      error: err instanceof Error ? err.message : String(err),
      ...totals(),
    });
    // Enforce: 503 so Google retries (it keeps notifications for 7 days).
    return mode === "enforce" && err instanceof KeysetUnavailableError
      ? new NextResponse(null, { status: 503 })
      : null;
  }
}

/**
 * Map each notification's healthUserId to an ACTIVE connection's user (one
 * batched lookup) and expand it to one queue row per interval.
 */
async function toEventRows(
  db: ReturnType<typeof getDb>,
  upserts: WebhookNotification[]
): Promise<{ rows: WebhookEventInput[]; unknownUser: number }> {
  const ids = [...new Set(upserts.map((n) => n.healthUserId))];
  const mapped = ids.length
    ? await db
        .select({ userId: healthConnections.userId, healthUserId: healthConnections.healthUserId })
        .from(healthConnections)
        .where(
          and(inArray(healthConnections.healthUserId, ids), eq(healthConnections.status, "active"))
        )
    : [];
  const userByHealthId = new Map(mapped.map((m) => [m.healthUserId, m.userId]));
  const rows: WebhookEventInput[] = [];
  let unknownUser = 0;
  for (const n of upserts) {
    const userId = userByHealthId.get(n.healthUserId);
    if (!userId) {
      unknownUser++;
      continue;
    }
    for (const interval of n.intervals) {
      rows.push({
        userId,
        dataType: n.dataType,
        operation: n.operation,
        rangeStart: interval.start,
        rangeEnd: interval.end,
        recordId: n.recordId,
      });
    }
  }
  return { rows, unknownUser };
}

export async function POST(request: NextRequest) {
  const advertised = Number(request.headers.get("content-length") ?? -1);
  if (Number.isFinite(advertised) && advertised > WEBHOOK_MAX_BODY_BYTES) {
    return reject(request, 413, "body_too_large");
  }
  // Raw bytes first: the signature covers the exact body, before any parsing.
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > WEBHOOK_MAX_BODY_BYTES) return reject(request, 413, "body_too_large");

  if (
    !secretMatches(request.headers.get("authorization"), process.env.GOOGLE_HEALTH_WEBHOOK_SECRET)
  ) {
    if (!process.env.GOOGLE_HEALTH_WEBHOOK_SECRET) {
      logger.warn("[HealthWebhook] GOOGLE_HEALTH_WEBHOOK_SECRET is unset; rejecting");
    }
    return reject(request, 401, "auth_failed");
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Endpoint verification: secret already matched. Google doesn't document a
  // signature on the probe, so none is required here.
  if (isVerificationRequest(json)) {
    logger.info("[HealthWebhook] verification request accepted");
    return new NextResponse(null, { status: 200 });
  }

  const signatureRejection = await checkSignature(request, raw);
  if (signatureRejection) return signatureRejection;

  const { notifications, dropped } = parseNotifications(json);
  const upserts = notifications.filter((n) => n.operation === "UPSERT");
  const deletes = notifications.length - upserts.length;

  const db = getDb();
  const { rows, unknownUser } = await toEventRows(db, upserts);

  const now = new Date();
  const enqueued = await enqueueWebhookEvents(db, rows, now);
  for (const userId of new Set(rows.map((r) => r.userId))) {
    await recordSourceSuccess(db, userId, "health", now);
  }

  logger.info("[HealthWebhook] notifications received", {
    items: notifications.length + dropped,
    enqueued,
    deletesIgnored: deletes,
    unknownUser,
    malformed: dropped,
    dataTypes: [...new Set(notifications.map((n) => n.dataType))],
  });
  return new NextResponse(null, { status: 204 });
}
