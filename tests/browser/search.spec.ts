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

test("search reads natural text into filters, links records and restores through history", async ({
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
            ? [{ ...firstPage[0], id: "second", title: "두 번째 페이지 기록", date: "2026-08-13" }]
            : firstPage.filter((item) => source === "all" || item.source === source),
        page: currentPage,
        hasMore: currentPage === 1 && source === "all",
        counts: { commit: 2, spending: 1, visit: 1, trip: 1 },
      },
    });
  });
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "기록 검색", exact: true })).toBeAttached();
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  await page.getByLabel("검색어", { exact: true }).fill("2026년 8월 서울");
  await page.getByLabel("검색어", { exact: true }).press("Enter");
  await expect
    .poll(() => requests.at(-1))
    .toEqual({ q: "서울", from: "2026-08-01", to: "2026-08-31", source: "all", page: "1" });
  await expect(page.getByRole("button", { name: "기간 2026년 8월 바꾸기" })).toBeVisible();
  for (const item of firstPage) {
    await expect(
      page.getByRole("link").filter({ has: page.getByRole("heading", { name: item.title }) })
    ).toHaveAttribute("href", item.href);
  }
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "두 번째 페이지 기록" })).toBeVisible();
  expect(requests.at(-1)?.page).toBe("2");
  // Day groups keep loaded pages together.
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  await page.getByRole("button", { name: /^여행/ }).click();
  await expect(page.getByRole("button", { name: /^여행/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "서울 카페" })).toHaveCount(0);
  expect(requests.at(-1)?.source).toBe("trip");
  await page.goBack();
  await expect(page.getByRole("button", { name: /^전체/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("검색어", { exact: true })).toHaveValue("2026년 8월 서울");
  await page.reload();
  await expect(page.getByRole("button", { name: "기간 2026년 8월 바꾸기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "서울 여행" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width
  );
  await page.screenshot({ path: testInfo.outputPath("search.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("several sources in the text become removable chips", async ({ page }) => {
  const requests: Record<string, string>[] = [];
  await page.route("**/api/search?*", (route) => {
    requests.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    return route.fulfill({ json: { items: firstPage, page: 1, hasMore: false } });
  });
  await page.goto("/search");
  await page.getByLabel("검색어", { exact: true }).fill("오늘 쓴 돈이랑 간 곳");
  await page.getByLabel("검색어", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "출처 소비 조건 지우기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "출처 방문 조건 지우기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "서울 카페" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "서울 공원" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "서울 여행" })).toHaveCount(0);
  expect(requests.at(-1)?.source).toBe("all");
  expect(requests.at(-1)?.q).toBe("");
  await page.getByRole("button", { name: "출처 방문 조건 지우기" }).click();
  await expect(page.getByRole("heading", { name: "서울 공원" })).toHaveCount(0);
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
  await page.goto("/search?from=2026-08-01&to=2026-08-31&source=all");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("기록을 검색하지 못했어요");
  await expect(page.getByText("이 기간에는 기록이 없어요")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByText("이 기간에는 기록이 없어요")).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  const before = calls;
  await page.getByRole("button", { name: /^기간 .* 바꾸기$/ }).click();
  await page.getByRole("button", { name: "날짜 직접 고르기" }).click();
  await page.getByLabel("시작일", { exact: true }).fill("2024-01-01");
  await expect(page.getByRole("alert").filter({ hasText: "최대 366일" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 기간으로 검색" })).toBeDisabled();
  expect(calls).toBe(before);
  await page.keyboard.press("Escape");
  await page.goto("/search?from=2026-08-01&to=2026-08-31&page=101");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "검색 주소의 조건이 올바르지 않아요"
  );
  expect(calls).toBe(before);
  await page.getByLabel("검색어", { exact: true }).press("Enter");
  await expect(page.getByText("이 기간에는 기록이 없어요")).toBeVisible();
});

test("all primary navigation links remain named and reachable at 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route("**/api/search?*", (route) =>
    route.fulfill({ json: { items: firstPage, page: 1, hasMore: false } })
  );
  await page.goto("/search");
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });
  // Phones get the app bar's second row: a horizontally scrolling pill strip.
  for (const name of ["타임라인", "개요", "소비", "포트폴리오", "여행", "건강", "검색"]) {
    const link = navigation.getByRole("link", { name, exact: true });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(36);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  await expect(navigation.getByRole("link", { name: "검색", exact: true })).toHaveAttribute(
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
