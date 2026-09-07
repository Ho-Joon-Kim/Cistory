# Better Auth 1.7.3 compatibility evidence

Verified on 2026-09-07 with the installed Better Auth 1.7.3 package, Node 24, and disposable PostgreSQL.

The [official 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-keeps-the-provider-key) states that 1.7.3 restores the 1.6 account schema: a direct upgrade from 1.6.28 needs no `account.issuer` column. Instructions for relaxing that column apply only to databases migrated through 1.7.0–1.7.2.

`src/lib/auth-compatibility.integration.test.ts` creates a private legacy core schema with no `issuer` column and imports the application's actual `src/lib/auth.ts` configuration with its database singleton redirected to a private test pool. It verifies:

- The installed `getMigrations(auth.options)` read-only plan requests no new core tables or columns and reports no unsafe changes. The test does not execute the generated plan; index suggestions are allowed.
- Actual signed session cookies authenticate through `auth.api.getSession`.
- `signOut` revokes its session and emits expiring cookies while other devices remain authenticated.
- The application's transactional `deleteAccount` immediately revokes two remaining device cookies and removes the stored account credential. Subsequent `signOut` with the deleted session still succeeds.
- Duplicate `(providerId, accountId)` identities are rejected by the installed internal account lookup instead of selecting an arbitrary user.

All three tests passed. All external `fetch` calls are forbidden by the fixture; the GitHub OAuth redirect/token exchange itself is outside this local verification.

Before production rollout, run this read-only query against the actual Better Auth account table and resolve any returned duplicate identities while keeping different users separate:

```sql
SELECT "providerId", "accountId", count(*)
FROM account
GROUP BY 1, 2
HAVING count(*) > 1;
```

The fixture proves compatibility of the tested legacy schema and installed code. It does not inspect production schema drift or production account duplicates.

Run with the repository's `yarn test:integration`; the test accepts only `TEST_DATABASE_URL` and drops its private schema afterward.
