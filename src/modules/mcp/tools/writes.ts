/**
 * Write tools (U9): saved places, transaction corrections, trip corrections.
 *
 * Every tool calls the same service write the web routes use, handing it an
 * `inTx` hook that runs inside the write's transaction right before commit:
 *
 *   expectedCurrent check (optional; mismatch → conflict, rollback)
 *   → token re-check under FOR SHARE + before/after audit (writeAuditHook)
 *   → idempotency key store (creates only)
 *
 * The service itself re-queues the affected overview snapshots in the same
 * transaction (transactions: that KST day; trips: the trip range), so MCP and
 * web corrections can't diverge.
 *
 * Audit snapshots and tool results are explicit projections, never full rows:
 * no coordinates, addresses, raw notification text, account names or free-text
 * notes (a note is recorded only as `hasNote`).
 */

import { z } from "zod";
import type { InTxHook } from "@/lib/write-hook";
import {
  createSavedPlace,
  deleteSavedPlace,
  parseSavedPlaceCreate,
  parseSavedPlaceUpdate,
  type SavedPlace,
  updateSavedPlace,
} from "@/modules/location/saved-places";
import { EXPENSE_CATEGORIES } from "@/modules/spending/categories";
import {
  correctTransaction,
  parseTransactionCorrection,
  type TransactionRow,
} from "@/modules/spending/service";
import {
  markTripNotATrip,
  type NotATripState,
  TripHasNoVisitsError,
  TripIsManualError,
  TripNotFoundError,
} from "@/modules/travel/not-a-trip";
import { createManualTrip, type TripRow, updateTrip } from "@/modules/travel/service";
import type { ArgRules } from "../audit";
import { McpInputError, McpToolError } from "../errors";
import {
  IdempotencyRaceError,
  idempotencyArgsHash,
  lookupIdempotency,
  storeIdempotency,
} from "../idempotency";
import {
  defineTool,
  type McpTool,
  type McpToolAnnotations,
  type McpToolContext,
  type McpToolOutput,
  type McpWriteTx,
  writeAuditHook,
} from "../server";
import { isDateKey, MCP_MAX_RANGE_DAYS, toKstIsoOrNull } from "../time";

// ── Projections (audit + result allowlists) ──────────────────────────────────

const PLACE_FIELDS = [
  "id",
  "name",
  "radiusM",
  "category",
  "excludeFromTrips",
  "tripExclusionRadiusM",
] as const;
const TRANSACTION_FIELDS = [
  "id",
  "transactedAt",
  "category",
  "categorySource",
  "spendingOverride",
  "hasNote",
] as const;
const TRIP_FIELDS = ["id", "name", "startDate", "endDate", "autoDetected"] as const;
const NOT_A_TRIP_FIELDS = ["trip", "place"] as const;

type Projection = Record<string, unknown>;

export function projectPlace(place: SavedPlace): Projection {
  return {
    id: place.id,
    name: place.name,
    radiusM: place.radiusM,
    category: place.category,
    excludeFromTrips: place.excludeFromTrips,
    tripExclusionRadiusM: place.tripExclusionRadiusM,
  };
}

export function projectTransaction(row: TransactionRow): Projection {
  return {
    id: row.id,
    transactedAt: row.transactedAt,
    category: row.category,
    categorySource: row.categorySource,
    spendingOverride: row.spendingOverride,
    hasNote: Boolean(row.overrideNote),
  };
}

export function projectTrip(trip: TripRow): Projection {
  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    autoDetected: trip.autoDetected,
  };
}

function projectNotATrip(state: NotATripState): Projection {
  return {
    trip: state.trip ? projectTrip(state.trip) : null,
    place: state.place ? projectPlace(state.place) : null,
  };
}

/** Tool-result form: Dates as +09:00 strings. */
function asResult(projection: Projection): Projection {
  const out: Projection = {};
  for (const [key, value] of Object.entries(projection)) {
    out[key] = value instanceof Date ? toKstIsoOrNull(value) : value;
  }
  return out;
}

// ── Hook plumbing ────────────────────────────────────────────────────────────

const CONFLICT_MESSAGE =
  "현재 값이 expectedCurrent와 달라 변경하지 않았습니다. 최신 값을 다시 확인한 뒤 요청하세요.";

/**
 * Compare `expected` against the row as it was inside the write's transaction.
 * Only the field names that differ are reported (never the current values).
 */
export function assertExpectedCurrent(
  expected: Record<string, unknown> | undefined,
  before: Record<string, unknown> | null
): void {
  if (!expected || !before) return;
  const mismatched = Object.entries(expected)
    .filter(([, value]) => value !== undefined)
    .filter(([key, value]) => (before[key] ?? null) !== (value ?? null))
    .map(([key]) => key);
  if (mismatched.length > 0) {
    throw new McpToolError(`${CONFLICT_MESSAGE} (다른 항목: ${mismatched.join(", ")})`, "conflict");
  }
}

interface WriteSpec<T> {
  tool: string;
  args: Record<string, unknown>;
  argRules: ArgRules;
  fields: readonly string[];
  project: (row: T) => Projection;
  /** Runs first, inside the transaction (conflict checks). Throw to roll back. */
  check?: (change: { before: T | null; after: T | null }) => void;
  /** Runs last, inside the transaction (idempotency store). */
  after?: (tx: McpWriteTx, change: { before: T | null; after: T | null }) => Promise<void>;
}

function mcpWriteHook<T>(ctx: McpToolContext, spec: WriteSpec<T>): InTxHook<T> {
  const audit = writeAuditHook(ctx, {
    tool: spec.tool,
    args: spec.args,
    argRules: spec.argRules,
    fields: spec.fields,
  });
  return async (tx, change) => {
    spec.check?.(change);
    await audit(tx, {
      before: change.before ? spec.project(change.before) : null,
      after: change.after ? spec.project(change.after) : null,
      resultCount: 1,
    });
    await spec.after?.(tx, change);
  };
}

/**
 * Audit a call that changed nothing (idempotent replay, already-processed
 * not-a-trip). Still re-checks the token, so a revoked token gets the
 * revoked_midflight denial rather than a success.
 */
async function auditNoChange(
  ctx: McpToolContext,
  spec: {
    tool: string;
    args: Record<string, unknown>;
    argRules: ArgRules;
    fields: readonly string[];
  }
): Promise<void> {
  const audit = writeAuditHook(ctx, spec);
  await ctx.db.transaction(async (tx) => {
    await audit(tx, { before: null, after: null, resultCount: 0 });
  });
}

/**
 * Run a create with an optional idempotency key. A live key with the same
 * arguments returns the first result (`replayed: true`) without writing; with
 * different arguments it's a conflict. A concurrent call that stored the key
 * first makes this write roll back and return the winner's result.
 */
async function idempotentCreate<T>(
  ctx: McpToolContext,
  spec: Omit<WriteSpec<T>, "after"> & {
    key: string | undefined;
    result: (row: T) => Projection;
    perform: (inTx: InTxHook<T>) => Promise<T>;
  }
): Promise<McpToolOutput> {
  const argsHash = idempotencyArgsHash(spec.tool, spec.args);
  const call = spec.key ? { tokenId: ctx.tokenId, key: spec.key, tool: spec.tool, argsHash } : null;

  const replay = async (): Promise<McpToolOutput | null> => {
    if (!call) return null;
    const hit = await lookupIdempotency(ctx.db, call, ctx.now);
    if (!hit) return null;
    await auditNoChange(ctx, spec);
    return { structured: { ...hit.result, replayed: true }, count: 0 };
  };

  const first = await replay();
  if (first) return first;

  const inTx = mcpWriteHook<T>(ctx, {
    ...spec,
    after: async (tx, change) => {
      if (!call || !change.after) return;
      await storeIdempotency(
        tx,
        { ...call, userId: ctx.userId, result: spec.result(change.after) },
        new Date()
      );
    },
  });
  try {
    const row = await spec.perform(inTx);
    return { structured: { ...spec.result(row), replayed: false }, count: 1 };
  } catch (error) {
    if (!(error instanceof IdempotencyRaceError)) throw error;
    const winner = await replay();
    if (winner) return winner;
    throw new McpToolError(
      "같은 멱등 키로 동시에 요청됐습니다. 잠시 후 다시 시도하세요.",
      "conflict"
    );
  }
}

// ── Shared schemas ───────────────────────────────────────────────────────────

const uuid = (label: string) => z.uuid({ message: `${label}는 UUID여야 합니다` });
const idempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("재시도 시 같은 키를 쓰면(24시간) 한 번만 만들어지고 첫 결과가 돌아옵니다.");
const dateKey = z
  .string()
  .describe("YYYY-MM-DD (한국 시간 하루)")
  .refine(isDateKey, { message: "날짜는 YYYY-MM-DD 형식이어야 합니다" });

const WRITE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

function notFound(what: string): McpToolError {
  return new McpToolError(`${what}을(를) 찾을 수 없습니다.`, "not_found");
}

/** Copy only the keys the agent actually sent (absent ≠ null for the parsers). */
function definedEntries<T extends Record<string, unknown>>(input: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (input[key] !== undefined) out[key] = input[key];
  return out;
}

function checkTripRange(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new McpInputError("startDate는 endDate보다 늦을 수 없습니다.");
  }
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MCP_MAX_RANGE_DAYS) {
    throw new McpInputError(`여행 기간은 최대 ${MCP_MAX_RANGE_DAYS}일입니다.`);
  }
}

// ── Saved places ─────────────────────────────────────────────────────────────

const PLACE_ARG_RULES: ArgRules = {
  placeId: "keep",
  radiusM: "keep",
  category: "keep",
  excludeFromTrips: "keep",
  tripExclusionRadiusM: "keep",
  name: "text",
  address: "text",
  idempotencyKey: "text",
};

const placeCreateInput = z.object({
  name: z.string().trim().min(1).max(100).describe("장소 이름"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50).max(500).optional().describe("반경(m), 기본 100"),
  category: z.string().max(50).nullable().optional().describe('예: "home", "work"'),
  address: z.string().max(300).nullable().optional(),
  idempotencyKey,
});

export const savedPlaceCreateTool = defineTool({
  name: "saved_place_create",
  kind: "write",
  scope: "write",
  title: "저장 장소 추가",
  description:
    "저장 장소를 추가합니다. 반경은 50~500m입니다. idempotencyKey를 주면 재시도해도 한 번만 만들어집니다.",
  annotations: { ...WRITE },
  inputSchema: placeCreateInput,
  argRules: PLACE_ARG_RULES,
  run: async (ctx, input) => {
    const parsed = parseSavedPlaceCreate({ ...input });
    if ("error" in parsed) throw new McpInputError(parsed.error);
    return idempotentCreate<SavedPlace>(ctx, {
      tool: "saved_place_create",
      args: input,
      argRules: PLACE_ARG_RULES,
      fields: PLACE_FIELDS,
      project: projectPlace,
      key: input.idempotencyKey,
      result: (row) => ({ place: projectPlace(row) }),
      perform: (inTx) => createSavedPlace(ctx.userId, parsed.value, { inTx, database: ctx.db }),
    });
  },
});

const placeExpected = z
  .object({
    name: z.string().optional(),
    category: z.string().nullable().optional(),
    radiusM: z.number().optional(),
    excludeFromTrips: z.boolean().optional(),
    tripExclusionRadiusM: z.number().nullable().optional(),
  })
  .optional()
  .describe(
    "변경 전 값으로 기대하는 값. 현재 값과 다르면 충돌로 거부하고 아무것도 바꾸지 않습니다."
  );

const PLACE_UPDATE_KEYS = [
  "name",
  "lat",
  "lon",
  "radiusM",
  "category",
  "address",
  "excludeFromTrips",
  "tripExclusionRadiusM",
] as const;

const placeUpdateInput = z.object({
  placeId: uuid("placeId"),
  name: z.string().trim().min(1).max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  radiusM: z.number().int().min(50).max(500).optional(),
  category: z.string().max(50).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  excludeFromTrips: z.boolean().optional().describe("여행 감지에서 이 장소 주변을 제외할지"),
  tripExclusionRadiusM: z
    .number()
    .int()
    .min(1_000)
    .max(100_000)
    .nullable()
    .optional()
    .describe("여행 제외 반경(m)"),
  expectedCurrent: placeExpected,
});

export const savedPlaceUpdateTool = defineTool({
  name: "saved_place_update",
  kind: "write",
  scope: "write",
  title: "저장 장소 수정",
  description:
    "저장 장소의 이름·반경·분류·여행 제외 설정을 바꿉니다. expectedCurrent를 주면 현재 값이 다를 때 충돌로 거부합니다.",
  annotations: { ...WRITE, idempotentHint: true },
  inputSchema: placeUpdateInput,
  argRules: { ...PLACE_ARG_RULES, expectedCurrent: "drop" },
  run: async (ctx, input) => {
    const parsed = parseSavedPlaceUpdate(definedEntries(input, PLACE_UPDATE_KEYS));
    if ("error" in parsed) throw new McpInputError(parsed.error);
    const inTx = mcpWriteHook<SavedPlace>(ctx, {
      tool: "saved_place_update",
      args: input,
      argRules: { ...PLACE_ARG_RULES, expectedCurrent: "drop" },
      fields: PLACE_FIELDS,
      project: projectPlace,
      check: ({ before }) => assertExpectedCurrent(input.expectedCurrent, before),
    });
    const updated = await updateSavedPlace(ctx.userId, input.placeId, parsed.value, {
      inTx,
      database: ctx.db,
    });
    if (!updated) throw notFound("저장 장소");
    return { structured: { place: projectPlace(updated) }, count: 1 };
  },
});

const placeDeleteInput = z.object({
  placeId: uuid("placeId"),
  expectedCurrent: z
    .object({ name: z.string().optional() })
    .optional()
    .describe("지우려는 장소의 현재 이름. 다르면 충돌로 거부합니다."),
});

export const savedPlaceDeleteTool = defineTool({
  name: "saved_place_delete",
  kind: "write",
  scope: "write",
  title: "저장 장소 삭제",
  description: "저장 장소를 지웁니다. 되돌릴 수 없습니다.",
  annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
  inputSchema: placeDeleteInput,
  argRules: { placeId: "keep", expectedCurrent: "drop" },
  run: async (ctx, input) => {
    const inTx = mcpWriteHook<SavedPlace>(ctx, {
      tool: "saved_place_delete",
      args: input,
      argRules: { placeId: "keep", expectedCurrent: "drop" },
      fields: PLACE_FIELDS,
      project: projectPlace,
      check: ({ before }) => assertExpectedCurrent(input.expectedCurrent, before),
    });
    const deleted = await deleteSavedPlace(ctx.userId, input.placeId, { inTx, database: ctx.db });
    if (!deleted) throw notFound("저장 장소");
    return { structured: { deleted: true, placeId: deleted.id }, count: 1 };
  },
});

// ── Transactions ─────────────────────────────────────────────────────────────

const TRANSACTION_ARG_RULES: ArgRules = {
  transactionId: "keep",
  category: "keep",
  spendingOverride: "keep",
  note: "text",
  expectedCurrent: "drop",
};

const overrideEnum = z.enum(["include", "exclude"]);

const transactionCorrectInput = z.object({
  transactionId: uuid("transactionId"),
  category: z
    .enum(EXPENSE_CATEGORIES)
    .nullable()
    .optional()
    .describe("지출 카테고리. null이면 미분류로 되돌려 AI가 다시 분류합니다."),
  spendingOverride: overrideEnum
    .nullable()
    .optional()
    .describe("include: 지출로 포함, exclude: 지출에서 제외, null: 자동 분류로 되돌림"),
  note: z.string().max(500).nullable().optional().describe("정정 메모 (null이면 지움)"),
  expectedCurrent: z
    .object({
      category: z.string().nullable().optional(),
      spendingOverride: overrideEnum.nullable().optional(),
    })
    .optional()
    .describe("변경 전 값으로 기대하는 값. 현재 값과 다르면 충돌로 거부합니다."),
});

export const transactionCorrectTool = defineTool({
  name: "transaction_correct",
  kind: "write",
  scope: "write",
  title: "거래 정정",
  description:
    "거래의 지출 카테고리, 지출 포함/제외(spendingOverride), 메모를 정정합니다. 카테고리를 지정하면 수동 분류로 기록됩니다. 해당 날짜의 overview가 다시 계산됩니다.",
  annotations: { ...WRITE, idempotentHint: true },
  inputSchema: transactionCorrectInput,
  argRules: TRANSACTION_ARG_RULES,
  run: async (ctx, input) => {
    const body: Record<string, unknown> = definedEntries(input, ["category", "spendingOverride"]);
    if (input.note !== undefined) body.overrideNote = input.note;
    const parsed = parseTransactionCorrection(body);
    if ("error" in parsed) throw new McpInputError(parsed.error);
    const inTx = mcpWriteHook<TransactionRow>(ctx, {
      tool: "transaction_correct",
      args: input,
      argRules: TRANSACTION_ARG_RULES,
      fields: TRANSACTION_FIELDS,
      project: projectTransaction,
      check: ({ before }) => assertExpectedCurrent(input.expectedCurrent, before),
    });
    const updated = await correctTransaction(ctx.userId, input.transactionId, parsed.value, {
      inTx,
      database: ctx.db,
    });
    if (!updated) throw notFound("거래");
    return { structured: { transaction: asResult(projectTransaction(updated)) }, count: 1 };
  },
});

// ── Trips ────────────────────────────────────────────────────────────────────

const TRIP_ARG_RULES: ArgRules = {
  tripId: "keep",
  name: "text",
  notes: "text",
  idempotencyKey: "text",
  expectedCurrent: "drop",
};

const tripCreateInput = z.object({
  name: z.string().trim().min(1).max(100),
  startDate: dateKey,
  endDate: dateKey,
  notes: z.string().max(1000).nullable().optional(),
  idempotencyKey,
});

export const tripCreateTool = defineTool({
  name: "trip_create",
  kind: "write",
  scope: "write",
  title: "수동 여행 추가",
  description:
    "직접 만든 여행을 추가합니다(자동 감지가 지우지 않음). 날짜는 한국 시간 기준 YYYY-MM-DD입니다. idempotencyKey를 주면 재시도해도 한 번만 만들어집니다.",
  annotations: { ...WRITE },
  inputSchema: tripCreateInput,
  argRules: TRIP_ARG_RULES,
  run: async (ctx, input) => {
    checkTripRange(input.startDate, input.endDate);
    return idempotentCreate<TripRow>(ctx, {
      tool: "trip_create",
      args: input,
      argRules: TRIP_ARG_RULES,
      fields: TRIP_FIELDS,
      project: projectTrip,
      key: input.idempotencyKey,
      result: (row) => ({ trip: projectTrip(row) }),
      perform: (inTx) =>
        createManualTrip(
          ctx.userId,
          {
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate,
            notes: input.notes ?? null,
          },
          { inTx, database: ctx.db }
        ),
    });
  },
});

const tripUpdateInput = z.object({
  tripId: uuid("tripId"),
  name: z.string().trim().min(1).max(100).optional(),
  startDate: dateKey.optional(),
  endDate: dateKey.optional(),
  notes: z.string().max(1000).nullable().optional().describe("메모 (null이면 지움)"),
  expectedCurrent: z
    .object({
      name: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })
    .optional()
    .describe("변경 전 값으로 기대하는 값. 현재 값과 다르면 충돌로 거부합니다."),
});

export const tripUpdateTool = defineTool({
  name: "trip_update",
  kind: "write",
  scope: "write",
  title: "여행 수정",
  description:
    "여행 이름·기간·메모를 바꿉니다. 수정한 여행은 수동 여행이 되어 자동 감지가 덮어쓰지 않습니다. expectedCurrent를 주면 현재 값이 다를 때 충돌로 거부합니다.",
  annotations: { ...WRITE, idempotentHint: true },
  inputSchema: tripUpdateInput,
  argRules: TRIP_ARG_RULES,
  run: async (ctx, input) => {
    const fields = definedEntries(input, ["name", "startDate", "endDate", "notes"]);
    if (Object.keys(fields).length === 0) throw new McpInputError("변경할 항목이 없습니다.");
    const inTx = mcpWriteHook<TripRow>(ctx, {
      tool: "trip_update",
      args: input,
      argRules: TRIP_ARG_RULES,
      fields: TRIP_FIELDS,
      project: projectTrip,
      check: ({ before, after }) => {
        assertExpectedCurrent(input.expectedCurrent, before);
        if (after) checkTripRange(after.startDate, after.endDate);
      },
    });
    const updated = await updateTrip(
      ctx.userId,
      input.tripId,
      {
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes,
      },
      { inTx, database: ctx.db }
    );
    if (!updated) throw notFound("여행");
    return { structured: { trip: projectTrip(updated) }, count: 1 };
  },
});

const NOT_A_TRIP_ARG_RULES: ArgRules = { tripId: "keep" };
const ALREADY_PROCESSED =
  "이미 처리됨: 이 여행은 이미 '여행 아님'으로 처리됐거나 삭제되어 없습니다.";

export const tripMarkNotATripTool = defineTool({
  name: "trip_mark_not_a_trip",
  kind: "write",
  scope: "write",
  title: "여행 아님 처리",
  description:
    "자동 감지된 여행이 여행이 아니라고 표시합니다. 웹과 같이 여행지 주변을 저장 장소(여행 제외)로 만들고 여행을 지웁니다. 직접 만든 여행은 처리하지 않습니다(삭제하세요).",
  annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
  inputSchema: z.object({ tripId: uuid("tripId") }),
  argRules: NOT_A_TRIP_ARG_RULES,
  run: async (ctx, input) => {
    const spec = {
      tool: "trip_mark_not_a_trip",
      args: input,
      argRules: NOT_A_TRIP_ARG_RULES,
      fields: NOT_A_TRIP_FIELDS,
    };
    try {
      const result = await markTripNotATrip(ctx.userId, input.tripId, ctx.db, {
        rejectManual: true,
        inTx: mcpWriteHook<NotATripState>(ctx, { ...spec, project: projectNotATrip }),
      });
      return {
        structured: {
          status: "done",
          tripId: result.tripId,
          reusedPlace: result.reusedPlace,
          place: projectPlace(result.place),
        },
        count: 1,
      };
    } catch (error) {
      if (error instanceof TripNotFoundError) {
        await auditNoChange(ctx, spec);
        return {
          structured: {
            status: "already_processed",
            tripId: input.tripId,
            message: ALREADY_PROCESSED,
          },
          count: 0,
        };
      }
      if (error instanceof TripHasNoVisitsError) {
        throw new McpToolError(error.message, "trip_has_no_visits");
      }
      if (error instanceof TripIsManualError) {
        throw new McpToolError(error.message, "trip_is_manual");
      }
      throw error;
    }
  },
});

export const WRITE_TOOLS: McpTool[] = [
  savedPlaceCreateTool,
  savedPlaceUpdateTool,
  savedPlaceDeleteTool,
  transactionCorrectTool,
  tripCreateTool,
  tripUpdateTool,
  tripMarkNotATripTool,
];
