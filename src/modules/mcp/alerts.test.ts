import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import {
  type AlertStore,
  type AlertTx,
  type AlertWindowKey,
  alertWindowStart,
  kstDayStart,
  MCP_ALERT_DAILY_CAP,
  notifyMcpDenied,
  resetAlertWarningsForTest,
  scheduleMcpAlert,
} from "./alerts";
import type { McpDeniedEvent } from "./alerts-hook";

const BOT_TOKEN = "123456:SECRET-bot-token-value";
const CHAT_ID = "987654";
const env = {
  MCP_ALERT_TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  MCP_ALERT_TELEGRAM_CHAT_ID: CHAT_ID,
} as NodeJS.ProcessEnv;

interface Row extends AlertWindowKey {
  id: string;
  hitCount: number;
  sentAt: Date | null;
}

/** In-memory store with the same uniqueness semantics as mcp_alert_state. */
function memoryStore() {
  const rows: Row[] = [];
  let seq = 0;
  const sameKey = (a: AlertWindowKey, b: AlertWindowKey) =>
    a.userId === b.userId &&
    a.tokenKey === b.tokenKey &&
    a.reason === b.reason &&
    a.ip === b.ip &&
    a.windowStart.getTime() === b.windowStart.getTime();
  const tx: AlertTx = {
    async claimWindow(key) {
      const existing = rows.find((r) => sameKey(r, key));
      if (existing) {
        existing.hitCount += 1;
        return { id: existing.id, inserted: false, hitCount: existing.hitCount };
      }
      const row: Row = { ...key, id: `r${++seq}`, hitCount: 1, sentAt: null };
      rows.push(row);
      return { id: row.id, inserted: true, hitCount: 1 };
    },
    async sentAlertCountSince(userId, since) {
      return rows.filter(
        (r) => r.userId === userId && r.reason !== "cap_reached" && r.sentAt && r.sentAt >= since
      ).length;
    },
    async sentForTokenReasonSince(userId, tokenKey, reason, since) {
      return rows.some(
        (r) =>
          r.userId === userId &&
          r.tokenKey === tokenKey &&
          r.reason === reason &&
          r.sentAt !== null &&
          r.sentAt >= since
      );
    },
    async markSent(id, now) {
      const row = rows.find((r) => r.id === id);
      if (row) row.sentAt = now;
    },
    async claimCapNotice(userId, dayStart, now) {
      const key = {
        userId,
        tokenId: null,
        tokenKey: "",
        reason: "cap_reached",
        ip: "",
        windowStart: dayStart,
      };
      if (rows.some((r) => sameKey(r, key))) return false;
      rows.push({ ...key, id: `r${++seq}`, hitCount: 1, sentAt: now });
      return true;
    },
    async pruneBefore(userId, before) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].userId === userId && rows[i].windowStart < before) rows.splice(i, 1);
      }
    },
  };
  const store: AlertStore = { withUserLock: (_userId, fn) => fn(tx) };
  return { store, rows };
}

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
}

const NOW = new Date("2026-11-13T03:07:00Z"); // 12:07 KST

function event(overrides: Partial<McpDeniedEvent> = {}): McpDeniedEvent {
  return {
    userId: "user-1",
    tokenId: "token-1",
    tokenName: "claude-desktop",
    reason: "ip_not_allowed",
    ip: "198.51.100.7",
    country: "US",
    tool: "spending_summary",
    ...overrides,
  };
}

function sentTexts(fetchMock: ReturnType<typeof okFetch>): string[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text as string);
}

describe("MCP owner alerts", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetAlertWarningsForTest();
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends one fixed Korean message for the first lock violation", async () => {
    const { store } = memoryStore();
    const fetchMock = okFetch();
    const result = await notifyMcpDenied(event(), {
      store,
      fetch: fetchMock,
      env,
      now: () => NOW,
    });

    expect(result).toBe("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.text).toBe(
      [
        "[Cistory MCP] 접근 거부 알림",
        "사유: 허용되지 않은 IP (IP 잠금 위반)",
        "토큰 이름: claude-desktop",
        "IP: 198.51.100.7",
        "국가: US",
        "창 내 건수: 1건 (15분 단위로 묶어 한 번만 알립니다)",
      ].join("\n")
    );
  });

  it("debounces 10 events in one 15-minute window into one message with count 10", async () => {
    const { store, rows } = memoryStore();
    const fetchMock = okFetch();
    for (let i = 0; i < 10; i++) {
      const at = new Date(alertWindowStart(NOW).getTime() + i * 60_000);
      await notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => at });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].hitCount).toBe(10);
  });

  it("alerts again in the next window", async () => {
    const { store } = memoryStore();
    const fetchMock = okFetch();
    await notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => NOW });
    const later = new Date(NOW.getTime() + 15 * 60_000);
    await notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => later });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("alerts separately for a different IP", async () => {
    const { store } = memoryStore();
    const fetchMock = okFetch();
    await notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => NOW });
    await notifyMcpDenied(event({ ip: "198.51.100.8" }), {
      store,
      fetch: fetchMock,
      env,
      now: () => NOW,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at the daily cap, sends one cap notice, but lets the first (token, reason) through", async () => {
    const { store } = memoryStore();
    const fetchMock = okFetch();
    const deps = { store, fetch: fetchMock, env, now: () => NOW };

    // 50 IP-varying events on one (token, reason): each opens a fresh window.
    for (let i = 0; i < MCP_ALERT_DAILY_CAP; i++) {
      expect(await notifyMcpDenied(event({ ip: `203.0.113.${i}` }), deps)).toBe("alert");
    }
    expect(fetchMock).toHaveBeenCalledTimes(MCP_ALERT_DAILY_CAP);

    // 51st: same (token, reason) already alerted today → suppressed, one cap notice.
    expect(await notifyMcpDenied(event({ ip: "203.0.113.200" }), deps)).toBe("cap_notice");
    expect(sentTexts(fetchMock).at(-1)).toContain("알림 상한 도달");
    // Further noise: nothing at all.
    expect(await notifyMcpDenied(event({ ip: "203.0.113.201" }), deps)).toBe("suppressed");
    expect(fetchMock).toHaveBeenCalledTimes(MCP_ALERT_DAILY_CAP + 1);

    // A new reason on the same token, and a new token: first of the day → still sent.
    expect(await notifyMcpDenied(event({ reason: "scope_denied" }), deps)).toBe("alert");
    expect(await notifyMcpDenied(event({ tokenId: "token-2", tokenName: "other" }), deps)).toBe(
      "alert"
    );
    expect(sentTexts(fetchMock).at(-2)).toContain("권한 범위 밖 도구 호출");
    expect(sentTexts(fetchMock).at(-1)).toContain("토큰 이름: other");
    // …but only once each.
    expect(await notifyMcpDenied(event({ reason: "scope_denied", ip: "192.0.2.1" }), deps)).toBe(
      "suppressed"
    );
    expect(fetchMock).toHaveBeenCalledTimes(MCP_ALERT_DAILY_CAP + 3);

    // The next KST day resets the cap.
    const tomorrow = new Date(kstDayStart(NOW).getTime() + 24 * 60 * 60 * 1000 + 60_000);
    expect(
      await notifyMcpDenied(event({ ip: "203.0.113.250" }), { ...deps, now: () => tomorrow })
    ).toBe("alert");
  });

  it("never throws on a Telegram 5xx and logs only the status", async () => {
    const { store } = memoryStore();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("bad", { status: 502 }));
    await expect(
      notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => NOW })
    ).resolves.toBe("alert");
    expect(warnSpy).toHaveBeenCalledWith("[MCP] owner alert send failed", { status: 502 });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(BOT_TOKEN);
  });

  it("never throws on a network error and logs only the error name", async () => {
    const { store } = memoryStore();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed: https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    });
    await expect(
      notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => NOW })
    ).resolves.toBe("alert");
    expect(warnSpy).toHaveBeenCalledWith("[MCP] owner alert send failed", {
      errorName: "TypeError",
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(BOT_TOKEN);
  });

  it("swallows store failures", async () => {
    const store: AlertStore = {
      withUserLock: async () => {
        throw new Error("duplicate key value violates … (198.51.100.7)");
      },
    };
    const fetchMock = okFetch();
    await expect(
      notifyMcpDenied(event(), { store, fetch: fetchMock, env, now: () => NOW })
    ).resolves.toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("198.51.100.7");
  });

  it("keeps secrets, arguments and data out of the message body", async () => {
    const { store } = memoryStore();
    const fetchMock = okFetch();
    const leaky = {
      ...event({ tool: "transactions_raw" }),
      args: { q: "secret-search-term" },
      data: { amount: 123456 },
      secret: "mcp_live_abcdef",
    } as McpDeniedEvent;
    await notifyMcpDenied(leaky, { store, fetch: fetchMock, env, now: () => NOW });
    const body = String(fetchMock.mock.calls[0][1]?.body);
    for (const forbidden of [
      BOT_TOKEN,
      "secret-search-term",
      "123456",
      "mcp_live_abcdef",
      "transactions_raw",
      "token-1",
      "user-1",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("is disabled when either env var is missing, and warns once", async () => {
    const { store, rows } = memoryStore();
    const fetchMock = okFetch();
    const deps = { store, fetch: fetchMock, now: () => NOW };
    expect(
      await notifyMcpDenied(event(), {
        ...deps,
        env: { MCP_ALERT_TELEGRAM_BOT_TOKEN: BOT_TOKEN } as NodeJS.ProcessEnv,
      })
    ).toBe("disabled");
    expect(
      await notifyMcpDenied(event(), {
        ...deps,
        env: { MCP_ALERT_TELEGRAM_CHAT_ID: CHAT_ID } as NodeJS.ProcessEnv,
      })
    ).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("schedules the alert off the request path and never throws synchronously", async () => {
    const { store } = memoryStore();
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => (release = resolve))
    );
    expect(() =>
      scheduleMcpAlert(event(), { store, fetch: fetchMock, env, now: () => NOW })
    ).not.toThrow();
    // Nothing has run yet: the caller returned before any store or network work.
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(new Response("{}", { status: 200 }));
  });

  it("computes 15-minute windows and the KST day start", () => {
    expect(alertWindowStart(NOW).toISOString()).toBe("2026-11-13T03:00:00.000Z");
    // 00:30 KST on the 14th → that KST day started at 15:00Z on the 13th.
    expect(kstDayStart(new Date("2026-11-13T15:30:00Z")).toISOString()).toBe(
      "2026-11-13T15:00:00.000Z"
    );
    expect(kstDayStart(NOW).toISOString()).toBe("2026-11-12T15:00:00.000Z");
  });
});
