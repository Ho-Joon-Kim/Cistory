import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => {}),
  writeAuditHook: vi.fn(),
  lookupIdempotency: vi.fn(),
  storeIdempotency: vi.fn(async () => {}),
  createSavedPlace: vi.fn(),
  updateSavedPlace: vi.fn(),
  deleteSavedPlace: vi.fn(),
  correctTransaction: vi.fn(),
  createManualTrip: vi.fn(),
  updateTrip: vi.fn(),
  markTripNotATrip: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  writeAuditHook: mocks.writeAuditHook,
}));
vi.mock("../idempotency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idempotency")>()),
  lookupIdempotency: mocks.lookupIdempotency,
  storeIdempotency: mocks.storeIdempotency,
}));
vi.mock("@/modules/location/saved-places", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/location/saved-places")>()),
  createSavedPlace: mocks.createSavedPlace,
  updateSavedPlace: mocks.updateSavedPlace,
  deleteSavedPlace: mocks.deleteSavedPlace,
}));
vi.mock("@/modules/spending/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/spending/service")>()),
  correctTransaction: mocks.correctTransaction,
}));
vi.mock("@/modules/travel/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/travel/service")>()),
  createManualTrip: mocks.createManualTrip,
  updateTrip: mocks.updateTrip,
}));
vi.mock("@/modules/travel/not-a-trip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/travel/not-a-trip")>()),
  markTripNotATrip: mocks.markTripNotATrip,
}));

import {
  TripHasNoVisitsError,
  TripIsManualError,
  TripNotFoundError,
} from "@/modules/travel/not-a-trip";
import { IdempotencyConflictError, IdempotencyRaceError } from "../idempotency";
import { type McpTool, type McpToolContext, runTool } from "../server";
import {
  assertExpectedCurrent,
  savedPlaceCreateTool,
  savedPlaceDeleteTool,
  savedPlaceUpdateTool,
  transactionCorrectTool,
  tripCreateTool,
  tripMarkNotATripTool,
  tripUpdateTool,
  WRITE_TOOLS,
} from "./writes";

const TX = { tx: true };
const PLACE_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const TX_ID = "33333333-3333-4333-8333-333333333333";

function context(): McpToolContext {
  return {
    // Only auditNoChange uses the db directly (its own small transaction).
    db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) } as never,
    userId: "user-1",
    tokenId: "token-1",
    tokenName: "agent",
    scopes: ["write"],
    ip: "1.2.3.4",
    country: "KR",
    now: new Date("2026-11-13T03:00:00Z"),
  };
}

const place = {
  id: PLACE_ID,
  userId: "user-1",
  name: "회사",
  lat: 37.5,
  lon: 127.0,
  radiusM: 100,
  category: "work",
  address: "서울 어딘가",
  excludeFromTrips: false,
  tripExclusionRadiusM: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const trip = {
  id: TRIP_ID,
  userId: "user-1",
  name: "부산 여행",
  startDate: "2026-07-15",
  endDate: "2026-07-18",
  notes: "비밀 메모",
  autoDetected: true,
};

const transaction = {
  id: TX_ID,
  userId: "user-1",
  amount: 4500,
  merchant: "스타벅스",
  accountName: "내 통장",
  rawText: "스타벅스 4,500원 결제",
  rawTitle: "토스",
  category: null,
  categorySource: null,
  spendingOverride: null,
  overrideNote: "메모",
  transactedAt: new Date("2026-11-12T16:30:00Z"),
};

/** Run the tool with a service mock that invokes the inTx hook like the real service. */
async function call(tool: McpTool, input: Record<string, unknown>, ctx = context()) {
  const parsed = tool.inputSchema.parse(input);
  return runTool(tool, ctx, parsed);
}

function structured(result: Awaited<ReturnType<typeof runTool>>) {
  expect(result.isError).toBeFalsy();
  return result.structuredContent as Record<string, unknown>;
}

function errorText(result: Awaited<ReturnType<typeof runTool>>) {
  expect(result.isError).toBe(true);
  return (result.content[0] as { text: string }).text;
}

function runsHook<T>(before: T | null, after: T | null, returned: unknown = after) {
  return async (...args: unknown[]) => {
    const options = args.find(
      (arg) => typeof arg === "object" && arg !== null && "inTx" in arg
    ) as { inTx: (tx: unknown, change: unknown) => Promise<void> };
    await options.inTx(TX, { before, after });
    return returned;
  };
}

beforeEach(() => {
  mocks.writeAuditHook.mockReturnValue(mocks.audit);
  mocks.lookupIdempotency.mockResolvedValue(null);
});

describe("WRITE_TOOLS registry", () => {
  it("lists the seven write tools, all scope write with explicit annotations", () => {
    expect(WRITE_TOOLS.map((tool) => tool.name)).toEqual([
      "saved_place_create",
      "saved_place_update",
      "saved_place_delete",
      "transaction_correct",
      "trip_create",
      "trip_update",
      "trip_mark_not_a_trip",
    ]);
    for (const tool of WRITE_TOOLS) {
      expect(tool.kind).toBe("write");
      expect(tool.scope).toBe("write");
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    const destructive = WRITE_TOOLS.filter((tool) => tool.annotations.destructiveHint).map(
      (tool) => tool.name
    );
    expect(destructive).toEqual(["saved_place_delete", "trip_mark_not_a_trip"]);
    expect(savedPlaceCreateTool.annotations.idempotentHint).toBe(false);
    expect(tripCreateTool.annotations.idempotentHint).toBe(false);
    expect(tripMarkNotATripTool.annotations.idempotentHint).toBe(true);
  });
});

describe("assertExpectedCurrent", () => {
  it("passes on match, ignores absent keys and treats undefined as null", () => {
    expect(() =>
      assertExpectedCurrent({ name: "a", category: null, other: undefined }, { name: "a" })
    ).not.toThrow();
  });

  it("throws a conflict naming only the mismatched fields", () => {
    expect(() => assertExpectedCurrent({ name: "a" }, { name: "secret value" })).toThrow(
      /다른 항목: name/
    );
    try {
      assertExpectedCurrent({ name: "a" }, { name: "secret value" });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret value");
      expect((error as { code: string }).code).toBe("conflict");
    }
  });
});

describe("saved_place_create", () => {
  it("creates through the service with ctx.db and audits a coordinate-free projection", async () => {
    mocks.createSavedPlace.mockImplementation(runsHook(null, place));
    const ctx = context();
    const result = structured(
      await call(savedPlaceCreateTool, { name: "회사", lat: 37.5, lon: 127, radiusM: 300 }, ctx)
    );

    expect(mocks.createSavedPlace).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "회사", lat: 37.5, lon: 127, radiusM: 300 }),
      expect.objectContaining({ database: ctx.db })
    );
    expect(result).toEqual({
      place: {
        id: PLACE_ID,
        name: "회사",
        radiusM: 100,
        category: "work",
        excludeFromTrips: false,
        tripExclusionRadiusM: null,
      },
      replayed: false,
    });
    expect(mocks.writeAuditHook).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ tool: "saved_place_create" })
    );
    const [tx, change] = mocks.audit.mock.calls[0] as unknown as [
      unknown,
      { before: unknown; after: Record<string, unknown> },
    ];
    expect(tx).toBe(TX);
    expect(change.before).toBeNull();
    expect(change.after).not.toHaveProperty("lat");
    expect(change.after).not.toHaveProperty("address");
    expect(mocks.storeIdempotency).not.toHaveBeenCalled();
  });

  it("stores the idempotency key inside the write's transaction", async () => {
    mocks.createSavedPlace.mockImplementation(runsHook(null, place));
    await call(savedPlaceCreateTool, { name: "회사", lat: 37.5, lon: 127, idempotencyKey: "k1" });
    expect(mocks.storeIdempotency).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        tokenId: "token-1",
        userId: "user-1",
        key: "k1",
        tool: "saved_place_create",
        result: { place: expect.objectContaining({ id: PLACE_ID }) },
      }),
      expect.any(Date)
    );
  });

  it("replays a stored key without writing (and still audits the call)", async () => {
    mocks.lookupIdempotency.mockResolvedValue({ result: { place: { id: PLACE_ID } } });
    const result = structured(
      await call(savedPlaceCreateTool, { name: "회사", lat: 37.5, lon: 127, idempotencyKey: "k1" })
    );
    expect(result).toEqual({ place: { id: PLACE_ID }, replayed: true });
    expect(mocks.createSavedPlace).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(TX, { before: null, after: null, resultCount: 0 });
  });

  it("rejects a reused key with different arguments", async () => {
    mocks.lookupIdempotency.mockRejectedValue(new IdempotencyConflictError());
    const text = errorText(
      await call(savedPlaceCreateTool, { name: "회사", lat: 37.5, lon: 127, idempotencyKey: "k1" })
    );
    expect(text).toContain("멱등 키");
    expect(mocks.createSavedPlace).not.toHaveBeenCalled();
  });

  it("returns the winner's result when a concurrent call stored the key first", async () => {
    mocks.lookupIdempotency
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ result: { place: { id: "winner" } } });
    mocks.createSavedPlace.mockRejectedValue(new IdempotencyRaceError());
    const result = structured(
      await call(savedPlaceCreateTool, { name: "회사", lat: 37.5, lon: 127, idempotencyKey: "k1" })
    );
    expect(result).toEqual({ place: { id: "winner" }, replayed: true });
  });
});

describe("saved_place_update / saved_place_delete", () => {
  it("passes only the provided fields to the service", async () => {
    mocks.updateSavedPlace.mockImplementation(runsHook(place, { ...place, name: "새 회사" }));
    const result = structured(
      await call(savedPlaceUpdateTool, { placeId: PLACE_ID, name: "새 회사", category: null })
    );
    expect(mocks.updateSavedPlace).toHaveBeenCalledWith(
      "user-1",
      PLACE_ID,
      { name: "새 회사", category: null },
      expect.anything()
    );
    expect(result.place).toMatchObject({ name: "새 회사" });
  });

  it("an expectedCurrent mismatch throws inside the hook (rolls back) before auditing", async () => {
    mocks.updateSavedPlace.mockImplementation(runsHook(place, { ...place, name: "x" }));
    const text = errorText(
      await call(savedPlaceUpdateTool, {
        placeId: PLACE_ID,
        name: "x",
        expectedCurrent: { name: "옛 이름" },
      })
    );
    expect(text).toContain("expectedCurrent");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns not_found for a missing place", async () => {
    mocks.updateSavedPlace.mockResolvedValue(null);
    expect(errorText(await call(savedPlaceUpdateTool, { placeId: PLACE_ID, name: "x" }))).toContain(
      "찾을 수 없습니다"
    );
    mocks.deleteSavedPlace.mockResolvedValue(null);
    expect(errorText(await call(savedPlaceDeleteTool, { placeId: PLACE_ID }))).toContain(
      "찾을 수 없습니다"
    );
  });

  it("rejects an empty update", async () => {
    expect(errorText(await call(savedPlaceUpdateTool, { placeId: PLACE_ID }))).toContain(
      "수정할 항목"
    );
    expect(mocks.updateSavedPlace).not.toHaveBeenCalled();
  });

  it("deletes and audits the removed place", async () => {
    mocks.deleteSavedPlace.mockImplementation(runsHook(place, null, place));
    const result = structured(await call(savedPlaceDeleteTool, { placeId: PLACE_ID }));
    expect(result).toEqual({ deleted: true, placeId: PLACE_ID });
    expect(mocks.audit).toHaveBeenCalledWith(TX, {
      before: expect.objectContaining({ id: PLACE_ID, name: "회사" }),
      after: null,
      resultCount: 1,
    });
  });
});

describe("transaction_correct", () => {
  it("maps note → overrideNote and sets a manual category", async () => {
    const after = { ...transaction, category: "cafe", categorySource: "manual" };
    mocks.correctTransaction.mockImplementation(runsHook(transaction, after));
    const result = structured(
      await call(transactionCorrectTool, { transactionId: TX_ID, category: "cafe", note: null })
    );
    const update = mocks.correctTransaction.mock.calls[0][2] as Record<string, unknown>;
    expect(update).toMatchObject({
      category: "cafe",
      categorySource: "manual",
      overrideNote: null,
    });
    expect(update).not.toHaveProperty("spendingOverride");
    expect(result.transaction).toEqual({
      id: TX_ID,
      transactedAt: "2026-11-13T01:30:00+09:00",
      category: "cafe",
      categorySource: "manual",
      spendingOverride: null,
      hasNote: true,
    });
  });

  it("never puts raw text, account name or the note into the audit", async () => {
    mocks.correctTransaction.mockImplementation(
      runsHook(transaction, { ...transaction, spendingOverride: "exclude" })
    );
    await call(transactionCorrectTool, { transactionId: TX_ID, spendingOverride: "exclude" });
    const serialized = JSON.stringify(mocks.audit.mock.calls[0]);
    for (const secret of ["스타벅스", "내 통장", "4,500", "메모"]) {
      expect(serialized).not.toContain(secret);
    }
    const hookSpec = mocks.writeAuditHook.mock.calls[0][1] as { fields: string[] };
    expect(hookSpec.fields).not.toContain("rawText");
    expect(hookSpec.fields).not.toContain("accountName");
  });

  it("rejects an unknown category at the schema", () => {
    expect(() =>
      transactionCorrectTool.inputSchema.parse({ transactionId: TX_ID, category: "nope" })
    ).toThrow();
  });

  it("expectedCurrent mismatch is a conflict", async () => {
    mocks.correctTransaction.mockImplementation(runsHook(transaction, transaction));
    const text = errorText(
      await call(transactionCorrectTool, {
        transactionId: TX_ID,
        category: "cafe",
        expectedCurrent: { category: "food" },
      })
    );
    expect(text).toContain("category");
  });
});

describe("trip_create / trip_update", () => {
  it("validates the range before writing", async () => {
    expect(
      errorText(
        await call(tripCreateTool, { name: "x", startDate: "2026-07-18", endDate: "2026-07-15" })
      )
    ).toContain("startDate");
    expect(mocks.createManualTrip).not.toHaveBeenCalled();
    expect(() =>
      tripCreateTool.inputSchema.parse({
        name: "x",
        startDate: "2026-02-30",
        endDate: "2026-03-01",
      })
    ).toThrow();
  });

  it("creates a manual trip and returns a notes-free projection", async () => {
    mocks.createManualTrip.mockImplementation(runsHook(null, { ...trip, autoDetected: false }));
    const result = structured(
      await call(tripCreateTool, {
        name: "부산 여행",
        startDate: "2026-07-15",
        endDate: "2026-07-18",
        notes: "비밀 메모",
      })
    );
    expect(result.trip).toEqual({
      id: TRIP_ID,
      name: "부산 여행",
      startDate: "2026-07-15",
      endDate: "2026-07-18",
      autoDetected: false,
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("비밀 메모");
  });

  it("update checks expectedCurrent and the resulting range inside the transaction", async () => {
    mocks.updateTrip.mockImplementation(runsHook(trip, { ...trip, endDate: "2026-07-10" }));
    expect(
      errorText(await call(tripUpdateTool, { tripId: TRIP_ID, endDate: "2026-07-10" }))
    ).toContain("startDate");
    expect(mocks.audit).not.toHaveBeenCalled();

    mocks.updateTrip.mockImplementation(runsHook(trip, { ...trip, name: "새 이름" }));
    expect(
      errorText(
        await call(tripUpdateTool, {
          tripId: TRIP_ID,
          name: "새 이름",
          expectedCurrent: { name: "다른 이름" },
        })
      )
    ).toContain("name");
  });

  it("renames with a matching expectedCurrent", async () => {
    mocks.updateTrip.mockImplementation(runsHook(trip, { ...trip, name: "새 이름" }));
    const result = structured(
      await call(tripUpdateTool, {
        tripId: TRIP_ID,
        name: "새 이름",
        expectedCurrent: { name: "부산 여행" },
      })
    );
    expect(result.trip).toMatchObject({ name: "새 이름" });
    expect(mocks.updateTrip).toHaveBeenCalledWith(
      "user-1",
      TRIP_ID,
      { name: "새 이름", startDate: undefined, endDate: undefined, notes: undefined },
      expect.anything()
    );
  });
});

describe("trip_mark_not_a_trip", () => {
  it("refuses manual trips via rejectManual and audits trip + created place", async () => {
    const created = { ...place, excludeFromTrips: true, tripExclusionRadiusM: 10_000 };
    mocks.markTripNotATrip.mockImplementation(async (_u, _t, _db, options) => {
      await options.inTx(TX, {
        before: { trip, place: null },
        after: { trip: null, place: created },
      });
      return { tripId: TRIP_ID, place: created, reusedPlace: false };
    });
    const ctx = context();
    const result = structured(await call(tripMarkNotATripTool, { tripId: TRIP_ID }, ctx));

    expect(mocks.markTripNotATrip).toHaveBeenCalledWith(
      "user-1",
      TRIP_ID,
      ctx.db,
      expect.objectContaining({ rejectManual: true })
    );
    expect(result).toMatchObject({ status: "done", tripId: TRIP_ID, reusedPlace: false });
    expect(mocks.audit).toHaveBeenCalledWith(TX, {
      before: {
        trip: expect.objectContaining({ id: TRIP_ID, name: "부산 여행" }),
        place: null,
      },
      after: {
        trip: null,
        place: expect.objectContaining({ id: PLACE_ID, excludeFromTrips: true }),
      },
      resultCount: 1,
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("비밀 메모");
  });

  it("an already-deleted trip is a no-op success", async () => {
    mocks.markTripNotATrip.mockRejectedValue(new TripNotFoundError());
    const result = structured(await call(tripMarkNotATripTool, { tripId: TRIP_ID }));
    expect(result).toMatchObject({ status: "already_processed", tripId: TRIP_ID });
    expect(String(result.message)).toContain("이미 처리됨");
    expect(mocks.audit).toHaveBeenCalledWith(TX, { before: null, after: null, resultCount: 0 });
  });

  it("maps no-visits and manual trips to Korean errors", async () => {
    mocks.markTripNotATrip.mockRejectedValueOnce(new TripHasNoVisitsError());
    expect(errorText(await call(tripMarkNotATripTool, { tripId: TRIP_ID }))).toContain(
      "방문 기록이 없어요"
    );
    mocks.markTripNotATrip.mockRejectedValueOnce(new TripIsManualError());
    expect(errorText(await call(tripMarkNotATripTool, { tripId: TRIP_ID }))).toContain("삭제");
  });
});
