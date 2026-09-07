import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toLocalDateString } from "@/lib/utils";
import { startInitialSync, transactionsForDateOptions } from "./hooks";

vi.mock("@/lib/auth-client", () => ({ useSession: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("date transaction queries", () => {
  it("does not display a previous date when the next date request fails", async () => {
    const cache = client();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transactions: [{ id: "old-day" }] })))
      .mockResolvedValueOnce(new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const first = transactionsForDateOptions("session-a", "2026-09-01");
    await cache.fetchQuery(first);
    const observer = new QueryObserver(cache, first);
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(transactionsForDateOptions("session-a", "2026-09-02"));
    expect(observer.getCurrentResult().data).toBeUndefined();
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
    cache.clear();
  });
  it("isolates accounts and refetches an invalidated day instead of using an immortal cache", async () => {
    const cache = client();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ transactions: [{ id: "before" }] })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ transactions: [{ id: "after" }] })))
    );
    const options = transactionsForDateOptions("session-a", "2026-09-01");
    await cache.fetchQuery(options);
    expect(
      cache.getQueryData(transactionsForDateOptions("session-b", "2026-09-01").queryKey)
    ).toBeUndefined();
    await cache.invalidateQueries({ queryKey: options.queryKey });
    expect(await cache.fetchQuery(options)).toEqual([{ id: "after" }]);
    cache.clear();
  });
  it("polls today and cancels requests when the observer leaves", async () => {
    const cache = client();
    const options = transactionsForDateOptions("session-a", toLocalDateString(new Date()));
    expect(options.refetchInterval).toBe(30_000);
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        requestSignal = init.signal;
        return new Promise(() => {});
      })
    );
    const observer = new QueryObserver(cache, options);
    const unsubscribe = observer.subscribe(() => {});
    expect(requestSignal?.aborted).toBe(false);
    unsubscribe();
    expect(requestSignal?.aborted).toBe(true);
    cache.clear();
  });
});

describe("initial GitHub sync", () => {
  it("rejects non-success HTTP responses instead of showing success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("failed", { status: 503 })));
    await expect(startInitialSync()).rejects.toThrow("동기화 시작에 실패");
  });
});
