# Google Health API — U1 spike findings

Durable conclusions from the live U1 spike (throwaway probe: `scripts/probe-google-health.ts`).
This is the source material the U5 metric-config map is built from.

> Privacy note: this doc records API **shapes and field names only**, never real
> sample readings. The probe's raw output (which contains personal health values)
> is written to a gitignored local run and must not be committed.

## Status

- **Restricted-scope viability — RESOLVED.** OAuth authorize + data reads succeed
  for the owner's account with the app in Testing mode + test users, using the
  three Restricted category scopes below. No verification / CASA needed to serve
  the owner's own data. (Testing mode caps the refresh token at 7-day expiry;
  moving to Production — even unverified — removes that cap. Do this before relying
  on durable background sync.)
- **Data source — the API serves Health Connect aggregates, not Fitbit directly.**
  In the owner's account today every point comes from Samsung Health
  (`com.sec.android.app.shealth`) or the phone pedometer (`android`). Zero Fitbit
  points: the Fitbit Air's data reaches the API only once the Google Health app
  (formerly Fitbit) is told to **write** its categories to Health Connect. Until
  then the pipe carries phone-aggregated data — which is the accepted Phase-1 input.

## 1. OAuth / scopes

- Authorize: `accounts.google.com/o/oauth2/v2/auth`; token: `oauth2.googleapis.com/token`.
- `access_type=offline` + `prompt=consent` → refresh token on every grant. Google
  refresh tokens do **not** rotate (refresh responses omit `refresh_token`).
- Scopes are broad **category** scopes (not per-metric), all Restricted:
  - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
  - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
  - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
- `openid` yields an id_token whose `sub` we store as `google_sub`.

## 2. `list` method (the primary read path)

`GET health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints`

- **No `startTime`/`endTime` query params.** Time windowing uses the AIP-160
  `filter` param, plus `pageSize` + `pageToken`. Results are **newest-first**.
- The `filter` field name is **snake_case**; camelCase / hyphenated forms return
  `400 INVALID_DATA_POINT_FILTER_*`. Verified:
  - interval metric: `filter=steps.interval.start_time >= "2026-07-05T00:00:00Z"`
  - instant metric: `filter=heart_rate.sample_time.physical_time >= "2026-07-05T00:00:00Z"`
  - closed-open backfill window: append ` AND {field} < "…"`.
- Each point carries `dataSource.application.packageName` (the writing app) — this
  is the multi-source signal (see §5).

## 3. Per-metric shape (ground-truthed)

Each point wraps its payload under a camelCase key = `dataType` camelCased
(`heart-rate` → `heartRate`). Timestamp lives under `interval.startTime`
(accumulating) or `sampleTime.physicalTime` (instantaneous). Scalar values arrive
as **string OR number** — always coerce. `startUtcOffset` / `utcOffset` on every
point is `"32400s"` (KST, +9h).

| metric key | dataType | wrapper | time field | value key | value type | shape |
|---|---|---|---|---|---|---|
| steps | `steps` | `steps` | `interval.startTime` | `count` | string | scalar, sum |
| distance | `distance` | `distance` | `interval.startTime` | `millimeters` | string | scalar, sum |
| heart_rate | `heart-rate` | `heartRate` | `sampleTime.physicalTime` | `beatsPerMinute` | string | scalar, avg |
| spo2 | `oxygen-saturation` | `oxygenSaturation` | `sampleTime.physicalTime` | `percentage` | number | scalar, avg |
| vo2_max | `vo2-max` | `vo2Max` | `sampleTime.physicalTime` | `vo2Max` | number | scalar, avg |
| exercise | `exercise` | `exercise` | `interval.startTime` | — (whole obj) | object | structured → valueJson |

**Empty-but-valid today** (`list` returns `{}`; populate once Fitbit writes to
Health Connect): `sleep`, `daily-resting-heart-rate`, `heart-rate-variability`,
`daily-heart-rate-variability`, `active-zone-minutes`, `active-energy-burned`,
`run-vo2-max`, `core-body-temperature`, `daily-sleep-temperature-derivations`.
These are why U7 needs a distinct "connected, no data" state (R12).

**`total-calories`**: `list` unsupported (`UNSUPPORTED_DATA_TYPE_ACTION`) — rollup /
dailyRollUp only.

## 4. `dailyRollUp` (not used by U5's first cut)

`POST …/dataPoints:dailyRollUp` with `{ range: { start, end }, windowSizeDays }`.
`range.start`/`range.end` reject a flat `{year,month,day}` — they need a nested
CivilDateTime (`{ date: {...}, time: {...} }`), still **unverified against a 200**.
U5 computes daily summaries from intraday `list` samples via `localDaySql` instead,
so dailyRollUp is deferred to when a rollup-only metric (e.g. total-calories) is
actually wanted.

## 5. Multi-source — decided list-vs-reconcile

Real multi-source data is confirmed (phone + Samsung Health now; Fitbit will join).
Google's `reconcile` merges sources server-side, but we chose `list` + a `source`
column (Health Connect package name) as part of the sample identity
(`unique(userId, metric, sampleAt, source)`, migration 0028). Rationale: **lossless**
— no source's value is dropped on conflict, and a cleaner reconciliation can be
recomputed later from stored rows. While single-source (Fitbit not yet connected),
daily `sum`/`avg` over all rows is correct; source-aware dedup is deferred until
real overlapping multi-source data exists to calibrate against.

## Decisions this unblocked (→ U5)

- **Metric config map** (`HEALTH_METRICS` in `src/modules/health/service.ts`): the
  six ground-truthed metrics above; `list`-based intraday; daily summaries via
  `localDaySql`; `sum` metrics populate `valueSum`, `avg` metrics leave it null.
- **`value` vs `valueJson`**: scalars (steps/distance/heart_rate/spo2/vo2_max) →
  `value`; structured (exercise, and later sleep) → `valueJson`.
- **Backfill floor**: no hard retention number surfaced; seed `backfillFloor` at
  now − 90d (idempotent — empty windows still advance the watermark).
