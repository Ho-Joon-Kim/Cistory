import { expect, type Page, test } from "@playwright/test";

// /overview stale-while-revalidate: a snapshot queued for recompute still holds
// its last computed envelopes, and the page shows them with a small updating
// note instead of the full "계산하고 있어요" placeholder, then swaps in the fresh
// numbers without remounting (no replayed entrance/count-up).

const PERIOD = { periodType: "month", periodKey: "2026-10" } as const;
const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

function envelope(data: unknown, computedAt: string) {
  return { status: "ready", data, computedAt, computeVersion: 5, errorCode: null };
}

function domains(commits: number, computedAt: string) {
  return {
    coding: envelope(
      {
        totalCommits: commits,
        totalAdditions: 1200,
        totalDeletions: 300,
        activeDays: 12,
        dailyCommits: days.map((date, i) => ({ date, count: i % 3 === 0 ? 3 : 0 })),
        commitTypes: [{ type: "feat", count: commits }],
        projects: [{ name: "Cistory", commits, additions: 1200, deletions: 300 }],
        totalCodingSeconds: 36_000,
        dailyCodingSeconds: days.map((date) => ({ date, seconds: 1_200 })),
        languages: [{ name: "TypeScript", seconds: 36_000 }],
        deepWorkSessions: [],
        contextSwitching: { avgDailyProjects: 1, avgDailyLanguages: 1 },
        weekdayHour: { weekdays: [0, 1, 2, 3, 4, 5, 6], hours: Array(24).fill(0) },
      },
      computedAt
    ),
    spending: envelope(
      {
        spending: 500_000,
        income: 2_000_000,
        netSpend: -1_500_000,
        daily: days.map((date) => ({
          date,
          spending: 16_000,
          income: 0,
          netSpend: 16_000,
        })),
        accountRoles: [],
        categories: [{ category: "food", spending: 300_000 }],
      },
      computedAt
    ),
    location: null,
    health: null,
    portfolio: null,
  };
}

const STALE_AT = "2026-11-01T00:00:00.000Z";
const FRESH_AT = "2026-11-10T00:00:00.000Z";

async function fixtures(page: Page, overview: () => unknown, writes: string[]) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3210") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/auth/get-session") {
      return route.fulfill({
        json: {
          user: {
            id: "browser-overview",
            name: "Browser",
            email: "browser@example.test",
            emailVerified: true,
            image: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          session: {
            id: "overview-fixture",
            userId: "browser-overview",
            token: "fixture",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        },
      });
    }
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, json: {} });
    }
    if (url.pathname === "/api/overview") return route.fulfill({ json: overview() });
    if (url.pathname === "/api/timeline/stats")
      return route.fulfill({ json: { stats: [], maxCount: 0 } });
    return route.fulfill({ json: {} });
  });
}

test("renders a stale pending snapshot with an updating note, then swaps in place", async ({
  page,
}) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let fresh = false;
  await fixtures(
    page,
    () =>
      fresh
        ? { status: "ready", ...PERIOD, computedAt: FRESH_AT, domains: domains(50, FRESH_AT) }
        : {
            status: "pending",
            stale: true,
            ...PERIOD,
            computedAt: STALE_AT,
            domains: domains(42, STALE_AT),
          },
    writes
  );

  await page.goto(`/overview?periodType=${PERIOD.periodType}&periodKey=${PERIOD.periodKey}`);

  const note = page.getByTestId("overview-updating");
  await expect(note).toHaveText("최신 기록으로 업데이트하고 있어요");
  await expect(page.getByText("이 기간을 계산하고 있어요")).toHaveCount(0);
  await expect(page.getByText("42", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("11월 1일").first()).toBeVisible();

  // Tag the rendered view; it must survive the swap (same tree, no remount).
  const view = page.locator("#main section").first();
  await view.evaluate((element) => element.setAttribute("data-probe", "kept"));

  fresh = true;
  // First back-off step is 3 s.
  await expect(note).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText("50", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-probe="kept"]')).toHaveCount(1);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("shows the full computing state only when a pending snapshot has no data", async ({
  page,
}) => {
  const writes: string[] = [];
  await fixtures(page, () => ({ status: "pending", ...PERIOD }), writes);

  await page.goto(`/overview?periodType=${PERIOD.periodType}&periodKey=${PERIOD.periodKey}`);

  await expect(
    page.getByText("이 기간을 계산하고 있어요. 끝나면 바로 보여드릴게요.")
  ).toBeVisible();
  await expect(page.getByTestId("overview-updating")).toHaveCount(0);
  expect(writes).toEqual([]);
});
