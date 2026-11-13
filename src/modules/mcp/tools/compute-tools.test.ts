import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadRebalanceInputs, computeTravelTimes } = vi.hoisted(() => ({
  loadRebalanceInputs: vi.fn(),
  computeTravelTimes: vi.fn(),
}));

vi.mock("@/modules/portfolio/rebalance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/portfolio/rebalance")>()),
  loadRebalanceInputs,
}));
vi.mock("@/modules/location/travel-time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/location/travel-time")>()),
  computeTravelTimes,
}));

import { summarizeArgs } from "../audit";
import { McpInputError, McpToolError } from "../errors";
import type { McpToolContext } from "../server";
import { contributionRebalanceTool, REBALANCE_TOOLS } from "./rebalance";
import { endpointFromInput, TRAVEL_TIME_TOOLS, travelTimeTool } from "./travel-time";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PLACE = "22222222-2222-4222-8222-222222222222";

function ctx(): McpToolContext {
  return {
    db: {} as McpToolContext["db"],
    userId: "u1",
    tokenId: "t1",
    tokenName: "agent",
    scopes: ["read"],
    ip: null,
    country: null,
    now: new Date("2026-11-13T09:00:00+09:00"),
  };
}

describe("compute tool definitions", () => {
  it("are read tools with explicit read-only annotations", () => {
    for (const tool of [...REBALANCE_TOOLS, ...TRAVEL_TIME_TOOLS]) {
      expect(tool.kind).toBe("read");
      expect(tool.scope).toBe("read");
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    expect([...REBALANCE_TOOLS, ...TRAVEL_TIME_TOOLS].map((t) => t.name)).toEqual([
      "contribution_rebalance",
      "travel_time",
    ]);
  });

  it("travel_time audit summary drops coordinates and keeps ids and hours", () => {
    const summary = summarizeArgs(
      {
        originLat: 37.5,
        originLon: 127,
        destinationPlaceId: PLACE,
        fromHour: 7,
        toHour: 9,
      },
      travelTimeTool.argRules
    );
    expect(summary).toEqual({ destinationPlaceId: PLACE, fromHour: 7, toHour: 9 });
  });
});

describe("contribution_rebalance", () => {
  beforeEach(() => loadRebalanceInputs.mockReset());

  it("returns per-holding buys with the base snapshot date", async () => {
    loadRebalanceInputs.mockResolvedValue({
      holdings: [
        { ticker: "A", name: "A", quantity: 700, price: 10_000, value: 7_000_000 },
        { ticker: "B", name: "B", quantity: 100, price: 30_000, value: 3_000_000 },
      ],
      targets: [
        { ticker: "A", name: "A", targetWeight: 0.6 },
        { ticker: "B", name: "B", targetWeight: 0.4 },
      ],
      snapshotDate: "2026-11-12",
      snapshotTakenAt: new Date("2026-11-12T07:00:00Z"),
    });
    const out = await contributionRebalanceTool.run(ctx(), {
      accountId: ACCOUNT,
      amount: 1_000_000,
    });
    expect(out.structured).toMatchObject({
      snapshotDate: "2026-11-12",
      invested: 990_000,
      leftoverCash: 10_000,
    });
    const lines = out.structured.lines as { ticker: string; buyQuantity: number }[];
    expect(lines.find((l) => l.ticker === "B")?.buyQuantity).toBe(33);
    expect(JSON.stringify(out.structured)).not.toMatch(/cano|acntPrdtCd/);
  });

  it("maps unowned accounts and bad targets to tool errors", async () => {
    loadRebalanceInputs.mockResolvedValueOnce(null);
    await expect(
      contributionRebalanceTool.run(ctx(), { accountId: ACCOUNT, amount: 1 })
    ).rejects.toThrow(McpToolError);

    loadRebalanceInputs.mockResolvedValueOnce({
      holdings: [{ ticker: "A", name: "A", quantity: 1, price: 1_000, value: 1_000 }],
      targets: [{ ticker: "A", name: "A", targetWeight: 0.95 }],
      snapshotDate: "2026-11-12",
      snapshotTakenAt: null,
    });
    await expect(
      contributionRebalanceTool.run(ctx(), { accountId: ACCOUNT, amount: 10_000 })
    ).rejects.toThrow(/100%가 아닙니다/);
  });
});

describe("travel_time", () => {
  beforeEach(() => computeTravelTimes.mockReset());

  it("requires exactly one of saved place / both coordinates per endpoint", () => {
    expect(endpointFromInput("origin", PLACE, undefined, undefined)).toEqual({
      kind: "saved_place",
      savedPlaceId: PLACE,
    });
    expect(endpointFromInput("origin", undefined, 37.5, 127)).toEqual({
      kind: "coordinates",
      lat: 37.5,
      lon: 127,
    });
    expect(() => endpointFromInput("origin", PLACE, 37.5, 127)).toThrow(McpInputError);
    expect(() => endpointFromInput("destination", undefined, 37.5, undefined)).toThrow(/도착지/);
  });

  it("passes the hour window and does not echo coordinates", async () => {
    computeTravelTimes.mockResolvedValue({
      status: "no_records",
      message: "기록 없음",
      origin: { lat: 37.5, lon: 127, radiusM: 300, savedPlaceId: null, name: null },
      destination: { lat: 37.49, lon: 127.02, radiusM: 300, savedPlaceId: null, name: null },
      since: new Date("2025-11-13T00:00:00Z"),
      until: new Date("2026-11-13T00:00:00Z"),
      hours: { fromHour: 22, toHour: 3 },
      dataThrough: "2026-11-12",
      totalJourneys: 0,
      modes: [],
      scannedTracks: 0,
      tracksWithoutAdjacentVisits: 0,
      truncated: false,
    });
    const out = await travelTimeTool.run(ctx(), {
      originLat: 37.5,
      originLon: 127,
      destinationLat: 37.49,
      destinationLon: 127.02,
      fromHour: 22,
      toHour: 3,
    });
    expect(computeTravelTimes.mock.calls[0][1]).toMatchObject({
      hours: { fromHour: 22, toHour: 3 },
    });
    expect(out.structured.message).toBe("기록 없음");
    expect(JSON.stringify(out.structured)).not.toMatch(/37\.5|127/);
  });

  it("rejects a half-specified hour window", async () => {
    await expect(
      travelTimeTool.run(ctx(), {
        originPlaceId: PLACE,
        destinationPlaceId: PLACE,
        fromHour: 7,
      })
    ).rejects.toThrow(/함께/);
    expect(computeTravelTimes).not.toHaveBeenCalled();
  });
});
