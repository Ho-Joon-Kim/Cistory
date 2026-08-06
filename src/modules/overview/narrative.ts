import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  type PeriodDomainEnvelope,
  type PeriodNarrativeStatus,
  type PeriodType,
  periodNarratives,
} from "@/db/schema";
import type { ClaudeAdapter } from "@/lib/adapters/ai/claude";
import { DEFAULT_CLAUDE_MODEL } from "@/lib/adapters/ai/claude";
import { ApiError } from "@/lib/api-handler";
import { isCanonicalPeriodKey } from "./period";

export type NarrativePeriodType = Exclude<PeriodType, "recent">;

export const NARRATIVE_BATCH_SIZE = 5;
export const NARRATIVE_MAX_ATTEMPTS = 3;
export const NARRATIVE_LEASE_MS = 8 * 60 * 1000;
export const NARRATIVE_MANUAL_COOLDOWN_MS = 5 * 60 * 1000;
export const NARRATIVE_MAX_INPUT_CHARS = 24_000;

export interface NarrativeSnapshotInput {
  coding: PeriodDomainEnvelope | null;
  location: PeriodDomainEnvelope | null;
  health: PeriodDomainEnvelope | null;
  spending: PeriodDomainEnvelope | null;
  assets: PeriodDomainEnvelope | null;
}

export interface StoredNarrative {
  status: PeriodNarrativeStatus;
  content: string | null;
  generatedAt: Date | null;
  model: string | null;
  lastError: string | null;
}

export interface NarrativeClaim {
  userId: string;
  periodType: NarrativePeriodType;
  periodKey: string;
  generationStartedAt: Date;
  snapshot: NarrativeSnapshotInput;
}

export type ManualClaimOutcome =
  | { status: "acquired"; claim: NarrativeClaim }
  | { status: "not_ready" }
  | { status: "concurrent" }
  | { status: "too_frequent" };

export interface NarrativeStore {
  find(
    userId: string,
    periodType: NarrativePeriodType,
    periodKey: string
  ): Promise<StoredNarrative | null>;
  acquireManual(input: {
    userId: string;
    periodType: NarrativePeriodType;
    periodKey: string;
    now: Date;
  }): Promise<ManualClaimOutcome>;
  claimAutoBatch(now: Date, limit: number): Promise<NarrativeClaim[]>;
  /**
   * Extends a claimed row's lease without touching generationStartedAt (the
   * identity `complete`/`fail` match on). Returns whether it actually
   * updated the row — false means another worker already reclaimed it (its
   * lease expired and a later `claimAutoBatch` reset + re-claimed it out
   * from under this run), and the caller must not proceed to `generate()`
   * for it: that would run a second paid call on a row it no longer owns.
   */
  renewLease(claim: NarrativeClaim, now: Date): Promise<boolean>;
  complete(claim: NarrativeClaim, content: string, model: string, now: Date): Promise<boolean>;
  fail(claim: NarrativeClaim, error: string, now: Date): Promise<void>;
}

function parseNarrativePeriod(periodType: string, periodKey: string): NarrativePeriodType {
  if (periodType !== "week" && periodType !== "month" && periodType !== "year") {
    throw new ApiError(400, "회고문을 지원하지 않는 기간입니다", "INVALID_PERIOD");
  }

  if (!isCanonicalPeriodKey(periodType, periodKey)) {
    throw new ApiError(400, "유효하지 않은 기간입니다", "INVALID_PERIOD");
  }
  return periodType;
}

const promptFiles: Record<NarrativePeriodType, string> = {
  week: "overview-narrative-week.txt",
  month: "overview-narrative-month.txt",
  year: "overview-narrative-year.txt",
};

export function buildNarrativePrompt(
  periodType: NarrativePeriodType,
  periodKey: string,
  snapshot: NarrativeSnapshotInput
) {
  const system = readFileSync(
    join(process.cwd(), "prompts", promptFiles[periodType]),
    "utf8"
  ).trim();
  const input = serializeNarrativeInput(snapshot);
  return {
    system,
    prompt: `기간: ${periodType} ${periodKey}\n\n확정된 대시보드 데이터:\n${input}`,
  };
}

function serializeNarrativeInput(snapshot: NarrativeSnapshotInput): string {
  const original = JSON.stringify(snapshot);
  if (original.length <= NARRATIVE_MAX_INPUT_CHARS) return original;

  let previewLength = 2_000;
  while (previewLength >= 0) {
    const projected = Object.fromEntries(
      Object.entries(snapshot).map(([domain, envelope]) => [
        domain,
        envelope
          ? {
              status: envelope.status,
              computedAt: envelope.computedAt,
              computeVersion: envelope.computeVersion,
              errorCode: envelope.errorCode,
              dataPreview: JSON.stringify(envelope.data).slice(0, previewLength),
              truncated: true,
            }
          : null,
      ])
    );
    const serialized = JSON.stringify(projected);
    if (serialized.length <= NARRATIVE_MAX_INPUT_CHARS) return serialized;
    previewLength -= 250;
  }

  return JSON.stringify({ truncated: true });
}

export function createNarrativeService(
  store: NarrativeStore,
  ai: Pick<ClaudeAdapter, "generateText"> | null,
  model = DEFAULT_CLAUDE_MODEL
) {
  async function get(userId: string, rawPeriodType: string, periodKey: string) {
    const periodType = parseNarrativePeriod(rawPeriodType, periodKey);
    const narrative = await store.find(userId, periodType, periodKey);
    return narrative
      ? {
          status: narrative.status,
          periodType,
          periodKey,
          content: narrative.content,
          generatedAt: narrative.generatedAt?.toISOString() ?? null,
          model: narrative.model,
          error: narrative.lastError,
        }
      : { status: "missing" as const, periodType, periodKey };
  }

  async function generate(claim: NarrativeClaim, now: Date): Promise<boolean> {
    try {
      if (!ai) throw new Error("Narrative AI is not configured");
      const prompt = buildNarrativePrompt(claim.periodType, claim.periodKey, claim.snapshot);
      const result = await ai.generateText({
        ...prompt,
        maxTokens: 8000,
        thinking: "adaptive",
        effort: "medium",
      });
      const content = result.content.trim();
      if (!content) throw new Error("AI returned an empty narrative");
      return store.complete(claim, content, model, now);
    } catch (error) {
      await store.fail(claim, error instanceof Error ? error.message : String(error), now);
      return false;
    }
  }

  /**
   * Renews a single claim's lease, the same way `generate()` handles an AI
   * failure: a thrown DB error is caught, recorded via `store.fail`, and
   * reported as "not renewed" rather than propagating — so one row's DB
   * problem can't abort the rest of a batch.
   */
  async function renewOrFail(claim: NarrativeClaim): Promise<boolean> {
    const renewNow = new Date();
    try {
      return await store.renewLease(claim, renewNow);
    } catch (error) {
      await store.fail(claim, error instanceof Error ? error.message : String(error), renewNow);
      return false;
    }
  }

  /**
   * Renews the lease for `claims[i]` and every claim after it that hasn't
   * been processed yet — not just `claims[i]`. claimAutoBatch stamps one
   * lease_expires_at across the whole batch, but rows generate
   * sequentially, so refreshing only the current row still lets a slow
   * earlier row push a later, still-waiting row's lease past
   * NARRATIVE_LEASE_MS before its own turn arrives. Renewing the whole
   * remaining tail on every iteration keeps every not-yet-started row
   * fresh the entire time it's waiting, not just at the instant its turn
   * begins. Batches are capped at NARRATIVE_BATCH_SIZE (5), so the extra
   * calls this costs are trivial.
   *
   * Returns whether `claims[i]` — the row about to be generated — is still
   * ours. The caller must skip `generate()` for it when this is false:
   * calling it anyway would run a second paid AI call on a row another
   * worker now owns (the write would ultimately be refused by `complete`'s
   * guard, but the spend already happened).
   */
  async function renewPendingLeases(claims: NarrativeClaim[], i: number): Promise<boolean> {
    let currentIsRenewed = false;
    for (let j = i; j < claims.length; j++) {
      const renewed = await renewOrFail(claims[j]);
      if (j === i) currentIsRenewed = renewed;
    }
    return currentIsRenewed;
  }

  return {
    get,

    async regenerate(
      userId: string,
      rawPeriodType: string,
      periodKey: string,
      now: Date = new Date()
    ) {
      const periodType = parseNarrativePeriod(rawPeriodType, periodKey);
      const outcome = await store.acquireManual({ userId, periodType, periodKey, now });
      if (outcome.status === "not_ready") {
        throw new ApiError(409, "확정된 스냅샷이 필요합니다", "SNAPSHOT_NOT_READY");
      }
      if (outcome.status === "concurrent") {
        throw new ApiError(409, "이미 회고문을 생성 중입니다", "NARRATIVE_GENERATING");
      }
      if (outcome.status === "too_frequent") {
        throw new ApiError(429, "회고문 재생성 요청이 너무 잦습니다", "NARRATIVE_RATE_LIMIT");
      }

      if (!(await generate(outcome.claim, new Date()))) {
        throw new ApiError(502, "회고문 생성에 실패했습니다", "NARRATIVE_GENERATION_FAILED");
      }
      return get(userId, periodType, periodKey);
    },

    async processAutoBatch(now: Date = new Date(), limit = NARRATIVE_BATCH_SIZE) {
      const claims = await store.claimAutoBatch(now, limit);
      let generated = 0;
      for (let i = 0; i < claims.length; i++) {
        // See renewPendingLeases: refreshes this row's lease and every
        // not-yet-processed row's lease, and reports whether this row is
        // still ours. Skip generating it if not — another worker already
        // owns it.
        if (!(await renewPendingLeases(claims, i))) continue;
        if (await generate(claims[i], new Date())) generated++;
      }
      return { claimed: claims.length, generated, failed: claims.length - generated };
    },
  };
}

function snapshotFromRow(row: Record<string, unknown>): NarrativeSnapshotInput {
  return {
    coding: (row.coding as PeriodDomainEnvelope | null) ?? null,
    location: (row.location as PeriodDomainEnvelope | null) ?? null,
    health: (row.health as PeriodDomainEnvelope | null) ?? null,
    spending: (row.spending as PeriodDomainEnvelope | null) ?? null,
    assets: (row.assets as PeriodDomainEnvelope | null) ?? null,
  };
}

function claimFromRow(row: Record<string, unknown>): NarrativeClaim {
  return {
    userId: String(row.userId),
    periodType: row.periodType as NarrativePeriodType,
    periodKey: String(row.periodKey),
    generationStartedAt: row.generationStartedAt as Date,
    snapshot: snapshotFromRow(row),
  };
}

export function createDatabaseNarrativeStore(db: Database): NarrativeStore {
  return {
    async find(userId, periodType, periodKey) {
      const [row] = await db
        .select({
          status: periodNarratives.status,
          content: periodNarratives.content,
          generatedAt: periodNarratives.generatedAt,
          model: periodNarratives.model,
          lastError: periodNarratives.lastError,
        })
        .from(periodNarratives)
        .where(
          and(
            eq(periodNarratives.userId, userId),
            eq(periodNarratives.periodType, periodType),
            eq(periodNarratives.periodKey, periodKey)
          )
        )
        .limit(1);
      return row ?? null;
    },

    async acquireManual({ userId, periodType, periodKey, now }) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))`);
        const snapshot = await tx.execute<Record<string, unknown>>(sql`
          SELECT coding, location, health, spending, assets
          FROM period_snapshots
          WHERE user_id = ${userId} AND period_type = ${periodType} AND period_key = ${periodKey}
            AND status = 'ready' AND finalized_at IS NOT NULL
          FOR SHARE
        `);
        const snapshotRow = snapshot.rows[0];
        if (!snapshotRow) return { status: "not_ready" } as const;

        const existing = await tx.execute<{
          status: PeriodNarrativeStatus;
          leaseExpiresAt: Date | null;
          generatedAt: Date | null;
        }>(sql`
          SELECT status, lease_expires_at AS "leaseExpiresAt", generated_at AS "generatedAt"
          FROM period_narratives
          WHERE user_id = ${userId} AND period_type = ${periodType} AND period_key = ${periodKey}
          FOR UPDATE
        `);
        const row = existing.rows[0];
        if (row?.status === "generating" && row.leaseExpiresAt && row.leaseExpiresAt > now) {
          return { status: "concurrent" } as const;
        }
        const latestForUser = await tx.execute<{ generatedAt: Date | null }>(sql`
          SELECT max(COALESCE(generated_at, generation_started_at)) AS "generatedAt"
          FROM period_narratives
          WHERE user_id = ${userId}
        `);
        const latestGeneratedAt = latestForUser.rows[0]?.generatedAt;
        if (
          latestGeneratedAt &&
          latestGeneratedAt > new Date(now.getTime() - NARRATIVE_MANUAL_COOLDOWN_MS)
        ) {
          return { status: "too_frequent" } as const;
        }

        const leaseExpiresAt = new Date(now.getTime() + NARRATIVE_LEASE_MS);
        await tx.execute(sql`
          INSERT INTO period_narratives (
            user_id, period_type, period_key, status, generation_started_at,
            lease_expires_at, attempt_count, updated_at
          ) VALUES (
            ${userId}, ${periodType}, ${periodKey}, 'generating', ${now},
            ${leaseExpiresAt}, 1, ${now}
          )
          ON CONFLICT (user_id, period_type, period_key) DO UPDATE SET
            status = 'generating', generation_started_at = EXCLUDED.generation_started_at,
            lease_expires_at = EXCLUDED.lease_expires_at,
            attempt_count = period_narratives.attempt_count + 1,
            last_error = NULL, updated_at = EXCLUDED.updated_at
        `);
        return {
          status: "acquired",
          claim: {
            userId,
            periodType,
            periodKey,
            generationStartedAt: now,
            snapshot: snapshotFromRow(snapshotRow),
          },
        } as const;
      });
    },

    async claimAutoBatch(now, limit) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1784707207)`);
        await tx.execute(sql`
          UPDATE period_narratives SET status = 'pending', generation_started_at = NULL,
            lease_expires_at = NULL, updated_at = ${now}
          WHERE status = 'generating' AND lease_expires_at <= ${now}
        `);
        await tx.execute(sql`
          INSERT INTO period_narratives (user_id, period_type, period_key, status)
          SELECT s.user_id, s.period_type, s.period_key, 'pending'
          FROM period_snapshots s
          LEFT JOIN period_narratives n ON n.user_id = s.user_id
            AND n.period_type = s.period_type AND n.period_key = s.period_key
          WHERE s.status = 'ready' AND s.finalized_at IS NOT NULL
            AND s.period_type IN ('week', 'month', 'year') AND n.id IS NULL
          ORDER BY s.finalized_at, s.period_key
          LIMIT ${limit}
          ON CONFLICT (user_id, period_type, period_key) DO NOTHING
        `);

        const leaseExpiresAt = new Date(now.getTime() + NARRATIVE_LEASE_MS);
        const claimed = await tx.execute<Record<string, unknown>>(sql`
          WITH candidates AS (
            SELECT n.id
            FROM period_narratives n
            JOIN period_snapshots s ON s.user_id = n.user_id
              AND s.period_type = n.period_type AND s.period_key = n.period_key
            WHERE n.status IN ('pending', 'failed')
              AND n.attempt_count < ${NARRATIVE_MAX_ATTEMPTS}
              AND s.status = 'ready' AND s.finalized_at IS NOT NULL
              AND s.period_type IN ('week', 'month', 'year')
            ORDER BY s.finalized_at, s.period_key
            FOR UPDATE OF n SKIP LOCKED
            LIMIT ${limit}
          )
          UPDATE period_narratives n SET status = 'generating', generation_started_at = ${now},
            lease_expires_at = ${leaseExpiresAt}, attempt_count = n.attempt_count + 1,
            last_error = NULL, updated_at = ${now}
          FROM candidates c, period_snapshots s
          WHERE n.id = c.id AND s.user_id = n.user_id
            AND s.period_type = n.period_type AND s.period_key = n.period_key
          RETURNING n.user_id AS "userId", n.period_type AS "periodType",
            n.period_key AS "periodKey", n.generation_started_at AS "generationStartedAt",
            s.coding, s.location, s.health, s.spending, s.assets
        `);
        return claimed.rows.map(claimFromRow);
      });
    },

    async renewLease(claim, now) {
      // Same UTC-wall-time pattern as claimAutoBatch's leaseExpiresAt: bind a
      // JS Date, never a bare `now()` — a raw SQL now() resolves against the
      // session timezone (KST here), a 9h gap from every Drizzle-written
      // timestamp column.
      const leaseExpiresAt = new Date(now.getTime() + NARRATIVE_LEASE_MS);
      const result = await db.execute(sql`
        UPDATE period_narratives SET lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}
        WHERE user_id = ${claim.userId} AND period_type = ${claim.periodType}
          AND period_key = ${claim.periodKey} AND status = 'generating'
          AND generation_started_at = ${claim.generationStartedAt}
        RETURNING id
      `);
      return result.rows.length === 1;
    },

    async complete(claim, content, model, now) {
      const result = await db.execute(sql`
        UPDATE period_narratives SET status = 'ready', content = ${content}, model = ${model},
          generated_at = ${now}, generation_started_at = NULL, lease_expires_at = NULL,
          last_error = NULL, updated_at = ${now}
        WHERE user_id = ${claim.userId} AND period_type = ${claim.periodType}
          AND period_key = ${claim.periodKey} AND status = 'generating'
          AND generation_started_at = ${claim.generationStartedAt}
        RETURNING id
      `);
      return result.rows.length === 1;
    },

    async fail(claim, error, now) {
      await db.execute(sql`
        UPDATE period_narratives
        SET status = CASE WHEN content IS NULL THEN 'failed' ELSE 'ready' END,
          lease_expires_at = NULL, last_error = ${error.slice(0, 2000)}, updated_at = ${now}
        WHERE user_id = ${claim.userId} AND period_type = ${claim.periodType}
          AND period_key = ${claim.periodKey} AND status = 'generating'
          AND generation_started_at = ${claim.generationStartedAt}
      `);
    },
  };
}
