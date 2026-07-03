import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every db.insert(...).values(...) so we can assert what was persisted.
// vi.hoisted is required: vi.mock factories are hoisted above imports, so the
// closure can't reference a plain `const` (TDZ).
const { insertCalls, selectState } = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: unknown; values: unknown }>,
  // Rows returned by db.select() chains (the ±2min duplicate lookup).
  selectState: { rows: [] as unknown[] },
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual, // preserve re-exported schema tables/types
    getDb: () => ({
      insert: (table: unknown) => ({
        values: (vals: unknown) => {
          insertCalls.push({ table, values: vals });
          const rows = [{ id: 1 }];
          return Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(selectState.rows) }),
        }),
      }),
    }),
  };
});

vi.mock("@/lib/api-auth", () => ({
  checkBodySize: () => ({ ok: true }),
  enforceRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
  verifyApiKey: vi.fn().mockResolvedValue({ id: "u1", tossMyName: "홍길동" }),
  logIngestionFailure: () => {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { transactions } from "@/db/schema";
import { POST } from "./route";

function postRequest(body: string): NextRequest {
  return new NextRequest("http://localhost/api/toss-notifications?apikey=test-key", {
    method: "POST",
    body,
  });
}

describe("POST /api/toss-notifications", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    selectState.rows = [];
  });

  it("persists a parsed transaction from a recognized notification", async () => {
    const res = await POST(
      postRequest(JSON.stringify({ title: "6,900원 출금", text: "내 토스뱅크 통장 → 쿠팡" }))
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, transactionParsed: true });

    const txInsert = insertCalls.find((c) => c.table === transactions);
    expect(txInsert).toBeTruthy();
    expect(txInsert?.values).toMatchObject({
      userId: "u1",
      type: "withdrawal",
      amount: 6900,
      merchant: "쿠팡",
      accountName: "내 토스뱅크 통장",
    });
  });

  it("skips the transaction insert when an identical one exists within ±2min (MacroDroid retry)", async () => {
    selectState.rows = [{ id: "existing-tx" }];

    const res = await POST(
      postRequest(JSON.stringify({ title: "6,900원 출금", text: "내 토스뱅크 통장 → 쿠팡" }))
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, transactionParsed: false });
    expect(insertCalls.some((c) => c.table === transactions)).toBe(false);
  });

  it("logs but skips parsing for an unrecognized notification (no 500, no tx insert)", async () => {
    const res = await POST(postRequest(JSON.stringify({ title: "광고 알림", text: "이벤트" })));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ transactionParsed: false });
    expect(insertCalls.some((c) => c.table === transactions)).toBe(false);
  });

  it("handles a malformed (non-JSON) payload without a 500", async () => {
    // The 4/20 outage path: control chars / invalid JSON. Raw log still saves;
    // parse fails gracefully and the request returns 200.
    const res = await POST(postRequest("{not valid json"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ transactionParsed: false });
    expect(insertCalls.some((c) => c.table === transactions)).toBe(false);
  });
});
