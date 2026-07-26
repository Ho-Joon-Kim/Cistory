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
| ~~exercise~~ | `exercise` | `exercise` | `interval.startTime` | — (whole obj) | object | structured — **deferred** |

**exercise deferred**: `list` works unfiltered, but every interval `filter` variant
is rejected 400 (`INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER`) — the exercise data
type is not time-filterable via addressable members, so incremental windowing is
impossible without a different fetch strategy. Left out of `HEALTH_METRICS` (and it
isn't in the curated `/health` view anyway). The parser's structured branch still
ships for when it (or sleep) is re-enabled.

**Empty-but-valid today** (`list` returns `{}`; populate once Fitbit writes to
Health Connect): `sleep`, `daily-resting-heart-rate`, `heart-rate-variability`,
`daily-heart-rate-variability`, `active-zone-minutes`, `active-energy-burned`,
`run-vo2-max`, `core-body-temperature`, `daily-sleep-temperature-derivations`.
These are why U7 needs a distinct "connected, no data" state (R12).
**Superseded — all but `run-vo2-max` / `core-body-temperature` now carry real
Fitbit data; see §6.**

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

## 6. Re-probe 2026-07-26 — the Fitbit Air pipe opened

The Fitbit Air now writes to Health Connect, so everything §3 listed as
"empty-but-valid" carries data. Every one of these points arrives with
`dataSource.platform: "FITBIT"` and **no `application.packageName`**, so they land
under the `"unknown"` source bucket — that is expected, not a parse failure.

Enabled in `HEALTH_METRICS` as a result:

| metric key | dataType | wrapper | time shape | value key | agg |
|---|---|---|---|---|---|
| active_energy | `active-energy-burned` | `activeEnergyBurned` | interval | `kcal` | sum |
| active_zone_minutes | `active-zone-minutes` | `activeZoneMinutes` | interval | `activeZoneMinutes` | sum |
| hrv | `heart-rate-variability` | `heartRateVariability` | sampleTime | `rootMeanSquareOfSuccessiveDifferencesMilliseconds` | avg |
| resting_heart_rate | `daily-resting-heart-rate` | `dailyRestingHeartRate` | **date** | `beatsPerMinute` | avg |
| daily_hrv | `daily-heart-rate-variability` | `dailyHeartRateVariability` | **date** | `averageHeartRateVariabilityMilliseconds` | avg |
| daily_spo2 | `daily-oxygen-saturation` | `dailyOxygenSaturation` | **date** | `averagePercentage` | avg |
| respiratory_rate | `daily-respiratory-rate` | `dailyRespiratoryRate` | **date** | `breathsPerMinute` | avg |
| skin_temperature | `daily-sleep-temperature-derivations` | `dailySleepTemperatureDerivations` | **date** | `nightlyTemperatureCelsius` | avg |

### The `date` time shape (new)

Every `daily-*` dataType is keyed by a **civil date** (`{year, month, day}`), not a
timestamp. Two consequences:

- The filter compares against a bare day string — `daily_spo2.date >= "2026-07-25"`,
  closed-open windows work (`AND … < "…"`). The `.year` sub-field is rejected 400.
- Parsed points are anchored at **12:00 KST (03:00Z)** of that date, so `localDaySql`
  buckets them back into their own KST day from either edge.

These rollups are **revised until their day closes**, so their samples upsert with
DO UPDATE (`MetricConfig.revisable`) instead of DO NOTHING — otherwise the day's
first (partial) reading would stick forever.

### `sleep` — structured, still unfilterable

`sleep` has real data back to 2025-07 (18 sessions), but **every `list` filter
variant is still rejected 400** (`INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER`;
`sleep.interval.start_time` and `sleep.sleep_session.interval.start_time` both
verified). So it rides the same unfiltered full-history re-read as `exercise`
(`syncSessions`) — cheap at one row per night, and idempotent.

Its wrapper: `interval.{startTime,endTime}`, `type: "STAGES"`, `metadata.nap`, and
`stages[]` of `{startTime, endTime, type}` where type ∈ AWAKE/LIGHT/DEEP/REM. Note
this is a **different shape from the on-device Health Connect import** (epoch-millis
times, numeric `stage` codes) — `src/modules/health/sleep.ts` normalizes both, since
health_samples holds rows from each.

### Deliberately not synced

- **`weight` / `body-fat` / `height`** — populated, but from
  `com.withings.wiscale2`. The dedicated Withings integration already owns body
  composition in `body_measurements` with far richer fields (muscle/bone mass,
  visceral fat, BMR), so pulling them here would just double-render the same scale.
- **`total-calories`** — `list` unsupported (`UNSUPPORTED_DATA_TYPE_ACTION`);
  rollup-only, so it needs the deferred `dailyRollUp` path.
- **`run-vo2-max`, `core-body-temperature`, `blood-glucose`** — valid dataTypes,
  still genuinely empty for this account.
- Rejected as invalid dataType IDs (do not retry): `floors-climbed`,
  `elevation-gained`, `basal-metabolic-rate`, `daily-heart-rate`,
  `respiratory-rate` (only the `daily-` form exists), `skin-temperature`,
  `body-temperature`, `blood-pressure`, `nutrition`, `hydration`, `daily-readiness`,
  `menstruation`, `mindfulness`, `steps-cadence`, `speed`, `power`, `lean-body-mass`.

### Backfill completion is per-metric

Adding metrics to `HEALTH_METRICS` after a connection finished its first backfill
used to strand them with no history: `backfillPendingConnections` returned early on
the connection-level `backfillCompletedAt` flag. Completion is now tracked per
metric (`health_sync_state.backfilledFrom <= backfillFloor`, stamped at the floor
when the presence probe proves history ended), so new metrics backfill on their own
and the flag survives purely as the UI's "first backfill done" hint.
