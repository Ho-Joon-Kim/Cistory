import { expect, type Page, test } from "@playwright/test";

const categoryBreakdown = [
  { category: "food", total: 600000, count: 6 },
  { category: "shopping", total: 400000, count: 4 },
];
const trend = {
  cumulativeCurve: Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    actual: i < 15 ? (i + 1) * 40000 : null,
    mid: i >= 14 ? (i + 1) * 40000 : null,
    upper: i >= 14 ? (i + 1) * 45000 : null,
    lower: i >= 14 ? (i + 1) * 35000 : null,
    categories: { food: (i + 1) * 24000, shopping: (i + 1) * 16000 },
  })),
  monthlyBars: [
    {
      month: "07",
      total: 1000000,
      isCurrent: false,
      categories: { food: 600000, shopping: 400000 },
    },
    { month: "08", total: 500000, isCurrent: true, categories: { food: 300000, shopping: 200000 } },
  ],
  forecast: {
    predictedTotal: 1200000,
    upperBound: 1350000,
    lowerBound: 1050000,
    todayDayNumber: 15,
    daysInMonth: 30,
    currentMonthActualTotal: 600000,
  },
};
async function fixtures(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3210") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let body: unknown = {};
    switch (url.pathname) {
      case "/api/auth/get-session":
        body = {
          user: {
            id: "browser",
            name: "Browser",
            email: "browser@example.test",
            emailVerified: true,
            image: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          session: {
            id: "fixture",
            userId: "browser",
            token: "fixture",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        };
        break;
      case "/api/settings":
        body = { theme: "light", syncIntervalHours: 6 };
        break;
      case "/api/spending/trend":
        body = trend;
        break;
      case "/api/spending":
        body = {
          transactions: [],
          hasMore: false,
          summary: {
            totalSpending: 1000000,
            totalIncome: 0,
            totalIgnored: 0,
            spendingCount: 10,
            incomeCount: 0,
            ignoredCount: 0,
            totalWithdrawal: 1000000,
            totalDeposit: 0,
            withdrawalCount: 10,
            depositCount: 0,
            categoryBreakdown,
          },
        };
        break;
      case "/api/timeline":
        body = {
          commits: [],
          pagination: { page: 1, totalPages: 0, hasNext: false, hasPrev: false },
        };
        break;
      case "/api/sync/status":
        return route.fulfill({
          contentType: "text/event-stream",
          body: 'event: status\ndata: {"hasActiveSync":false,"activeJobs":[],"recentCompleted":[],"lastSyncTime":null}\n\n',
        });
      case "/api/timeline/coding-stats":
        body = { stats: [] };
        break;
      case "/api/timeline/coding-sessions":
        body = { sessions: [] };
        break;
      case "/api/timeline/locations":
        body = { locations: [] };
        break;
      case "/api/timeline/locations/stay-points":
        body = { stayPoints: [] };
        break;
      case "/api/timeline/locations/distances":
        body = { distances: {} };
        break;
      case "/api/saved-places":
        body = { places: [] };
        break;
      case "/api/timeline/stats":
        body = { stats: [], maxCount: 0 };
        break;
      case "/api/timeline/repos":
        body = { repositories: [] };
        break;
      case "/api/sync/jobs":
        body = {
          activeJobs: [],
          recentJobs: [],
          summaryStats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        };
        break;
      case "/api/fitbit/summary":
        body = {
          hasConnection: true,
          status: "active",
          backfillCompletedAt: "2026-08-01",
          lastSyncedAt: null,
          hasAnyHistory: true,
          metrics: [],
          workouts: [],
          sleepSessions: [],
        };
        break;
      case "/api/fitbit/activity-correlation":
        body = { days: [] };
        break;
      case "/api/insights":
        body = { data: null };
        break;
      case "/api/portfolio/snapshots":
        body = {
          snapshots: [1, 2, 3].map((i) => ({
            id: String(i),
            accountId: "a",
            asOfDate: `2026-08-0${i}`,
            totalEvalAmount: 1000000 + i * 10000,
            totalPurchaseAmount: 900000,
            totalPnl: 100000 + i * 10000,
          })),
        };
        break;
      case "/api/settings/data-usage":
        body = {
          categories: [
            { category: "commits", label: "커밋", totalBytes: 600000, totalRows: 60 },
            { category: "health", label: "건강", totalBytes: 400000, totalRows: 40 },
          ],
          grandTotalRows: 100,
          grandTotalBytes: 1000000,
          calculatedAt: "2026-08-15T00:00:00Z",
        };
        break;
    }
    await route.fulfill({ json: body });
  });
}
test.beforeEach(async ({ page }) => {
  await fixtures(page);
});

test("spending series and stacked amounts survive Recharts migration", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/spending");
  await expect(page.locator(".recharts-surface")).toHaveCount(3);
  await expect.poll(() => page.locator(".recharts-line-curve").count()).toBeGreaterThanOrEqual(4);
  await expect
    .poll(() =>
      page
        .locator(".recharts-bar-rectangle path")
        .evaluateAll((els) =>
          Math.max(...els.map((el) => (el as SVGGraphicsElement).getBBox().height))
        )
    )
    .toBeGreaterThan(50);
  // Ratio of equal-category bars reflects the fixture's exact 2:1 spending ratio.
  await expect
    .poll(() =>
      page
        .locator(".recharts-wrapper")
        .filter({ hasText: "7월" })
        .locator(".recharts-bar")
        .first()
        .locator(".recharts-bar-rectangle path")
        .evaluateAll((els) =>
          els.length === 2
            ? (els[0] as SVGGraphicsElement).getBBox().height /
              (els[1] as SVGGraphicsElement).getBBox().height
            : 0
        )
    )
    .toBeCloseTo(2, 1);
  for (const curve of await page.locator(".recharts-line-curve").all())
    await expect
      .poll(() => curve.evaluate((el) => (el as SVGGraphicsElement).getBBox().width))
      .toBeGreaterThan(30);
  await page.screenshot({ path: testInfo.outputPath("spending.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("portfolio donuts, asset areas and storage semicircle have real geometry", async ({
  page,
}, testInfo) => {
  await page.goto("/browser-charts");
  for (const name of ["allocation", "holdings", "usage"]) {
    const chart = page.getByTestId(name);
    await expect(chart.locator(".recharts-pie-sector")).toHaveCount(2);
    // A collapsed animation draws a vertical line while axes/labels still exist.
    await expect
      .poll(() =>
        chart
          .locator(".recharts-pie-sector path")
          .first()
          .evaluate((el) => (el as SVGGraphicsElement).getBBox().width)
      )
      .toBeGreaterThan(40);
    await expect
      .poll(() =>
        chart
          .locator(".recharts-pie-sector path")
          .first()
          .evaluate((el) => (el as SVGGraphicsElement).getBBox().height)
      )
      .toBeGreaterThan(40);
  }
  await expect
    .poll(() => page.getByTestId("assets").locator(".recharts-area-area").count())
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width
  );
  await page.screenshot({ path: testInfo.outputPath("charts.png"), fullPage: true });
});

test("zero GitHub commits still shows the daily life timeline", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByText("아직 동기화된 커밋이 없습니다. 생활 기록은 아래에서 확인하세요.")
  ).toBeVisible();
  await expect(page.locator(".timeline-scroll-container")).toBeVisible();
  await expect(page.locator(".timeline-scroll-container")).not.toBeEmpty();
});

test("health auxiliary failures can retry into an honest empty state", async ({ page }) => {
  let fail = true;
  await page.route("**/api/insights?*", (route) =>
    route.fulfill(fail ? { status: 503, json: { error: "unavailable" } } : { json: { data: null } })
  );
  await page.goto("/health");
  await expect(page.locator("main [role=alert]")).toContainText(
    "건강 데이터를 불러오지 못했습니다."
  );
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByText("체성분 측정 기록이 아직 없습니다.")).toBeVisible();
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});

test("collection status retries errors and retains a queued recovery on reload", async ({
  page,
}, testInfo) => {
  let statusFails = true;
  let recoveryFails = true;
  let queued: { source: string; from: string; to: string } | null = null;
  await page.route("**/api/data-status?*", (route) => {
    if (statusFails) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    const params = new URL(route.request().url()).searchParams;
    const from = params.get("from")!;
    const to = params.get("to")!;
    return route.fulfill({
      json: {
        from,
        to,
        timeZone: "Asia/Seoul",
        sources: [
          ["wakatime", "WakaTime"],
          ["github", "GitHub 커밋"],
          ["location", "위치 기록"],
          ["toss", "토스 알림"],
          ["kis", "KIS 자산"],
          ["withings", "Withings 체성분"],
          ["health", "건강 · Google Health / Health Connect"],
        ].map(([id, label]) => ({
          id,
          label,
          connected: id === "wakatime",
          needsReauth: false,
          lastSuccessAt:
            id === "wakatime" ? new Date(Date.now() - 4 * 86_400_000).toISOString() : null,
          lastRecordAt: null,
          error: null,
          stale: id === "wakatime",
          canRecover: id === "wakatime",
          recoveryHelp:
            id === "wakatime"
              ? "선택 기간을 다시 조회합니다."
              : "설정에서 소스별 연결과 복구 방법을 확인하세요.",
          days: Array.from(
            { length: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 },
            (_, i) => ({
              date: new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
              count: 0,
              state: id === "wakatime" && queued ? "pending" : i === 1 ? "checked" : "unknown",
            })
          ),
        })),
        jobs: queued
          ? [
              {
                id: "job-fixture",
                source: queued.source,
                fromDate: queued.from,
                toDate: queued.to,
                nextDate: queued.from,
                status: "pending",
                error: null,
                createdAt: new Date().toISOString(),
              },
            ]
          : [],
      },
    });
  });
  await page.route("**/api/data-status/recover", (route) => {
    if (recoveryFails)
      return route.fulfill({ status: 503, json: { error: "재수집 서버가 응답하지 않습니다." } });
    queued = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { job: { id: "job-fixture" } } });
  });
  await page.goto("/data-status");
  await expect(page.locator("main [role=alert]")).toContainText("수집 상태를 불러오지 못했습니다.");
  statusFails = false;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  const calendar = page.getByRole("list", { name: "WakaTime 날짜별 기록" });
  await expect(calendar.getByRole("listitem")).toHaveCount(30);
  await expect(page.getByRole("list")).toHaveCount(7);
  await expect(calendar).toContainText("기록 없음 · 수집 여부 미확인");
  await expect(calendar).toContainText("재조회 완료 · 기록 없음");
  await page.getByRole("button", { name: "선택 기간 재수집", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("재수집 서버가 응답하지 않습니다.");
  recoveryFails = false;
  const from = await page.getByLabel("시작일").inputValue();
  const to = await page.getByLabel("종료일").inputValue();
  await page.getByRole("button", { name: "선택 기간 재수집", exact: true }).click();
  await expect(page.getByRole("button", { name: "재수집 진행 중", exact: true })).toBeDisabled();
  expect(queued).toEqual({ source: "wakatime", from, to });
  await page.reload();
  await expect(page.getByRole("button", { name: "재수집 진행 중", exact: true })).toBeDisabled();
  await expect(page.getByText(`${from}부터 대기 중`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width
  );
  await page.screenshot({ path: testInfo.outputPath("data-status.png"), fullPage: true });
});

test.describe("KST search destinations outside Korea", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("keeps a KST midnight date when opening the daily timeline", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-12-31T15:30:00Z"));
    const request = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/timeline/locations/stay-points" &&
        url.searchParams.get("date") === "2027-01-01"
      );
    });
    await page.goto("/dashboard?date=2027-01-01");
    await request;
    await expect(page.locator(".timeline-scroll-container")).toBeVisible();
  });
});

for (const authenticated of [false, true]) {
  test(`delayed protected page hydrates after an ${authenticated ? "authenticated" : "anonymous"} session settles`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (!authenticated) {
      await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
    }
    await page.route("**/api/data-status?*", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } })
    );
    const sessionResponse = page.waitForResponse("**/api/auth/get-session");
    let delayed = false;
    await page.route(/\/_next\/static\/chunks\/app\/data-status\/page[^/]*\.js/, async (route) => {
      // The layout starts the session request before this page's code arrives.
      await (await sessionResponse).finished();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      delayed = true;
      await route.continue();
    });
    await page.goto("/data-status");
    if (authenticated) {
      await expect(page.locator("main [role=alert]")).toContainText("불러오지 못했습니다");
      await expect(page).toHaveURL(/\/data-status$/);
    } else {
      await expect(page).toHaveURL(/\/login$/);
    }
    expect(delayed).toBe(true);
    expect(errors).toEqual([]);
  });
}
