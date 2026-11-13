import { expect, type Page, test } from "@playwright/test";

const ACTIVE_ID = "11111111-1111-4111-8111-111111111111";
const REVOKED_ID = "22222222-2222-4222-8222-222222222222";
const RAW = `cmcp_abcdef012345_${"0123456789abcdef".repeat(4)}`;

const tokens = [
  {
    id: ACTIVE_ID,
    name: "노트북 Claude 데스크톱 앱에서 쓰는 아주 긴 이름의 토큰",
    prefix: "cmcp_abcdef012345_…",
    scopes: ["read", "sensitive-read", "write"],
    allowedCidrs: ["0.0.0.0/0", "2001:db8:abcd:0012:0000:0000:0000:0000/64"],
    allowedCountries: [],
    cidrLockIsCatchAll: false,
    expiresAt: "2099-01-01T00:00:00.000Z",
    revokedAt: null,
    lastUsedAt: "2026-08-15T03:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    status: "active",
  },
  {
    id: REVOKED_ID,
    name: "예전 서버",
    prefix: "cmcp_0123456789ab_…",
    scopes: ["read"],
    allowedCidrs: [],
    allowedCountries: ["KR"],
    cidrLockIsCatchAll: false,
    expiresAt: null,
    revokedAt: "2026-08-10T00:00:00.000Z",
    lastUsedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    status: "revoked",
  },
];

const auditItems = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    at: "2026-08-15T03:00:00.000Z",
    tokenId: ACTIVE_ID,
    tool: "search_records_with_a_very_long_tool_name_for_layout",
    outcome: "ok",
    denyReason: null,
    errorCode: null,
    argsSummary: { q: { len: 12, sha256: "deadbeef" }, from: "2026-08-01" },
    resultCount: 42,
    ip: "2001:db8:abcd:12::1234:5678",
    country: "KR",
    writeBefore: null,
    writeAfter: null,
    hitCount: 1,
    windowStart: null,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    at: "2026-08-15T02:00:00.000Z",
    tokenId: null,
    tool: null,
    outcome: "denied",
    denyReason: "country_not_allowed",
    errorCode: null,
    argsSummary: null,
    resultCount: null,
    ip: "198.51.100.7",
    country: "US",
    writeBefore: null,
    writeAfter: null,
    hitCount: 12,
    windowStart: "2026-08-15T01:45:00.000Z",
  },
];

async function fixtures(page: Page, calls: { method: string; path: string; body: unknown }[]) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3210") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname.startsWith("/api/settings/mcp-tokens")) {
      calls.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
    }
    switch (url.pathname) {
      case "/api/auth/get-session":
        return route.fulfill({
          json: {
            user: {
              id: "browser-settings",
              name: "Browser",
              email: "browser@example.test",
              emailVerified: true,
              image: null,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            session: {
              id: "settings-fixture",
              userId: "browser-settings",
              token: "fixture",
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
          },
        });
      case "/api/settings":
        return route.fulfill({ json: { theme: "light", syncIntervalHours: 6 } });
      case "/api/settings/data-usage":
        return route.fulfill({
          json: { categories: [], grandTotalRows: 0, grandTotalBytes: 0, calculatedAt: null },
        });
      case "/api/settings/location-summary":
        return route.fulfill({
          json: { processedDays: 0, failedDays: 0, anomalies: 0, unnamedVisits: 0 },
        });
      case "/api/saved-places":
        return route.fulfill({ json: { places: [] } });
      case "/api/data-status":
        return route.fulfill({ json: { sources: [] } });
      case "/api/sync/status":
        return route.fulfill({
          contentType: "text/event-stream",
          body: 'event: status\ndata: {"hasActiveSync":false,"activeJobs":[],"recentCompleted":[],"lastSyncTime":null}\n\n',
        });
      case "/api/timeline/stats":
        return route.fulfill({ json: { stats: [], maxCount: 0 } });
      case "/api/settings/mcp-tokens":
        if (request.method() === "POST") {
          return route.fulfill({
            status: 201,
            json: {
              raw: RAW,
              token: { ...tokens[1], id: "new", name: "새 토큰", status: "active" },
            },
          });
        }
        return route.fulfill({ json: { tokens } });
      case "/api/settings/mcp-tokens/audit":
        // The second page carries older rows with their own ids.
        return route.fulfill({
          json: url.searchParams.get("cursor")
            ? {
                items: auditItems.map((item) => ({
                  ...item,
                  id: item.id.replace("aaaaaaaa", "bbbbbbbb"),
                  at: "2026-08-14T03:00:00.000Z",
                })),
                nextCursor: null,
              }
            : { items: auditItems, nextCursor: "next" },
        });
      case `/api/settings/mcp-tokens/${ACTIVE_ID}`:
        return route.fulfill({ json: { revoked: true } });
    }
    return route.fulfill({ json: {} });
  });
}

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width
  );
}

test("MCP token card and audit log fit the page width, with inline confirmations", async ({
  page,
}) => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await fixtures(page, calls);
  page.on("dialog", () => {
    throw new Error("window.confirm/alert must not be used");
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    // The header's sync-status stream closing after one fixture event is not ours.
    if (message.type() === "error" && !message.text().startsWith("Failed to get sync status")) {
      errors.push(message.text());
    }
  });
  await page.goto("/settings");
  // The dev-mode Next.js indicator sits over the bottom sheet's buttons at phone width.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  const tokensRow = page.getByRole("button", { name: /MCP 토큰/ });
  await expect(tokensRow).toContainText("사용 중 1개");
  await tokensRow.click();

  const active = page.getByRole("list", { name: "사용 중인 MCP 토큰" });
  await expect(active.getByTestId("mcp-token-row")).toHaveCount(1);
  await expect(active).toContainText("사용 중");
  await expect(active).toContainText("읽기 · 민감 정보 · 쓰기");
  await expect(active).toContainText("잠금으로 치지 않아요");
  await expect(active).toContainText("쓰기와 민감 정보 읽기");
  await noHorizontalScroll(page);

  // Revoke asks inline, then calls DELETE.
  await active.getByRole("button", { name: "폐기", exact: true }).click();
  const confirm = page.getByRole("group", { name: "토큰 폐기 확인" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "폐기하기" }).click();
  await expect
    .poll(() => calls.some((c) => c.method === "DELETE" && c.path.endsWith(ACTIVE_ID)))
    .toBe(true);

  // Issue: warnings appear live, the raw token shows once after creation.
  await page.getByRole("button", { name: "새 토큰 만들기" }).click();
  const form = page.getByRole("form", { name: "새 MCP 토큰" });
  await form.getByRole("textbox", { name: "이름", exact: true }).fill("새 토큰");
  await form.getByLabel("허용 국가").fill("");
  await expect(form).toContainText("IP나 국가 잠금이 없어요");
  await form.getByRole("checkbox", { name: /쓰기/ }).check();
  await form.getByRole("checkbox", { name: /민감 정보 읽기/ }).check();
  await expect(form).toContainText("가장 많이 읽고 바꿀 수 있어요");
  await noHorizontalScroll(page);
  await form.getByRole("button", { name: "토큰 만들기" }).click();
  await expect(page.getByText(RAW)).toBeVisible();
  const issued = calls.find((c) => c.method === "POST" && c.path === "/api/settings/mcp-tokens");
  expect(issued?.body).toMatchObject({
    name: "새 토큰",
    scopes: ["read", "sensitive-read", "write"],
    allowedCountries: [],
  });
  await noHorizontalScroll(page);

  // Audit log.
  await page.getByRole("button", { name: /MCP 감사 로그/ }).click();
  const table = page.getByRole("table", { name: /MCP 감사 로그/ });
  await expect(table).toContainText("허용하지 않은 국가 · 12회");
  await expect(table).toContainText("알 수 없는 토큰");
  await noHorizontalScroll(page);
  await table.getByRole("button", { name: /search_records/ }).click();
  await expect(table).toContainText("반환 건수");
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: "더 보기" }).click();
  // header + 4 rows + the open detail row; the last page has no 더 보기.
  await expect(table.getByRole("row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "더 보기" })).toHaveCount(0);

  // Delete asks for a scope, then confirms inside the sheet.
  await page.getByRole("button", { name: "기록 삭제…" }).click();
  const sheet = page.getByRole("dialog", { name: "감사 기록 삭제" });
  await expect(sheet.getByRole("button", { name: "삭제 범위 확인" })).toBeDisabled();
  await sheet.getByLabel("시작일").fill("2026-08-01");
  await sheet.getByRole("button", { name: "삭제 범위 확인" }).click();
  await expect(sheet).toContainText("정말 지울까요?");
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
