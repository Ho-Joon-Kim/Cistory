process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ApiError } from "@/lib/api-handler";
import {
  buildNarrativePrompt,
  createDatabaseNarrativeStore,
  createNarrativeService,
  NARRATIVE_LEASE_MS,
  NARRATIVE_MAX_ATTEMPTS,
  NARRATIVE_MAX_INPUT_CHARS,
  type NarrativeClaim,
  type NarrativeStore,
} from "./narrative";

const NOW = new Date("2026-07-22T03:00:00.000Z");
const snapshot = { coding: null, location: null, health: null, spending: null, assets: null };
const claim: NarrativeClaim = {
  userId: "user-1",
  periodType: "month",
  periodKey: "2026-06",
  generationStartedAt: NOW,
  snapshot,
};

function store(overrides: Partial<NarrativeStore> = {}): NarrativeStore {
  return {
    find: vi.fn(async () => null),
    acquireManual: vi.fn(async () => ({ status: "acquired", claim })),
    claimAutoBatch: vi.fn(async () => []),
    renewLease: vi.fn(async () => undefined),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

function ai(content = "회고문") {
  return {
    generateText: vi.fn(async () => ({
      content,
      usage: { inputTokens: 10, outputTokens: 20 },
      stopReason: "end_turn" as const,
    })),
  };
}

describe("narrative service", () => {
  it("returns a stored narrative without calling AI", async () => {
    const adapter = ai();
    const repository = store({
      find: vi.fn(async () => ({
        status: "ready",
        content: "저장된 회고",
        generatedAt: NOW,
        model: "model-1",
        lastError: null,
      })),
    });

    await expect(
      createNarrativeService(repository, adapter).get("user-1", "month", "2026-06")
    ).resolves.toMatchObject({ status: "ready", content: "저장된 회고" });
    expect(adapter.generateText).not.toHaveBeenCalled();
    expect(repository.find).toHaveBeenCalledWith("user-1", "month", "2026-06");
  });

  it.each([
    "recent",
    "quarter",
    "month/2026-6",
  ])("rejects unsupported periods: %s", async (value) => {
    const [periodType, periodKey = "2026-06"] = value.split("/");
    await expect(
      createNarrativeService(store(), ai()).get("user-1", periodType, periodKey)
    ).rejects.toMatchObject({ status: 400, code: "INVALID_PERIOD" } satisfies Partial<ApiError>);
  });

  it("uses distinct prompt assets for week, month, and year", () => {
    const prompts = [
      buildNarrativePrompt("week", "2026-W29", snapshot).system,
      buildNarrativePrompt("month", "2026-06", snapshot).system,
      buildNarrativePrompt("year", "2025", snapshot).system,
    ];
    expect(new Set(prompts).size).toBe(3);
    expect(prompts[0]).toContain("한 주");
    expect(prompts[1]).toContain("한 달");
    expect(prompts[2]).toContain("한 해");
  });

  it("projects oversized domain arrays into bounded valid JSON", () => {
    const largeSnapshot = {
      ...snapshot,
      location: {
        status: "ready" as const,
        computedAt: NOW.toISOString(),
        computeVersion: 1,
        errorCode: null,
        data: {
          heatmap: Array.from({ length: 10_000 }, (_, index) => ({ index, value: "x".repeat(50) })),
        },
      },
    };
    const prompt = buildNarrativePrompt("year", "2025", largeSnapshot).prompt;
    const serialized = prompt.split("확정된 대시보드 데이터:\n")[1];

    expect(serialized.length).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_CHARS);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(JSON.parse(serialized).location.truncated).toBe(true);
    expect(NARRATIVE_LEASE_MS).toBe(8 * 60 * 1000);
  });

  it("publishes content only after AI succeeds", async () => {
    const repository = store({
      find: vi.fn(async () => ({
        status: "ready",
        content: "새 회고",
        generatedAt: NOW,
        model: "model-1",
        lastError: null,
      })),
    });

    const result = await createNarrativeService(repository, ai(" 새 회고 "), "model-1").regenerate(
      "user-1",
      "month",
      "2026-06",
      NOW
    );

    expect(repository.complete).toHaveBeenCalledWith(claim, "새 회고", "model-1", expect.any(Date));
    expect(result).toMatchObject({ status: "ready", content: "새 회고" });
  });

  it("records failure without completing or replacing existing content", async () => {
    const repository = store();
    const adapter = ai();
    adapter.generateText.mockRejectedValue(new Error("AI unavailable"));

    await expect(
      createNarrativeService(repository, adapter).regenerate("user-1", "month", "2026-06", NOW)
    ).rejects.toMatchObject({ status: 502, code: "NARRATIVE_GENERATION_FAILED" });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(claim, "AI unavailable", expect.any(Date));
  });

  it.each([
    ["not_ready", 409, "SNAPSHOT_NOT_READY"],
    ["concurrent", 409, "NARRATIVE_GENERATING"],
    ["too_frequent", 429, "NARRATIVE_RATE_LIMIT"],
  ] as const)("maps %s manual claim outcomes", async (status, httpStatus, code) => {
    const repository = store({ acquireManual: vi.fn(async () => ({ status })) });
    await expect(
      createNarrativeService(repository, ai()).regenerate("user-1", "month", "2026-06", NOW)
    ).rejects.toMatchObject({ status: httpStatus, code });
  });

  it("processes the bounded claimed batch and retries failed claims on later calls", async () => {
    const repository = store({
      claimAutoBatch: vi.fn().mockResolvedValueOnce([claim]).mockResolvedValueOnce([claim]),
    });
    const adapter = ai();
    adapter.generateText.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce({
      content: "recovered",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end_turn",
    });
    const service = createNarrativeService(repository, adapter);

    await expect(service.processAutoBatch(NOW, 2)).resolves.toEqual({
      claimed: 1,
      generated: 0,
      failed: 1,
    });
    await expect(service.processAutoBatch(NOW, 2)).resolves.toEqual({
      claimed: 1,
      generated: 1,
      failed: 0,
    });
    expect(repository.claimAutoBatch).toHaveBeenCalledWith(NOW, 2);
  });

  it("renews each row's lease immediately before generating it, not once for the whole batch", async () => {
    // claimAutoBatch stamps one lease across all claimed rows, but rows
    // generate sequentially. Without a per-row renewal, a slow earlier row
    // can push a later row's lease past NARRATIVE_LEASE_MS and the next
    // cron tick reclaims it mid-flight (duplicate paid call). Pin the fix:
    // renewLease must fire for claim N right before generate() for claim N,
    // not batched before or after the loop.
    const claimTwo: NarrativeClaim = { ...claim, periodKey: "2026-07" };
    const repository = store({
      claimAutoBatch: vi.fn(async () => [claim, claimTwo]),
    });
    const calls: string[] = [];
    (repository.renewLease as ReturnType<typeof vi.fn>).mockImplementation(
      async (c: NarrativeClaim) => {
        calls.push(`renew:${c.periodKey}`);
      }
    );
    const adapter = {
      generateText: vi.fn(async (options: { prompt: string }) => {
        const periodKey = /기간: \w+ (\S+)/.exec(options.prompt)?.[1];
        calls.push(`generate:${periodKey}`);
        return {
          content: "ok",
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: "end_turn",
        };
      }),
    };

    await createNarrativeService(repository, adapter).processAutoBatch(NOW, 2);

    expect(calls).toEqual([
      "renew:2026-06",
      "generate:2026-06",
      "renew:2026-07",
      "generate:2026-07",
    ]);
    expect(repository.renewLease).toHaveBeenCalledWith(claim, expect.any(Date));
    expect(repository.renewLease).toHaveBeenCalledWith(claimTwo, expect.any(Date));
  });
});

describe("database narrative queue", () => {
  it("applies the manual cooldown across all of a user's periods", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const results = [
      { rows: [] },
      { rows: [{ coding: null, location: null, health: null, spending: null, assets: null }] },
      { rows: [] },
      { rows: [{ generatedAt: new Date(NOW.getTime() - 60_000) }] },
    ];
    const execute = vi.fn(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, " ").trim());
      return results.shift() ?? { rows: [] };
    });
    const db = {
      transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        callback({ execute }),
    } as unknown as Database;

    await expect(
      createDatabaseNarrativeStore(db).acquireManual({
        userId: "user-1",
        periodType: "week",
        periodKey: "2026-W28",
        now: NOW,
      })
    ).resolves.toEqual({ status: "too_frequent" });

    expect(statements[3]).toContain("SELECT max(COALESCE(generated_at, generation_started_at))");
    expect(statements[3]).toContain("WHERE user_id = $1");
    expect(statements.some((statement) => statement.startsWith("INSERT"))).toBe(false);
  });

  it("recovers leases and claims only finalized ready non-recent snapshots in a bounded query", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const results = [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
    const execute = vi.fn(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, " ").trim());
      return results.shift() ?? { rows: [] };
    });
    const db = {
      transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        callback({ execute }),
    } as unknown as Database;

    await createDatabaseNarrativeStore(db).claimAutoBatch(NOW, 5);

    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[1]).toMatch(/status = 'generating'.*lease_expires_at <=/);
    expect(statements[2]).toContain("s.finalized_at IS NOT NULL");
    expect(statements[2]).toContain("s.period_type IN ('week', 'month', 'year')");
    expect(statements[2]).toContain("LIMIT $1");
    expect(statements[2]).toContain("ON CONFLICT (user_id, period_type, period_key) DO NOTHING");
    expect(statements[3]).toContain("FOR UPDATE OF n SKIP LOCKED");
    expect(statements[3]).toContain(`n.attempt_count < $1`);
    expect(NARRATIVE_MAX_ATTEMPTS).toBe(3);
  });

  it("renewLease binds a JS Date for the new lease instead of a bare now()", async () => {
    // This repo's live trap: `timestamp` columns hold UTC wall time via
    // Drizzle, but a bare now() in raw SQL resolves against the session
    // timezone (KST here) — a 9h gap. renewLease must bind a computed Date
    // as a query parameter, matching claimAutoBatch's leaseExpiresAt, not
    // call now() in the SQL text.
    const statements: string[] = [];
    const dialect = new PgDialect();
    const execute = vi.fn(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, " ").trim());
      return { rows: [] };
    });
    const db = { execute } as unknown as Database;

    await createDatabaseNarrativeStore(db).renewLease(claim, NOW);

    expect(statements[0]).toContain("UPDATE period_narratives");
    expect(statements[0]).not.toMatch(/now\(\)/i);
    expect(statements[0]).toContain("status = 'generating'");
    expect(statements[0]).toContain("generation_started_at = ");
    expect(statements[0]).toContain("lease_expires_at = $1");
  });
});
