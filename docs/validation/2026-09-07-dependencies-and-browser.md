# Dependency and browser regression validation

## Dependency audit

Node 24.20.0 and Yarn 4.5.0 are the validation runtime. Direct versions are recorded in
`package.json`; `yarn.lock` contains the exact transitive versions. Run `yarn install --immutable`
to reproduce the dependency graph.

After the direct upgrades, the recursive audit still reported 34 entries. Compatible lockfile
refreshes of `@babel/core`, `brace-expansion`, `browserslist`, `defu`, `ip-address`, `minimatch`,
`nanoid`, `picomatch`, `postcss`, and `tar` removed every high/critical finding without
cross-major resolutions.

`yarn npm audit --all --recursive --json` now reports three moderate entries:

| Package | Entry | Applicability |
| --- | --- | --- |
| `@esbuild-kit/esm-loader@2.6.5` | Deprecation: merged into tsx | Transitive dependency of current stable `drizzle-kit@0.31.10`. |
| `@esbuild-kit/core-utils@3.3.2` | Deprecation: merged into tsx | Used by the loader above. |
| `esbuild@0.18.20` | GHSA-67mh-4wv8-2f99 | Advisory concerns esbuild's development HTTP server. The loader calls the transform API, not `serve()`. No application path or project script starts the affected server. |

These entries are retained and visible. Forcing a newer esbuild across its 0.x compatibility
boundary or replacing the upstream loader with an unrelated package would add migration risk.
Recheck when a stable Drizzle Kit drops that chain. The production server image does not copy
the entire development dependency tree.

Yarn also reports existing Sentry peer metadata warnings. The node-modules linker supplies the
installed packages; type checking and actual app build/runtime validation remain the relevant
checks. No audit entries are silenced.

## Recharts 3 migration

The earlier rollback `d84080a` recorded missing ComposedChart series, short bars, collapsed
PieChart donuts, and a missing storage semicircle despite a passing build and unit suite.
This migration uses Recharts' public content types for Tooltip/Legend, accepts the wider
formatter input types, and displays zero tooltip values correctly. It preserves measured
containers without the previous upgrade's hard-coded initial 320×200 dimensions.

Entrance interpolation is disabled on the seven live charts: financial values are drawn at
their final positions immediately after data arrives. Account allocation radii fit their
small mobile container, and the storage legend stacks below its semicircle on narrow screens.

## Browser harness

`yarn exec playwright install chromium` installs the local browser, then `yarn test:browser`
runs desktop (1440×1000) and mobile (390×844) cases. `BROWSER_TEST_PRODUCTION=true yarn
test:browser` builds optimized Next.js output first; Jenkins' Debian browser-tester target uses
that mode and installs Chromium's Linux system dependencies with `--with-deps`.

The server is a disposable copy of application source/config only. It copies no `.env` files,
uses dummy auth values and an unreachable loopback database, and sets `DISABLE_CRON=true`.
All browser API calls use fixtures, and external browser requests are blocked. The chart
gallery is injected only into the disposable copy, never into shipped application routes.
Webpack is used for this external-node_modules-symlink test copy; the separate normal Docker
build still validates the production Turbopack/standalone deployment path.

Cases cover actual spending, dashboard and health pages, plus the four other production chart
components. They assert visible series geometry and stacked value ratios, mobile width,
zero-commit life timeline visibility, and health failure → retry → empty state. Screenshots and
failure traces are written to gitignored `test-results/`; HTML output is in `playwright-report/`.

The collection-status case additionally covers a failed status fetch and retry, distinct
unknown/checked empty dates, rejected recovery and retry, the exact queued source/date payload,
and a pending job that remains disabled after page reload. Both layouts include screenshot
artifacts. Final local optimized build + browser result: **10/10 passed (27.7s)**. Local
`yarn typecheck` and `yarn install --immutable` also passed after the final dependency changes.

`tsx@4.23.13` is a direct pinned development dependency. Migration and backfill scripts use its
installed CLI, and Jenkins integration runs the installed Vitest CLI; neither fetches an
unpinned tool at execution time. `dev` and `build` explicitly invoke the Node version guard
because Yarn 4 does not run arbitrary implicit `predev`/`prebuild` hooks.
