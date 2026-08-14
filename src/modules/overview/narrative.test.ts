process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ApiError } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import {
  buildNarrativePrompt,
  createDatabaseNarrativeStore,
  createNarrativeService,
  NARRATIVE_CHARS_PER_TOKEN,
  NARRATIVE_LEASE_MS,
  NARRATIVE_MAX_ATTEMPTS,
  NARRATIVE_MAX_INPUT_CHARS,
  NARRATIVE_MAX_INPUT_TOKENS,
  NARRATIVE_MAX_TOKEN_PROBES,
  type NarrativeClaim,
  type NarrativeStore,
  serializeNarrativeInput,
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
    renewLease: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

/**
 * Stand-in for the real tokenizer. The measured ratio on real snapshots is
 * 0.497–0.519 tokens per character, so half the character count is a faithful
 * fake — close enough that tests exercise the same branch the API would.
 */
function fakeTokenCount({ prompt }: { prompt: string }) {
  return Math.ceil(prompt.length / NARRATIVE_CHARS_PER_TOKEN);
}

function ai(content = "회고문") {
  return {
    generateText: vi.fn(async () => ({
      content,
      usage: { inputTokens: 10, outputTokens: 20 },
      stopReason: "end_turn" as const,
    })),
    countTokens: vi.fn(async (options: { prompt: string }) => fakeTokenCount(options)),
  };
}

/** A snapshot whose single populated domain serializes to roughly `chars`. */
function snapshotOfSize(chars: number) {
  const filler = "x".repeat(Math.max(1, Math.ceil(chars / 60)));
  return {
    ...snapshot,
    location: {
      status: "ready" as const,
      computedAt: NOW.toISOString(),
      computeVersion: 1,
      errorCode: null,
      data: {
        heatmap: Array.from({ length: 60 }, (_, index) => ({ index, value: filler })),
      },
    },
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

  it.each(["recent", "quarter", "month/2026-6"])(
    "rejects unsupported periods: %s",
    async (value) => {
      const [periodType, periodKey = "2026-06"] = value.split("/");
      await expect(
        createNarrativeService(store(), ai()).get("user-1", periodType, periodKey)
      ).rejects.toMatchObject({ status: 400, code: "INVALID_PERIOD" } satisfies Partial<ApiError>);
    }
  );

  it("uses distinct prompt assets for week, month, and year", async () => {
    const prompts = [
      (await buildNarrativePrompt("week", "2026-W29", snapshot)).system,
      (await buildNarrativePrompt("month", "2026-06", snapshot)).system,
      (await buildNarrativePrompt("year", "2025", snapshot)).system,
    ];
    expect(new Set(prompts).size).toBe(3);
    expect(prompts[0]).toContain("한 주");
    expect(prompts[1]).toContain("한 달");
    expect(prompts[2]).toContain("한 해");
  });

  it("projects oversized domain arrays into bounded valid JSON", async () => {
    const adapter = ai();
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
    const { prompt } = await buildNarrativePrompt("year", "2025", largeSnapshot, adapter);
    const serialized = prompt.split("확정된 대시보드 데이터:\n")[1];

    expect(fakeTokenCount({ prompt: serialized })).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_TOKENS);
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

  it("renews every not-yet-processed row's lease on each iteration, not just the current row's", async () => {
    // claimAutoBatch stamps one lease across all claimed rows, but rows
    // generate sequentially. Renewing only the current row still lets a
    // slow earlier row push a later, still-waiting row's lease stale before
    // its own turn arrives. Pin the fix: at claim N's iteration, every claim
    // from N onward gets renewed (not just N), and claim N's own generate()
    // only runs after that renewal pass.
    const claimTwo: NarrativeClaim = { ...claim, periodKey: "2026-07" };
    const repository = store({
      claimAutoBatch: vi.fn(async () => [claim, claimTwo]),
    });
    const calls: string[] = [];
    (repository.renewLease as ReturnType<typeof vi.fn>).mockImplementation(
      async (c: NarrativeClaim) => {
        calls.push(`renew:${c.periodKey}`);
        return true;
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
      "renew:2026-07",
      "generate:2026-06",
      "renew:2026-07",
      "generate:2026-07",
    ]);
  });

  it("skips generating a row whose lease renewal reports it was already reclaimed", async () => {
    // Concrete failure this pins: two earlier rows in the batch each exhaust
    // retries (~6 min each), so by the time this row's turn arrives its
    // lease has expired and a later cron tick's claimAutoBatch already
    // reset + re-claimed it. renewLease correctly reports that (returns
    // false on its own-turn call after succeeding on the earlier proactive
    // call) — the caller must not call generate() anyway, which would run a
    // second paid Opus 5 call on a row it no longer owns.
    const claimTwo: NarrativeClaim = { ...claim, periodKey: "2026-07" };
    const renewCallsByKey: Record<string, number> = {};
    const repository = store({
      claimAutoBatch: vi.fn(async () => [claim, claimTwo]),
      renewLease: vi.fn(async (c: NarrativeClaim) => {
        renewCallsByKey[c.periodKey] = (renewCallsByKey[c.periodKey] ?? 0) + 1;
        // claimTwo: succeeds on the proactive renewal (claim's turn), fails
        // from its own turn onward — simulates losing the race in between.
        if (c.periodKey === claimTwo.periodKey && renewCallsByKey[c.periodKey] >= 2) return false;
        return true;
      }),
    });
    const adapter = ai();

    const result = await createNarrativeService(repository, adapter).processAutoBatch(NOW, 2);

    expect(result).toEqual({ claimed: 2, generated: 1, failed: 1 });
    expect(adapter.generateText).toHaveBeenCalledTimes(1);
    const generatedPrompt = adapter.generateText.mock.calls[0][0].prompt as string;
    expect(generatedPrompt).toContain(claim.periodKey);
    expect(generatedPrompt).not.toContain(claimTwo.periodKey);
    expect(repository.complete).not.toHaveBeenCalledWith(
      claimTwo,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("does not let a renewLease DB error propagate out of processAutoBatch or strand the rest of the batch", async () => {
    const claimTwo: NarrativeClaim = { ...claim, periodKey: "2026-07" };
    const repository = store({
      claimAutoBatch: vi.fn(async () => [claim, claimTwo]),
      renewLease: vi.fn(async (c: NarrativeClaim) => {
        if (c.periodKey === claim.periodKey) throw new Error("connection reset");
        return true;
      }),
    });
    const adapter = ai();

    const result = await createNarrativeService(repository, adapter).processAutoBatch(NOW, 2);

    expect(result).toEqual({ claimed: 2, generated: 1, failed: 1 });
    expect(repository.fail).toHaveBeenCalledWith(claim, "connection reset", expect.any(Date));
    expect(adapter.generateText).toHaveBeenCalledTimes(1);
    const generatedPrompt = adapter.generateText.mock.calls[0][0].prompt as string;
    expect(generatedPrompt).toContain(claimTwo.periodKey);
  });
});

describe("narrative input truncation", () => {
  it("leaves an under-limit snapshot byte-identical and spends no count on it", async () => {
    const adapter = ai();
    const small = snapshotOfSize(1_000);

    const serialized = await serializeNarrativeInput(small, adapter);

    expect(serialized).toBe(JSON.stringify(small));
    // 문자 수가 토큰 한도 이하면 토큰 수도 한도 이하다 — 왕복이 답을 바꿀 수
    // 없으므로 아예 세지 않는다.
    expect(adapter.countTokens).not.toHaveBeenCalled();
  });

  it("loses roughly what it overshoots instead of collapsing to a floor", async () => {
    // 절단은 연속이어야 한다. 예산을 조금 넘겼다고 결과가 한도의 10%로
    // 떨어지면 한도를 올려도 스냅샷이 자라는 순간 같은 절벽으로 돌아온다 —
    // 실제로 연 스냅샷은 118,240자에서 12,165자로 잘렸고, 한도를 60,000토큰
    // 으로 올린 뒤에도 한도의 1.3% 아래에서 하루 약 446자씩 자라고 있었다.
    const adapter = ai();
    const justOver = snapshotOfSize(NARRATIVE_MAX_INPUT_CHARS + 2_000);

    const serialized = await serializeNarrativeInput(justOver, adapter);

    expect(serialized.length).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_CHARS);
    // `<= 한도` 만으로는 12,165자짜리 결과도 통과한다. 실제로 예산을 쓰는지
    // 크기를 직접 고정한다.
    expect(serialized.length).toBeGreaterThan(NARRATIVE_MAX_INPUT_CHARS * 0.9);
  });

  it("trims per-domain previews once the input exceeds the token limit", async () => {
    const adapter = ai();
    const huge = snapshotOfSize(NARRATIVE_MAX_INPUT_CHARS * 2);

    const serialized = await serializeNarrativeInput(huge, adapter);
    const parsed = JSON.parse(serialized);

    expect(fakeTokenCount({ prompt: serialized })).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_TOKENS);
    expect(parsed.location.truncated).toBe(true);
    expect(typeof parsed.location.dataPreview).toBe("string");
    // The envelope's own metadata survives — the narrative still knows the
    // domain computed successfully, not just that something was cut.
    expect(parsed.location.status).toBe("ready");
    expect(parsed.coding).toBeNull();
  });

  it("re-narrows using the measured ratio when the character proxy was optimistic", async () => {
    // Every character its own token: the input clears the character budget but
    // blows the token limit, which is exactly the case a character-only
    // truncation cannot see. The corrected second pass must trim it.
    const adapter = {
      countTokens: vi.fn(async ({ prompt }: { prompt: string }) => prompt.length),
    };
    const justUnderChars = snapshotOfSize(Math.floor(NARRATIVE_MAX_INPUT_CHARS * 0.9));

    const serialized = await serializeNarrativeInput(justUnderChars, adapter);

    expect(JSON.stringify(justUnderChars).length).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_CHARS);
    expect(serialized.length).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_TOKENS);
    expect(JSON.parse(serialized).location.truncated).toBe(true);
    expect(adapter.countTokens).toHaveBeenCalledTimes(2);
  });

  it("falls back to the minimal form when even maximal trimming stays over the limit", async () => {
    const adapter = { countTokens: vi.fn(async () => 10_000_000) };

    // 토큰 한도를 넘는 크기여야 계수 왕복까지 도달한다 — 그 아래는 세지 않고
    // 곧장 반환하므로 이 경로가 실행되지 않는다.
    const serialized = await serializeNarrativeInput(
      snapshotOfSize(NARRATIVE_MAX_INPUT_TOKENS + 1_000),
      adapter
    );

    expect(JSON.parse(serialized)).toEqual({ truncated: true });
  });

  it("spends no more than the fixed probe budget on one reduction", async () => {
    // 축약은 이분 탐색이라 후보가 수십 개 나온다 — 후보마다 세면 회고문 하나에
    // 왕복이 수십 번 난다.
    const adapter = { countTokens: vi.fn(async () => 10_000_000) };

    await serializeNarrativeInput(snapshotOfSize(NARRATIVE_MAX_INPUT_CHARS * 2), adapter);

    expect(adapter.countTokens.mock.calls.length).toBeLessThanOrEqual(NARRATIVE_MAX_TOKEN_PROBES);
  });

  it("keeps truncating on the character budget when token counting fails", async () => {
    // Losing the count must degrade to the old character-based behaviour, not
    // sink narrative generation — the count is a refinement, not a dependency.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const adapter = {
      countTokens: vi.fn(async () => {
        throw new Error("count_tokens unreachable");
      }),
    };
    const huge = snapshotOfSize(NARRATIVE_MAX_INPUT_CHARS * 2);

    const serialized = await serializeNarrativeInput(huge, adapter);

    expect(serialized.length).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_CHARS);
    expect(JSON.parse(serialized).location.truncated).toBe(true);
    expect(adapter.countTokens).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Narrative token count failed — falling back to the character budget",
      expect.objectContaining({ error: "count_tokens unreachable" })
    );
    warnSpy.mockRestore();
  });

  it("truncates on the character budget alone when no counter is injected", async () => {
    const huge = snapshotOfSize(NARRATIVE_MAX_INPUT_CHARS * 2);

    const serialized = await serializeNarrativeInput(huge);

    expect(serialized.length).toBeLessThanOrEqual(NARRATIVE_MAX_INPUT_CHARS);
    expect(JSON.parse(serialized).location.truncated).toBe(true);
    expect(await serializeNarrativeInput(snapshotOfSize(1_000))).toBe(
      JSON.stringify(snapshotOfSize(1_000))
    );
  });

  it("counts the serialized input, not the whole prompt, so the budget is the data budget", async () => {
    const adapter = ai();
    // 토큰 한도를 넘되 문자 한도 안에 있는 크기 — 계수는 돌지만 축약은 없어
    // 무엇을 세는지 원본과 바로 대조할 수 있다.
    const sized = snapshotOfSize(NARRATIVE_MAX_INPUT_TOKENS + 1_000);

    await buildNarrativePrompt("year", "2025", sized, adapter);

    const counted = adapter.countTokens.mock.calls[0][0].prompt;
    expect(counted).toBe(JSON.stringify(sized));
    expect(counted).not.toContain("확정된 대시보드 데이터");
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

    const renewed = await createDatabaseNarrativeStore(db).renewLease(claim, NOW);

    expect(statements[0]).toContain("UPDATE period_narratives");
    expect(statements[0]).not.toMatch(/now\(\)/i);
    expect(statements[0]).toContain("status = 'generating'");
    expect(statements[0]).toContain("generation_started_at = ");
    expect(statements[0]).toContain("lease_expires_at = $1");
    expect(statements[0]).toContain("RETURNING id");
    // The mocked execute reports no matching row, so renewLease must report
    // the loss via its return value rather than assuming success.
    expect(renewed).toBe(false);
  });
});
