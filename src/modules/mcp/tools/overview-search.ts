/**
 * Retrospective read tools: `overview` (stored period snapshot + AI narrative)
 * and `search` (the /search record search).
 *
 * `overview` only reads: it never enqueues a recompute or a narrative. A
 * pending/computing snapshot is reported as such, with `stale: true` when it
 * still carries the last computed numbers. The location heatmap payload is
 * replaced by its point count (it is large and not useful to an agent).
 *
 * `search` parses its arguments with the web's `parseSearchInput` (same
 * defaults and limits) and masks the counterparty of personal transfers.
 */

import { z } from "zod";
import { createDatabaseNarrativeStore, createNarrativeService } from "@/modules/overview/narrative";
import { getPeriodKey, type PeriodType, periodTypes } from "@/modules/overview/period";
import {
  createDatabaseOverviewStore,
  createOverviewService,
  type OverviewSnapshotDomains,
} from "@/modules/overview/service";
import { parseSearchInput } from "@/modules/search/input";
import { searchRecords } from "@/modules/search/service";
import { SEARCH_SOURCES, type SearchItem } from "@/modules/search/types";
import { EXPENSE_CATEGORIES } from "@/modules/spending/categories";
import { accessFromScopes } from "../serialize";
import { defineTool, type McpTool } from "../server";
import { dayRangeFields, kstIso, NO_RECORDS, READ_ANNOTATIONS } from "./common";
import { loadTransferEvidence } from "./data";
import { maskIfPersonalTransfer } from "./transaction-fields";

const DOMAIN_KEYS = ["coding", "location", "health", "spending", "portfolio"] as const;
type DomainKey = (typeof DOMAIN_KEYS)[number];

function serializeDomains(
  domains: OverviewSnapshotDomains,
  wanted: ReadonlySet<DomainKey>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DOMAIN_KEYS) {
    if (!wanted.has(key)) continue;
    const envelope = domains[key];
    if (!envelope) {
      out[key] = null;
      continue;
    }
    let data: unknown = envelope.data;
    if (key === "location" && data && typeof data === "object") {
      const { heatmap, ...rest } = data as { heatmap?: unknown[] } & Record<string, unknown>;
      data = { ...rest, heatmapPointCount: Array.isArray(heatmap) ? heatmap.length : 0 };
    }
    out[key] = {
      status: envelope.status,
      computedAt: kstIso(envelope.computedAt),
      data,
    };
  }
  return out;
}

export const overviewTool = defineTool({
  name: "overview",
  kind: "read",
  scope: "read",
  title: "기간 회고",
  description:
    "주·월·년(또는 recent: 최근 14일) 기간의 미리 계산된 overview 스냅샷(코딩·위치·건강·지출·자산)과 " +
    "AI 회고문을 돌려줍니다. 재계산을 요청하지 않는 조회입니다. status가 pending/computing이면 " +
    "아직 계산 중이고, stale=true면 이전에 계산된 숫자입니다. periodKey 형식: recent YYYY-MM-DD, " +
    "week YYYY-Www, month YYYY-MM, year YYYY (생략하면 현재 기간).",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    periodType: z.enum(periodTypes).describe("recent | week | month | year"),
    periodKey: z.string().max(10).optional().describe("기간 키. 생략하면 현재 기간."),
    domains: z.array(z.enum(DOMAIN_KEYS)).min(1).optional().describe("받을 영역 (기본: 전체)."),
    includeNarrative: z.boolean().optional().describe("AI 회고문 포함 여부 (기본 true)."),
  }),
  argRules: { periodType: "keep", periodKey: "keep", domains: "keep", includeNarrative: "keep" },
  run: async (ctx, input) => {
    const periodType = input.periodType as PeriodType;
    const periodKey = input.periodKey ?? getPeriodKey(periodType, ctx.now);
    const snapshot = await createOverviewService(createDatabaseOverviewStore(ctx.db)).getSnapshot(
      ctx.userId,
      periodType,
      periodKey
    );

    let narrative: Record<string, unknown> | null = null;
    if (periodType !== "recent" && input.includeNarrative !== false) {
      const n = await createNarrativeService(createDatabaseNarrativeStore(ctx.db), null).get(
        ctx.userId,
        periodType,
        periodKey
      );
      narrative =
        n.status === "missing"
          ? { status: "missing", content: null, generatedAt: null, model: null }
          : {
              status: n.status,
              content: n.content ?? null,
              generatedAt: kstIso(n.generatedAt),
              model: n.model ?? null,
            };
    }

    const wanted = new Set<DomainKey>(input.domains ?? DOMAIN_KEYS);
    const hasDomains = "domains" in snapshot;
    const stale = "stale" in snapshot && snapshot.stale === true;
    const messages: Record<string, string> = {
      missing: "이 기간의 스냅샷이 아직 없습니다. 웹 화면에서 열면 계산이 예약됩니다.",
      pending: "재계산을 기다리는 중입니다.",
      computing: "계산 중입니다.",
    };
    return {
      structured: {
        periodType,
        periodKey,
        status: snapshot.status,
        stale,
        computedAt: hasDomains ? kstIso(snapshot.computedAt) : null,
        domains: hasDomains ? serializeDomains(snapshot.domains, wanted) : null,
        narrative,
        message:
          snapshot.status === "ready" || snapshot.status === "failed"
            ? null
            : (stale ? "이전 계산 결과입니다. " : "") + messages[snapshot.status],
      },
      count: null,
    };
  },
});

export const searchTool = defineTool({
  name: "search",
  kind: "read",
  scope: "read",
  title: "기록 검색",
  description:
    "커밋·지출·방문·여행을 한 번에 검색합니다(웹 /search와 같은 규칙). q는 포함 검색(대소문자 무시)이며, " +
    "기간은 한국 날짜로 기본 최근 30일, 최대 366일입니다. 한 페이지 30건, page로 다음 페이지(최대 100). " +
    "hours는 한국 시간 시간대(예: 22-3은 자정을 넘김, 여행 제외)입니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    q: z.string().max(200).optional().describe("검색어 (생략하면 기간 안 전체)."),
    ...dayRangeFields,
    source: z.enum(SEARCH_SOURCES).optional().describe("all | commit | spending | visit | trip"),
    category: z.enum(EXPENSE_CATEGORIES).optional().describe("이 지출 카테고리만 (지출만)."),
    hours: z
      .string()
      .regex(/^\d{1,2}-\d{1,2}$/)
      .optional()
      .describe("한국 시간 시간대 H-H (시작 포함, 끝 미포함)."),
    repo: z.string().max(300).optional().describe("이 저장소(owner/name)의 커밋만."),
    page: z.number().int().min(1).max(100).optional().describe("페이지 (기본 1)."),
  }),
  argRules: {
    q: "text",
    from: "keep",
    to: "keep",
    source: "keep",
    category: "keep",
    hours: "keep",
    repo: "keep",
    page: "keep",
  },
  run: async (ctx, input) => {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.from) params.set("from", input.from);
    if (input.to) params.set("to", input.to);
    if (input.source) params.set("source", input.source);
    if (input.category) params.set("category", input.category);
    if (input.hours) params.set("hours", input.hours);
    if (input.repo) params.set("repo", input.repo);
    if (input.page) params.set("page", String(input.page));
    // ApiError(400) with a Korean message → the wrapper returns it as isError.
    const parsed = parseSearchInput(params, ctx.now);
    const result = await searchRecords(ctx.db, ctx.userId, parsed);

    const access = accessFromScopes(ctx.scopes);
    const spendingIds = result.items.filter((i) => i.source === "spending").map((i) => i.id);
    const evidence = access.sensitive
      ? new Map()
      : await loadTransferEvidence(ctx.db, ctx.userId, spendingIds);

    const items = result.items.map((item: SearchItem) => ({
      id: item.id,
      source: item.source,
      title:
        item.source === "spending"
          ? maskIfPersonalTransfer(item.title, evidence.get(item.id), access)
          : item.title,
      description: item.description,
      date: item.date,
      occurredAt: kstIso(item.occurredAt),
      amount: item.amount ?? null,
      category: item.category ?? null,
      repository: item.repository ?? null,
      groupTotal: item.groupTotal ?? null,
    }));

    return {
      structured: {
        query: { from: parsed.from, to: parsed.to, source: parsed.source, page: parsed.page },
        items,
        counts: result.counts ?? null,
        hasMore: result.hasMore,
        nextPage: result.hasMore ? parsed.page + 1 : null,
        message: items.length === 0 ? NO_RECORDS : null,
      },
      count: items.length,
    };
  },
});

export const OVERVIEW_SEARCH_TOOLS: McpTool[] = [overviewTool, searchTool];
