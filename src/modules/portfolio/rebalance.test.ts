import { describe, expect, it } from "vitest";
import { computeContributionRebalance, RebalanceInputError } from "./rebalance";

const line = (result: ReturnType<typeof computeContributionRebalance>, ticker: string) => {
  const found = result.lines.find((l) => l.ticker === ticker);
  if (!found) throw new Error(`no line for ${ticker}`);
  return found;
};

describe("computeContributionRebalance", () => {
  it("F2: 60/40 target, 70/30 now — fills the underweight holding first, whole shares only", () => {
    const result = computeContributionRebalance({
      holdings: [
        { ticker: "A", name: "주식형", quantity: 700, price: 10_000, value: 7_000_000 },
        { ticker: "B", name: "채권형", quantity: 100, price: 30_000, value: 3_000_000 },
      ],
      targets: [
        { ticker: "A", name: "주식형", targetWeight: 0.6 },
        { ticker: "B", name: "채권형", targetWeight: 0.4 },
      ],
      contribution: 1_000_000,
    });

    expect(line(result, "A").buyQuantity).toBe(0);
    expect(line(result, "B").buyQuantity).toBe(33);
    expect(line(result, "B").buyAmount).toBe(990_000);
    expect(result.invested).toBe(990_000);
    expect(result.leftoverCash).toBe(10_000);
    expect(result.totalValueAfter).toBe(10_990_000);
    expect(line(result, "B").expectedWeight).toBeCloseTo(3_990_000 / 10_990_000, 6);
    expect(line(result, "A").currentWeight).toBeCloseTo(0.7, 6);
    expect(result.warnings).toEqual([]);
  });

  it("splits by the target ratio when already on target", () => {
    const result = computeContributionRebalance({
      holdings: [
        { ticker: "A", name: "A", quantity: 60, price: 10_000, value: 600_000 },
        { ticker: "B", name: "B", quantity: 40, price: 10_000, value: 400_000 },
      ],
      targets: [
        { ticker: "A", name: "A", targetWeight: 0.6 },
        { ticker: "B", name: "B", targetWeight: 0.4 },
      ],
      contribution: 1_000_000,
    });
    expect(line(result, "A").buyQuantity).toBe(60);
    expect(line(result, "B").buyQuantity).toBe(40);
    expect(result.leftoverCash).toBe(0);
    expect(line(result, "A").expectedWeight).toBeCloseTo(0.6, 6);
  });

  it("rejects targets that don't sum to 100%", () => {
    const run = () =>
      computeContributionRebalance({
        holdings: [{ ticker: "A", name: "A", quantity: 1, price: 1_000, value: 1_000 }],
        targets: [
          { ticker: "A", name: "A", targetWeight: 0.55 },
          { ticker: "B", name: "B", targetWeight: 0.4 },
        ],
        contribution: 10_000,
      });
    expect(run).toThrow(RebalanceInputError);
    expect(run).toThrow(/95\.0%/);
  });

  it("accepts a sum within the tolerance", () => {
    expect(() =>
      computeContributionRebalance({
        holdings: [{ ticker: "A", name: "A", quantity: 1, price: 1_000, value: 1_000 }],
        targets: [{ ticker: "A", name: "A", targetWeight: 0.998 }],
        contribution: 10_000,
      })
    ).not.toThrow();
  });

  it("excludes a target with a missing or zero price and warns", () => {
    const result = computeContributionRebalance({
      holdings: [
        { ticker: "A", name: "A", quantity: 10, price: 10_000, value: 100_000 },
        { ticker: "Z", name: "제로", quantity: 5, price: 0, value: 0 },
      ],
      targets: [
        { ticker: "A", name: "A", targetWeight: 0.5 },
        { ticker: "N", name: "신규", targetWeight: 0.3 },
        { ticker: "Z", name: "제로", targetWeight: 0.2 },
      ],
      contribution: 100_000,
    });
    expect(line(result, "N").excluded).toBe(true);
    expect(line(result, "N").buyQuantity).toBe(0);
    expect(line(result, "Z").excluded).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/신규\(N\)/);
    // A's target is 0.5 × 200,000 = 100,000 → already there; nothing to buy.
    expect(line(result, "A").buyQuantity).toBe(0);
    expect(result.leftoverCash).toBe(100_000);
  });

  it("never buys holdings without a target and reports them", () => {
    const result = computeContributionRebalance({
      holdings: [
        { ticker: "A", name: "A", quantity: 10, price: 10_000, value: 100_000 },
        { ticker: "X", name: "기타", quantity: 1, price: 100_000, value: 100_000 },
      ],
      targets: [{ ticker: "A", name: "A", targetWeight: 1 }],
      contribution: 50_000,
    });
    expect(line(result, "X").buyQuantity).toBe(0);
    expect(line(result, "X").targetWeight).toBe(0);
    expect(line(result, "A").buyQuantity).toBe(5);
  });

  it("does not overshoot with a share far bigger than the shortfall", () => {
    const result = computeContributionRebalance({
      holdings: [
        { ticker: "A", name: "A", quantity: 1, price: 900_000, value: 900_000 },
        { ticker: "B", name: "B", quantity: 1, price: 100_000, value: 100_000 },
      ],
      targets: [
        { ticker: "A", name: "A", targetWeight: 0.9 },
        { ticker: "B", name: "B", targetWeight: 0.1 },
      ],
      contribution: 20_000,
    });
    // Shortfalls 18,000 / 2,000 are below half a share for both.
    expect(result.invested).toBe(0);
    expect(result.leftoverCash).toBe(20_000);
  });

  it("rejects a non-positive contribution and empty targets", () => {
    expect(() =>
      computeContributionRebalance({ holdings: [], targets: [], contribution: 0 })
    ).toThrow(/0보다/);
    expect(() =>
      computeContributionRebalance({ holdings: [], targets: [], contribution: 1_000 })
    ).toThrow(/목표 비중이 설정/);
  });
});
