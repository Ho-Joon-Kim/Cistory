import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LogtailMock = vi.hoisted(() =>
  vi.fn(function (this: Record<string, unknown>) {
    this.info = vi.fn();
    this.warn = vi.fn();
    this.error = vi.fn();
    this.flush = vi.fn().mockResolvedValue(undefined);
  })
);

vi.mock("@logtail/node", () => ({ Logtail: LogtailMock }));

async function loadLogger() {
  vi.resetModules();
  return import("./logger");
}

describe("logger construction", () => {
  beforeEach(() => {
    LogtailMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the 0.5.x default ingesting host when BETTER_STACK_INGESTING_HOST is unset", async () => {
    vi.stubEnv("BETTER_STACK_SOURCE_TOKEN", "tok");
    vi.stubEnv("BETTER_STACK_INGESTING_HOST", undefined);
    await loadLogger();
    expect(LogtailMock).toHaveBeenCalledTimes(1);
    expect(LogtailMock).toHaveBeenCalledWith("tok", {
      endpoint: "https://in.logs.betterstack.com",
    });
  });

  it("treats a blank BETTER_STACK_INGESTING_HOST as unset", async () => {
    vi.stubEnv("BETTER_STACK_SOURCE_TOKEN", "tok");
    vi.stubEnv("BETTER_STACK_INGESTING_HOST", "  ");
    await loadLogger();
    expect(LogtailMock).toHaveBeenCalledWith("tok", {
      endpoint: "https://in.logs.betterstack.com",
    });
  });

  it("uses BETTER_STACK_INGESTING_HOST when set", async () => {
    vi.stubEnv("BETTER_STACK_SOURCE_TOKEN", "tok");
    vi.stubEnv("BETTER_STACK_INGESTING_HOST", "s123456.eu-central-1a.betterstackdata.com");
    await loadLogger();
    expect(LogtailMock).toHaveBeenCalledWith("tok", {
      endpoint: "s123456.eu-central-1a.betterstackdata.com",
    });
  });

  it("falls back to console only when BETTER_STACK_SOURCE_TOKEN is unset", async () => {
    vi.stubEnv("BETTER_STACK_SOURCE_TOKEN", undefined);
    vi.stubEnv("BETTER_STACK_INGESTING_HOST", "s123456.eu-central-1a.betterstackdata.com");
    const { logger } = await loadLogger();
    expect(LogtailMock).not.toHaveBeenCalled();
    logger.info("hello", { a: 1 });
    expect(console.log).toHaveBeenCalledWith("hello", { a: 1 });
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it("forwards message and meta unchanged to Logtail and awaits flush", async () => {
    vi.stubEnv("BETTER_STACK_SOURCE_TOKEN", "tok");
    const { logger } = await loadLogger();
    const instance = LogtailMock.mock.instances[0] as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const meta = { userId: "u1", err: "boom" };
    logger.error("failed", meta);
    expect(instance.error).toHaveBeenCalledWith("failed", meta);
    await logger.flush();
    expect(instance.flush).toHaveBeenCalledTimes(1);
  });
});
