/**
 * Google Health webhook notification parsing (pure; no DB, no network).
 *
 * Payload (developers.google.com/health/webhooks, 2026-11): a single object or a
 * JSON array of ≤ 99 items, each `{ data: { version, clientProvidedSubscriptionName,
 * healthUserId, operation: "UPSERT"|"DELETE", dataType, intervals[], recordId? } }`.
 * Each interval always carries `civilDateTimeInterval` + `civilIso8601TimeInterval`
 * (local wall time, no offset); `physicalTimeInterval` (UTC) is OMITTED for daily
 * rollups and all-day activity. Notifications carry no health values.
 *
 * Civil (offset-less) times are interpreted as KST: every point this account has
 * ever produced carries a +09:00 offset, and the whole app keys days in KST.
 */

/** Route body cap: 99 items × a few hundred bytes, with generous headroom. */
export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export type SignatureMode = "log-only" | "enforce";

/**
 * GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE. Anything but `enforce` is `log-only`:
 * the hand-rolled Tink verification runs and its outcome is logged, but a
 * failure doesn't reject until real notifications have been seen to verify.
 * The shared secret is enforced in both modes.
 */
export function signatureMode(env: NodeJS.ProcessEnv = process.env): SignatureMode {
  return env.GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE === "enforce" ? "enforce" : "log-only";
}

export interface WebhookInterval {
  start: Date;
  end: Date;
}

export interface WebhookNotification {
  healthUserId: string;
  dataType: string;
  operation: string;
  recordId: string;
  intervals: WebhookInterval[];
}

const KST_OFFSET = "+09:00";

function parseIsoInstant(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-07-14T00:00:00" (no offset) → that KST wall time as an instant. */
function parseCivilIso(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    return null;
  }
  return parseIsoInstant(`${v}${KST_OFFSET}`);
}

interface CivilDateTime {
  date?: { year?: unknown; month?: unknown; day?: unknown };
  time?: { hours?: unknown; minutes?: unknown; seconds?: unknown };
}

/** `{ date: {year,month,day}, time: {hours?,minutes?,seconds?} }` (KST) → instant. */
function parseCivilDateTime(v: unknown): Date | null {
  const c = v as CivilDateTime | undefined;
  const { year, month, day } = c?.date ?? {};
  if (typeof year !== "number" || typeof month !== "number" || typeof day !== "number") {
    return null;
  }
  const num = (x: unknown) => (typeof x === "number" ? x : 0);
  const ms = Date.UTC(
    year,
    month - 1,
    day,
    num(c?.time?.hours) - 9,
    num(c?.time?.minutes),
    num(c?.time?.seconds)
  );
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * One notification interval → a UTC instant range. Physical time wins; without
 * it (daily rollups) the civil bounds are read as KST, so a daily interval
 * "2026-07-14T00:00:00 → 2026-07-15T00:00:00" becomes [07-13T15:00Z, 07-14T15:00Z).
 */
export function intervalToRange(raw: unknown): WebhookInterval | null {
  const i = raw as {
    physicalTimeInterval?: { startTime?: unknown; endTime?: unknown };
    civilIso8601TimeInterval?: { startTime?: unknown; endTime?: unknown };
    civilDateTimeInterval?: { startDateTime?: unknown; endDateTime?: unknown };
  } | null;
  if (!i || typeof i !== "object") return null;
  const candidates: Array<[Date | null, Date | null]> = [
    [
      parseIsoInstant(i.physicalTimeInterval?.startTime),
      parseIsoInstant(i.physicalTimeInterval?.endTime),
    ],
    [
      parseCivilIso(i.civilIso8601TimeInterval?.startTime),
      parseCivilIso(i.civilIso8601TimeInterval?.endTime),
    ],
    [
      parseCivilDateTime(i.civilDateTimeInterval?.startDateTime),
      parseCivilDateTime(i.civilDateTimeInterval?.endDateTime),
    ],
  ];
  for (const [start, end] of candidates) {
    if (start && end && end.getTime() >= start.getTime()) return { start, end };
  }
  return null;
}

/** True for the endpoint-verification probe Google sends while creating a subscriber. */
export function isVerificationRequest(json: unknown): boolean {
  return (
    !!json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    (json as { type?: unknown }).type === "verification"
  );
}

/**
 * Normalize a notification body (object or array). Items without a user, data
 * type or any usable interval are dropped — counted by the caller from the
 * length difference, never logged with their contents.
 */
export function parseNotifications(json: unknown): {
  notifications: WebhookNotification[];
  dropped: number;
} {
  const items = Array.isArray(json) ? json : [json];
  const notifications: WebhookNotification[] = [];
  let dropped = 0;
  for (const item of items) {
    const d = (item as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
    const healthUserId = d?.healthUserId;
    const dataType = d?.dataType;
    if (typeof healthUserId !== "string" || !healthUserId || typeof dataType !== "string") {
      dropped++;
      continue;
    }
    const rawIntervals = Array.isArray(d?.intervals) ? d.intervals : [];
    const intervals = rawIntervals
      .map(intervalToRange)
      .filter((r): r is WebhookInterval => r !== null);
    if (intervals.length === 0) {
      dropped++;
      continue;
    }
    notifications.push({
      healthUserId,
      dataType,
      operation: typeof d?.operation === "string" ? d.operation : "UPSERT",
      recordId: typeof d?.recordId === "string" ? d.recordId : "",
      intervals,
    });
  }
  return { notifications, dropped };
}
