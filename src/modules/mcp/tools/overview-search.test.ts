import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-handler";
import { MASK } from "../serialize";
import { overviewTool, searchTool } from "./overview-search";
import { callTool, TEST_USER_ID, toolContext } from "./test-context";

const mocks = vi.hoisted(() => ({
  findSnapshot: vi.fn(),
  enqueueSnapshot: vi.fn(),
  narrativeFind: vi.fn(),
  searchRecords: vi.fn(),
  loadTransferEvidence: vi.fn(),
}));
vi.mock("@/modules/overview/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/overview/service")>();
  return {
    ...actual,
    createDatabaseOverviewStore: () => ({
      findSnapshot: mocks.findSnapshot,
      enqueueSnapshot: mocks.enqueueSnapshot,
    }),
  };
});
vi.mock("@/modules/overview/narrative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/overview/narrative")>();
  return { ...actual, createDatabaseNarrativeStore: () => ({ find: mocks.narrativeFind }) };
});
vi.mock("@/modules/search/service", () => ({ searchRecords: mocks.searchRecords }));
vi.mock("./data", () => ({ loadTransferEvidence: mocks.loadTransferEvidence }));

const envelope = (data: unknown) => ({
  data,
  status: "ready",
  computedAt: "2026-11-10T00:00:00.000Z",
  computeVersion: 4,
  errorCode: null,
});

beforeEach(() => {
  mocks.narrativeFind.mockResolvedValue(null);
});

describe("overview tool", () => {
  it("serves a pending snapshot as stale without enqueueing anything", async () => {
    mocks.findSnapshot.mockResolvedValue({
      status: "pending",
      updatedAt: new Date("2026-11-13T00:00:00Z"),
      coding: envelope({ totalCommits: 3 }),
      location: envelope({ derived: { visits: { count: 1 } }, heatmap: [{ lat: 1 }, { lat: 2 }] }),
      health: null,
      spending: null,
      assets: null,
    });
    const out = await callTool(overviewTool, { periodType: "month", periodKey: "2026-11" });
    expect(out.structured).toMatchObject({
      status: "pending",
      stale: true,
      computedAt: "2026-11-10T09:00:00+09:00",
    });
    const domains = out.structured.domains as Record<string, { data: Record<string, unknown> }>;
    expect(domains.location.data).toEqual({
      derived: { visits: { count: 1 } },
      heatmapPointCount: 2,
    });
    expect(mocks.enqueueSnapshot).not.toHaveBeenCalled();
    expect(out.structured.narrative).toMatchObject({ status: "missing" });
  });

  it("defaults to the current period and reports a never-computed snapshot", async () => {
    mocks.findSnapshot.mockResolvedValue(null);
    const out = await callTool(overviewTool, { periodType: "week" });
    expect(mocks.findSnapshot).toHaveBeenCalledWith(TEST_USER_ID, "week", "2026-W46");
    expect(out.structured).toMatchObject({ status: "missing", stale: false, domains: null });
    expect(mocks.enqueueSnapshot).not.toHaveBeenCalled();
  });

  it("returns the narrative without its error text, and none for recent", async () => {
    mocks.findSnapshot.mockResolvedValue(null);
    mocks.narrativeFind.mockResolvedValue({
      status: "ready",
      content: "이번 달은…",
      generatedAt: new Date("2026-11-01T00:00:00Z"),
      model: "claude-opus-5-5",
      lastError: "secret provider text",
    });
    const out = await callTool(overviewTool, { periodType: "month", periodKey: "2026-10" });
    expect(out.structured.narrative).toEqual({
      status: "ready",
      content: "이번 달은…",
      generatedAt: "2026-11-01T09:00:00+09:00",
      model: "claude-opus-5-5",
    });
    const recent = await callTool(overviewTool, { periodType: "recent" });
    expect(recent.structured.narrative).toBeNull();
  });

  it("rejects a malformed period key", async () => {
    await expect(
      callTool(overviewTool, { periodType: "month", periodKey: "2026-13" })
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("search tool", () => {
  beforeEach(() => {
    mocks.searchRecords.mockResolvedValue({
      items: [
        {
          id: "tx1",
          source: "spending",
          title: "김철수",
          description: "30000원",
          date: "2026-11-12",
          href: "/x",
          occurredAt: "2026-11-12T03:00:00.000Z",
          amount: 30000,
          category: null,
        },
        {
          id: "tx2",
          source: "spending",
          title: "스타벅스",
          description: "5000원",
          date: "2026-11-12",
          href: "/x",
          occurredAt: "2026-11-12T03:00:00.000Z",
          amount: 5000,
          category: "cafe",
        },
        {
          id: "c1",
          source: "commit",
          title: "fix: bug",
          description: "me/repo",
          date: "2026-11-12",
          href: "/x",
        },
      ],
      hasMore: false,
      page: 1,
      counts: { commit: 1, spending: 2, visit: 0, trip: 0 },
    });
    mocks.loadTransferEvidence.mockResolvedValue(
      new Map([
        ["tx1", { rawTitle: "김철수님이 30,000원을 보냈어요", rawText: "", isSelfTransfer: false }],
        ["tx2", { rawTitle: "5,000원 결제", rawText: "카드 | 스타벅스", isSelfTransfer: false }],
      ])
    );
  });

  it("uses the web search parser defaults and masks transfer counterparties", async () => {
    const out = await callTool(searchTool, { q: "커피" });
    expect(mocks.searchRecords).toHaveBeenCalledWith(expect.anything(), TEST_USER_ID, {
      q: "커피",
      from: "2026-10-15",
      to: "2026-11-13",
      source: "all",
      page: 1,
    });
    const items = out.structured.items as Record<string, unknown>[];
    expect(items.map((i) => i.title)).toEqual([MASK, "스타벅스", "fix: bug"]);
    expect(items[0].occurredAt).toBe("2026-11-12T12:00:00+09:00");
    expect(items[0]).not.toHaveProperty("href");
  });

  it("shows counterparties to a sensitive-read token", async () => {
    const out = await callTool(searchTool, {}, toolContext(["read", "sensitive-read"]));
    expect((out.structured.items as { title: string }[])[0].title).toBe("김철수");
    expect(mocks.loadTransferEvidence).not.toHaveBeenCalled();
  });

  it("rejects a range over 366 days with the web's Korean message", async () => {
    await expect(callTool(searchTool, { from: "2025-01-01", to: "2026-11-13" })).rejects.toThrow(
      /최대 366일/
    );
  });
});
