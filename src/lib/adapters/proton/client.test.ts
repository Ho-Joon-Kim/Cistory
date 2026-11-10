import { describe, expect, it, vi } from "vitest";
import { buildSdkHttpClient, driveRequirementsHook } from "./client";

function fakeApi() {
  const request = vi.fn(async (..._args: unknown[]) => new Response("{}"));
  return { request, api: { authenticatedRequest: request } as never };
}

describe("buildSdkHttpClient", () => {
  it("bridges SDK fetchJson to authenticatedRequest with throwHttpErrors:false and json body", async () => {
    const { request, api } = fakeApi();
    const ac = new AbortController();
    await buildSdkHttpClient(api).fetchJson({
      url: "https://x/y",
      method: "POST",
      json: { a: 1 },
      headers: new Headers({ h: "v" }),
      timeoutMs: 5000,
      signal: ac.signal,
    });
    expect(request).toHaveBeenCalledWith("https://x/y", {
      method: "POST",
      json: { a: 1 },
      headers: expect.any(Headers),
      timeout: 5000,
      signal: ac.signal,
      throwHttpErrors: false,
    });
  });

  it("bridges fetchBlob with the raw body", async () => {
    const { request, api } = fakeApi();
    const body = new Uint8Array([1, 2, 3]);
    await buildSdkHttpClient(api).fetchBlob({
      url: "https://x/blob",
      method: "POST",
      body,
      headers: new Headers(),
      timeoutMs: 1000,
    });
    const [, init] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(init.body).toBe(body);
    expect(init.throwHttpErrors).toBe(false);
    expect(init).not.toHaveProperty("json");
  });
});

describe("driveRequirementsHook", () => {
  it("logs x-pm-drive-requirements once per value without failing the response", () => {
    const log = vi.fn();
    const hook = driveRequirementsHook(log);
    const call = (value?: string) => {
      const response = new Response("ok", value ? { headers: { "x-pm-drive-requirements": value } } : {});
      return (hook as (...a: unknown[]) => unknown)(new Request("https://x"), {}, response);
    };
    expect(call("min=2")).toBeUndefined();
    call("min=2");
    call();
    call("min=3");
    expect(log.mock.calls).toEqual([["min=2"], ["min=3"]]);
  });
});
