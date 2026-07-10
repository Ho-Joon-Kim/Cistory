# Google Health API — U1 spike findings

> Live verification spike for the Fitbit Air / Google Health integration.
> Origin: `docs/plans/2026-07-10-002-feat-fitbit-google-health-integration-plan.md` (U1).
> Fill this in by running `scripts/probe-google-health.ts` (it appends raw probe
> output below the checklist), then hand-summarize the confirmed facts here. The
> facts recorded here gate U5's metric config map and U2's column choices.

## Status

- [ ] **GCP setup done** — API enabled, `client_secret` rotated into `.env` (R11), consent screen switched to **In Production** (unverified OK), loopback redirect URI added.
- [ ] **Connect probe run** — `yarn tsx scripts/probe-google-health.ts` succeeded, refresh token obtained.
- [ ] **Durability recheck (T+8d)** — `yarn tsx scripts/probe-google-health.ts --refresh` succeeded at token age > 7 days (proves the Testing 7-day cap is gone).

## Confirmed facts (fill in from probe output)

### 1. OAuth / scopes
- Exact readonly scope strings that the consent screen actually grants: _(list — reconcile with `SCOPES` in the probe script)_
- Refresh-token behaviour: rotates? _(expected: NO — Google keeps the same refresh token)_

### 2. Metric availability + shape

For each metric: does it return data, is the value **scalar** (→ `health_samples.value`) or **structured** (→ `valueJson`), is it **total-shaped** (→ needs `health_daily_summaries.valueSum`), and does it report **multiple data sources** (→ list vs `reconcile`)?

| dataType | returns data? | value shape (scalar/struct) | total-shaped? | multi-source? | notes |
|---|---|---|---|---|---|
| `steps` | | | | | |
| `heart-rate` | | | | | |
| `oxygen-saturation` | | | | | |
| `sleep` | | | | | |
| `daily-resting-heart-rate` | | | | | |
| `heart-rate-variability` | | | | | |
| `daily-respiratory-rate` | | | | | |
| `vo2-max` | | | | | |
| `daily-sleep-temperature-derivations` | | | | | |
| `readiness` | | | | | |

### 3. API mechanics
- `list` (intraday): pageSize cap observed, `nextPageToken` present?, exact time-filter param names that worked: _____
- `dailyRollUp`: exact request body that worked, span cap per metric (14d for HR/active-minutes/total-calories, 90d others?), and **aggregation timezone** (KST / UTC / account-TZ): _____
- Intraday **retention limit** (oldest queryable instant) → seeds `health_connections.backfillFloor`: _____
- Published rate limits (from Cloud Console quotas): _____

## Decisions this unblocks
- **U5 metric config map** — `{ metric → { dataType, mode, shape } }`: _(derive from the table above)_
- **U2 column usage** — which metrics use `value` vs `valueJson`, which need `valueSum`: _____
- **Open Question — list vs reconcile** — resolved to: _____

<!-- Probe runs append raw output below this line. -->
