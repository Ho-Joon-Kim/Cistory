import { describe, expect, it } from "vitest";
import { categoryPaymentFlags } from "./sections";

describe("categoryPaymentFlags", () => {
  const rows = [
    { key: "health", amount: 900_000 },
    { key: "food", amount: 600_000 },
    { key: "cafe", amount: 100_000 },
  ];

  it("flags a sizable category carried by one or two payments", () => {
    expect(categoryPaymentFlags(rows, { health: 2, food: 40, cafe: 1 })).toEqual({
      health: "결제 2건",
    });
  });

  it("stays quiet until the counts arrive", () => {
    expect(categoryPaymentFlags(rows, null)).toEqual({});
  });
});
