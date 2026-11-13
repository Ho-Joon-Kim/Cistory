/**
 * Shared pieces for the U7 read tools: annotations, input fragments, paging
 * cursors and small output helpers. Everything here is pure.
 */

import { z } from "zod";
import type { ArgRules } from "../audit";
import { McpInputError } from "../errors";
import type { McpToolAnnotations } from "../server";
import { isDateKey, parseTimeRange, type TimeRange, toKstIso } from "../time";

export const READ_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const PAGE_DEFAULT_LIMIT = 100;
export const PAGE_MAX_LIMIT = 500;

export const NO_RECORDS = "기록 없음";

const FROM_DESCRIPTION =
  "시작. YYYY-MM-DD(한국 시간 하루의 시작) 또는 오프셋이 있는 ISO 시각(예: 2026-11-13T09:00:00+09:00).";
const TO_DESCRIPTION =
  "끝. YYYY-MM-DD(그날 하루 전체 포함) 또는 오프셋이 있는 ISO 시각(그 시각 미포함). 생략하면 오늘까지.";

/** `{ from?, to? }` input fields accepting a date key or an offset instant. */
export const rangeFields = {
  from: z.string().max(40).optional().describe(FROM_DESCRIPTION),
  to: z.string().max(40).optional().describe(TO_DESCRIPTION),
};

/** `{ from?, to? }` input fields that accept KST dates only. */
export const dayRangeFields = {
  from: z.string().max(40).optional().describe("시작 날짜 YYYY-MM-DD (한국 시간)."),
  to: z.string().max(40).optional().describe("끝 날짜 YYYY-MM-DD (그날 포함, 한국 시간)."),
};

export function limitField(defaultLimit = PAGE_DEFAULT_LIMIT, max = PAGE_MAX_LIMIT) {
  return z
    .number()
    .int()
    .min(1)
    .max(max)
    .optional()
    .describe(`한 번에 받을 건수 (기본 ${defaultLimit}, 최대 ${max}).`);
}

export const cursorField = z
  .string()
  .max(512)
  .optional()
  .describe("이전 응답의 nextCursor. 같은 기간·조건으로 다음 페이지를 받을 때만 넘기세요.");

/** Audit rules shared by range/paging inputs (enum-like values are kept). */
export const RANGE_ARG_RULES: ArgRules = { from: "keep", to: "keep", limit: "keep" };

/**
 * Parse a date-only range (each bound must be `YYYY-MM-DD`). Instants are
 * rejected because the underlying query works in whole KST days.
 */
export function parseDayRange(
  input: { from?: string | null; to?: string | null },
  options: { defaultDays: number; maxDays?: number; now: Date }
): TimeRange {
  for (const [field, value] of [
    ["from", input.from],
    ["to", input.to],
  ] as const) {
    if (value != null && !isDateKey(value.trim())) {
      throw new McpInputError(
        `${field}: 이 도구는 날짜만 받습니다. YYYY-MM-DD(한국 시간)로 입력하세요.`,
        "date_only"
      );
    }
  }
  return parseTimeRange(
    { from: input.from?.trim(), to: input.to?.trim() },
    { defaultDays: options.defaultDays, maxDays: options.maxDays, now: options.now }
  );
}

// ── Opaque cursors ───────────────────────────────────────────────────────────

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function invalidCursor(): McpInputError {
  return new McpInputError(
    "cursor가 올바르지 않습니다. 이전 응답의 nextCursor를 그대로 넘기세요.",
    "invalid_cursor"
  );
}

/** Decode a cursor and validate it; throws a Korean input error when it doesn't parse. */
export function decodeCursor<T>(value: string, validate: (raw: unknown) => T | null): T {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const parsed = validate(raw);
  if (parsed === null) throw invalidCursor();
  return parsed;
}

/** An offset cursor (`{ o: n }`) for services that page by offset. */
export function decodeOffsetCursor(value: string | undefined, max = 1_000_000): number {
  if (!value) return 0;
  return decodeCursor(value, (raw) => {
    const o = (raw as { o?: unknown })?.o;
    return typeof o === "number" && Number.isInteger(o) && o >= 0 && o <= max ? o : null;
  });
}

export function encodeOffsetCursor(offset: number): string {
  return encodeCursor({ o: offset });
}

// ── Output helpers ───────────────────────────────────────────────────────────

/** Render a Date or ISO string as a `+09:00` instant (null stays null). */
export function kstIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : toKstIso(date);
}

/** Allowlist field map that renders an instant as `+09:00`. */
export const kstTime = { map: (value: unknown) => kstIso(value) };

export function rangeOutput(range: TimeRange): { from: string; to: string } {
  return { from: toKstIso(range.start), to: toKstIso(range.end) };
}
