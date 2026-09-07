import { expect, type Page, test } from "@playwright/test";

async function fixtures(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3210") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/auth/get-session") {
      return route.fulfill({
        json: {
          user: {
            id: "browser-search",
            name: "Browser",
            email: "browser@example.test",
            emailVerified: true,
            image: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          session: {
            id: "search-fixture",
            userId: "browser-search",
            token: "fixture",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        },
      });
    }
    if (url.pathname === "/api/timeline/stats")
      return route.fulfill({ json: { stats: [], maxCount: 0 } });
    return route.fulfill({ json: {} });
  });
}

const firstPage = [
  {
    id: "commit-fixture",
    source: "commit",
    title: "fix: 검색 기록 표시",
    description: "Cistory · fixture-author",
    date: "2026-08-15",
    href: "https://github.com/owner/repository/commit/0123456789abcdef0123456789abcdef01234567",
  },
  {
    id: "spending-fixture",
    source: "spending",
    title: "서울 카페",
    description: "5,000원 · 식비",
    date: "2026-08-15",
    href: "/dashboard?date=2026-08-15",
  },
  {
    id: "visit-fixture",
    source: "visit",
    title: "서울 공원",
    description: "산책",
    date: "2026-08-14",
    href: "/dashboard?date=2026-08-14",
  },
  {
    id: "trip-fixture",
    source: "trip",
    title: "서울 여행",
    description: "친구와 주말 여행",
    date: "2026-08-14",
    href: "/travel/trip-fixture",
  },
];

test.beforeEach(async ({ page }) => {
  await fixtures(page);
});

test("search submits dated filters, links records and restores pages through history", async ({
  page,
}, testInfo) => {
  const requests: Record<string, string>[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/search?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(Object.fromEntries(params));
    const currentPage = Number(params.get("page"));
    const source = params.get("source");
    return route.fulfill({
      json: {
        items:
          currentPage === 2
            ? [{ ...firstPage[0], id: "second", title: "두 번째 페이지 기록" }]
            : firstPage.filter((item) => source === "all" || item.source === source),
        page: currentPage,
        hasMore: currentPage === 1,
      },
    });
  });
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "기록 검색", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  const requestCount = requests.length;
  await page.getByLabel("검색어", { exact: true }).fill("서울");
  await page.getByLabel("시작일", { exact: true }).fill("2026-08-01");
  await page.getByLabel("종료일", { exact: true }).fill("2026-08-31");
  await expect(
    page.getByText("검색 버튼을 누르면 변경한 조건이 적용됩니다.", { exact: false })
  ).toBeVisible();
  expect(requests).toHaveLength(requestCount);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect
    .poll(() => requests.at(-1))
    .toEqual({
      q: "서울",
      from: "2026-08-01",
      to: "2026-08-31",
      source: "all",
      page: "1",
    });
  for (const item of firstPage) {
    await expect(
      page.getByRole("link").filter({ has: page.getByRole("heading", { name: item.title }) })
    ).toHaveAttribute("href", item.href);
  }
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("heading", { name: "두 번째 페이지 기록" })).toBeVisible();
  await expect(page.getByText("2페이지", { exact: true })).toBeVisible();
  await page.getByLabel("기록 종류", { exact: true }).selectOption("trip");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  await expect(page.getByText("1페이지", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.source).toBe("trip");
  await page.goBack();
  await expect(page.getByLabel("기록 종류", { exact: true })).toHaveValue("all");
  await expect(page.getByLabel("검색어", { exact: true })).toHaveValue("서울");
  await expect(page.getByText("2페이지", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("1페이지", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("시작일", { exact: true })).toHaveValue("2026-08-01");
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width
  );
  await page.screenshot({ path: testInfo.outputPath("search.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("search distinguishes failures, retries, empty results and invalid ranges", async ({
  page,
}) => {
  let fail = true;
  let calls = 0;
  await page.route("**/api/search?*", (route) => {
    calls += 1;
    return route.fulfill(
      fail
        ? { status: 503, json: { error: "unavailable" } }
        : { json: { items: [], page: 1, hasMore: false } }
    );
  });
  await page.goto("/search?from=2026-08-01&to=2026-08-31&source=all&page=1");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "기록을 검색하지 못했습니다."
  );
  await expect(page.getByText("조건에 맞는 기록이 없습니다.", { exact: false })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByText("조건에 맞는 기록이 없습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  const before = calls;
  await page.getByLabel("시작일", { exact: true }).fill("2024-01-01");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("최대 366일");
  await expect(page.getByRole("button", { name: "검색", exact: true })).toBeDisabled();
  expect(calls).toBe(before);
  await page.goto("/search?from=2026-08-01&to=2026-08-31&page=101");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "검색 주소의 조건이 올바르지 않습니다."
  );
  expect(calls).toBe(before);
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("1페이지", { exact: true })).toBeVisible();
});

test("all primary navigation links remain named and reachable at 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route("**/api/search?*", (route) =>
    route.fulfill({ json: { items: firstPage, page: 1, hasMore: false } })
  );
  await page.goto("/search");
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });
  for (const name of ["소비", "포트폴리오", "여행", "건강", "대시보드", "기록 검색"]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toBeVisible();
    const bounds = await navigation.getByRole("link", { name, exact: true }).boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(36);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  await expect(navigation.getByRole("link", { name: "기록 검색" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("historical commit results open the original commit", async ({ page }) => {
  const commit = firstPage[0];
  await page.route("**/api/search?*", (route) =>
    route.fulfill({ json: { items: [commit], page: 1, hasMore: false } })
  );
  await page.route(commit.href, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Original historical commit</h1>" })
  );
  await page.goto("/search?from=2026-08-01&to=2026-08-31&source=commit");
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: commit.title }) })
    .click();
  await expect(page).toHaveURL(commit.href);
  await expect(page.getByRole("heading", { name: "Original historical commit" })).toBeVisible();
});
