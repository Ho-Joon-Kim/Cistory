# Record search and production validation

## Delivered behavior

- `/search` searches the signed-in owner's commits, transactions, visits (including current saved-place names), and trips by literal keyword, inclusive KST date range, and record type. Default 30 days; maximum 366 days, 200 characters, 30 results per page, 100 pages. Future trip dates are allowed.
- Applied filters and pagination survive URL navigation/reload; editing a draft does not silently replace results. Loading, retry, empty, and invalid-input states are explicit.
- Commits open their original GitHub commit, transactions open their KST day, visits open the actual starting day (including visits overlapping the search range), and trips open their detail page. Results use stable timestamp/source/ID ordering.
- Transaction search is labeled 거래 because deposits and self-transfers are searchable too. Date links and dashboard today use KST independently of browser timezone; a Los Angeles year-boundary regression failed before the fix and passed afterward.
- Header links have accessible names and retain all destinations at 320 px.
- Privacy contact markup opts out of Cloudflare email transformation using the documented `email_off` comments. The decoder-blocked production reproduction failed with React #418 text; the fixed fixture passes. The initial intermittent #418 HTML observation is still not causally attributed to this issue.
- Sentry client setup moves to `instrumentation-client.ts` for Turbopack. Browser fixture copying follows the rename. Search query parameters are scrubbed from browser/server/edge requests, referrers, breadcrumbs, child spans and root trace context; existing health scrubbing is preserved.

## Verification

- Unit suite: 1,086 tests in 128 files, including search telemetry regression coverage.
- PostgreSQL integration: 29 tests, including four search cases for tenant isolation, saved-place ownership, interval overlap, literal wildcard/quote matching, stable pagination, non-UTC connection timezone and exact KST day boundaries. Destination regression failed on the old overlap link before the fix and passed afterward.
- Production-mode Playwright: 22 passing desktop/mobile tests, including 320 px navigation, search submission/history/pagination/retry/empty states, original-commit navigation, decoder-independent privacy hydration, and KST midnight destination links from an America/Los_Angeles browser.
- Typecheck, lint and normal Turbopack build passed. Docker `runner` target passed using the Jenkins build recipe, including the final telemetry changes. Standalone runtime with a disposable legacy auth schema returned health 200, anonymous search 401, and privacy 200 with email opt-out markup. A real signed session in the disposable schema also returned search 200, ignored a supplied foreign user ID, retained the exact commit URL, returned `private, no-store`, and rejected an invalid date with 400. Fixture rows and auth tables were removed afterward. Existing lint warnings remain.
- Screenshots use synthetic fixtures: [desktop](images/search-desktop.png), [mobile](images/search-mobile.png).

## Read-only production check

Used a PostgreSQL connection enforcing `default_transaction_read_only=on` and a ten-second statement timeout. Queried the repository owner's application data without reading credentials or session tokens. Only aggregate validation results were retained; original records and monetary values were not written to this report.

- All seven sources are connected, without stale/error flags. Six sources have records within the last 30 days; Withings has no records in that window, which is not treated as a collection failure.
- Search returned bounded valid-date results for all four types. Observed one-run query latency including network was 40 ms combined and 13–15 ms per individual type; this is a smoke measurement, not a performance benchmark.
- Returns calculation had two accounts, 116 complete dates, no excluded dates, and finite output.
- Health raw samples in the checked window had no NaN/infinite numeric values.
- No existing recovery jobs were observed. A production one-day recovery was not executed: the user prohibited control of their desktop browser, and no separate authenticated browser session was available. Automated recovery behavior was verified against disposable fixtures and PostgreSQL, not claimed as a live recovery.

## Operational follow-up

After deployment, check `/api/health` is 200 and anonymous `/api/search` is 401; confirm `/privacy` preserves `mailto` without `__cf_email__`, including a decoder-blocked anonymous browser check. In a separately authenticated session, submit dated search filters and follow one result of each kind. Watch Sentry for React #418 and search request failures, verifying recorded search URLs contain no query strings. Revert the deployment if search authorization leaks data or core navigation breaks. Jenkins main build and immediate post-deployment checks are owned by the implementing agent.

## Review receipt

`ce-code-review` run `20260907-142223-76dba338` completed with verdict **Ready to merge**, no remaining actionable findings. Nine local lenses and an independent Claude Opus 5 adversarial pass were collected; accepted findings were verified on the final candidate. The initial unrelated hydration observation and unavailable live recovery remain explicit limitations above.
