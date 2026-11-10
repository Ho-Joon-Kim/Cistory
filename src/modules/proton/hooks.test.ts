import { describe, expect, it } from "vitest";
import { nextPollDelay, PROTON_STATUS_POLL_MS } from "./hooks";

describe("nextPollDelay", () => {
  it("polls every 5 seconds while the fork is pending", () => {
    expect(PROTON_STATUS_POLL_MS).toBe(5000);
    expect(nextPollDelay({ status: "pending", expiresAt: "2026-11-10T00:00:00.000Z" })).toBe(5000);
  });

  it.each([
    { status: "active" as const },
    { status: "expired" as const },
    { status: "none" as const },
    undefined,
  ])("stops polling for %j", (status) => {
    expect(nextPollDelay(status)).toBe(false);
  });
});
