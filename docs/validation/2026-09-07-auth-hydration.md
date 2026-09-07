# Protected page hydration validation — 2026-09-07

After PR #42 deployed, a fresh anonymous visit to `/data-status` intermittently
raised React #418 (HTML mismatch). This was separate from the privacy email
obfuscation mismatch fixed in that PR.

## Cause and fix

`QueryProvider` starts Better Auth's shared session request before the protected
page finishes loading. The server renders the page's pending-session paragraph.
When the anonymous request settles before the page hydrates, `useRequireAuth`
previously returned `isLoading: false`, so the page rendered null instead.

Delaying the page chunk until after the session response reproduced the exact
mismatch. The anonymous browser regression failed before the fix. `useAuth` now
uses React's server hydration snapshot to keep both session data and loading
state consistent with SSR until hydration completes. Client navigation reads the
current session immediately. API authorization and session storage are unchanged.

## Validation

- Before fix: anonymous delayed-page regression failed on hydration mismatch;
  authenticated control passed.
- After fix: both session states passed on desktop and mobile in development.
- Production-mode browser suite: 26 passed, including the four delayed-page cases
  and existing search, navigation, chart, collection recovery and KST tests.
- Unit suite: 1,086 tests passed in 128 files. Typecheck passed. Lint passed with
  92 existing warnings and one informational diagnostic.
- Tests use an isolated headless browser, synthetic sessions and a disposable app
  copy with cron disabled. No personal Chrome/Orca interaction or production
  recovery job was performed.

The previous browser suite did not control the order of session completion and
page-code arrival. The regression now exercises that order explicitly, checks
that the chunk was delayed, and rejects all browser errors.

The normal Turbopack `yarn build` also passed. No dependency, runtime pin,
Jenkins configuration or database migration changes are included in this fix.
