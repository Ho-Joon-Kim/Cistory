import { describe, expect, it } from "vitest";
import { isForkPending, nextPollDelay, PROTON_STATUS_POLL_MS } from "./hooks";

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

describe("isForkPending", () => {
  const fork = { signInUrl: "https://account.proton.me/fork#s", expiresAt: "2026-11-10T00:10:00Z" };

  it("is pending for a fork started on this page load", () => {
    expect(isForkPending(fork, { status: "active", forkPending: false })).toBe(true);
  });

  it("keeps polling after a reload during a first connect (pending row)", () => {
    expect(isForkPending(null, { status: "pending", forkPending: true })).toBe(true);
  });

  it.each(["active", "needs_reauth"] as const)(
    "keeps polling after a reload during a reconnect from %s",
    (status) => {
      expect(isForkPending(null, { status, forkPending: true })).toBe(true);
    }
  );

  it("is not pending without a fork or an open pending_* fork", () => {
    expect(isForkPending(null, { status: "active", forkPending: false })).toBe(false);
    expect(isForkPending(null, null)).toBe(false);
    expect(isForkPending(null, undefined)).toBe(false);
  });
});
