/**
 * Compare region/country extraction: the CURRENT `visits.city` / `visits.country_name`
 * (still mostly the pre-refactor address-string guess — e.g. "Nonhyeon-dong,",
 * "06628,", "목척7길" in `city`; "1號1樓" in `country_name`) against a live
 * re-geocode's structured `region`/`country` fields (Task 1-4 adapters).
 *
 * This is READ-ONLY. It calls the Kakao/Google geocoding APIs and reads
 * `place_cache` + `visits`, but issues no INSERT/UPDATE/DELETE — in
 * particular it never writes the freshly geocoded results back to
 * `place_cache`, or a second run would just be re-reading what the first run
 * wrote and the comparison would stop being repeatable. Its output decides
 * whether the full backfill (Task 6) is worth running at all.
 *
 * Usage:
 *   npx tsx scripts/compare-region-extraction.ts --confirm [--limit=N]
 *
 *     --confirm    required. This script fires live requests against the
 *                  billed/rate-limited Kakao and Google geocoding APIs, so a
 *                  bare/accidental invocation must refuse to run rather than
 *                  silently spending quota. Not a data-safety guard (the
 *                  script writes nothing) — purely an API-cost guard.
 *     --limit=N    sample size drawn from `place_cache`, allocated
 *                  proportionally across providers (default 100).
 *
 * Judgment calls (no test file — this is an operational script nothing
 * imports, see the brief's own "Produces" line):
 *
 * 1. roundCoord: the brief says to reuse `roundCoord` from `src/lib/geo` to
 *    join `visits` back to a `place_cache` key. That function rounds to 6
 *    decimals (~11cm, calibrated for the `location_points` unique index) —
 *    but `place_cache.lat_key`/`lon_key` are actually written by a *separate*,
 *    non-exported 3-decimal `roundCoord` defined locally inside
 *    visit-persister.ts (~111m grid, deliberately coarse so nearby visits
 *    share one geocode). Confirmed empirically against the dev DB: sampled
 *    `place_cache` rows hold values like `37.522` / `126.924` — 3 decimal
 *    places, not 6. Using the 6-decimal function here would silently produce
 *    zero `visits` joins. Since the real function isn't exported, its exact
 *    rounding is replicated below (`roundCoord3`) instead.
 *
 * 2. `visits` join cardinality: `place_cache` is a global (userId-less)
 *    cache, and several `visits` rows can legitimately round to the same
 *    `(latKey, lonKey)` cell. When more than one matches, the most recently
 *    `calculatedAt` visit is used as "the current value" — it's the freshest
 *    snapshot of what a user would see today.
 *
 * 3. Classification completeness: the brief's 4 rules (개선/동일/악화/판정불가)
 *    don't literally partition every (current, next) pair — e.g. current=null,
 *    next=a broken non-null string matches none of the 4 conditions as
 *    written. See `classify()` below for the fallback and its rationale.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";

// Next.js itself reads both files with .env.local taking precedence. Every
// existing script in this repo hardcodes only .env.local, but the geocoding
// API keys (KAKAO_REST_API_KEY, GOOGLE_MAPS_API_KEY) live in .env, so this
// script must load both or it silently geocodes nothing.
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

// Scripts use relative imports, not the "@/" alias — matches
// scripts/calibrate-track-splitting.ts and scripts/backfill-tracks.ts.
import { count, eq, sql } from "drizzle-orm";
import { type Database, getDb, getPool, placeCache, visits } from "../src/db";
import {
  type GeocodingResult,
  getGeocodingAdapter,
  isInKorea,
} from "../src/lib/adapters/geocoding";

const DEFAULT_LIMIT = 100;
const CONCURRENCY = 5;
const GOOGLE_GEOCODE_API_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

// ============ CLI args ============

interface CliOptions {
  limit: number;
}

interface ParseError {
  error: string;
}

function parseArgs(rawArgv: string[]): CliOptions | ParseError {
  let confirm = false;
  let limit = DEFAULT_LIMIT;
  const unknown: string[] = [];

  for (const arg of rawArgv) {
    if (arg === "--confirm") {
      confirm = true;
    } else if (arg.startsWith("--limit=")) {
      const raw = arg.slice("--limit=".length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return { error: `--limit must be a positive integer, got ${JSON.stringify(raw)}.` };
      }
      limit = n;
    } else {
      unknown.push(arg);
    }
  }

  if (unknown.length > 0) {
    return {
      error: `Unrecognised argument(s): ${unknown.map((a) => JSON.stringify(a)).join(", ")}.`,
    };
  }
  if (!confirm) {
    return { error: "Missing required --confirm flag." };
  }

  return { limit };
}

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(
    [
      "Usage: npx tsx scripts/compare-region-extraction.ts --confirm [--limit=N]",
      "",
      "  --confirm   required — this script makes LIVE calls to the Kakao and",
      "              Google geocoding APIs (billed / rate-limited), so a bare",
      "              invocation refuses to run rather than silently spending quota.",
      "  --limit=N   sample size drawn from place_cache, allocated proportionally",
      "              across providers (default 100).",
      "",
      "Read-only: reads place_cache + visits. Writes nothing, ever.",
    ].join("\n")
  );
  exit(1);
}

// ============ Classification (verbatim from the task-5 brief) ============

/** 판정용 시/도 목록. trip-naming.ts의 DOMESTIC_REGION_ALIASES는 Task 7에서 삭제되므로 참조하지 않는다. */
const SIDO = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
];

/** 값이 행정구역으로 보이지 않으면 true. */
function looksBroken(value: string | null, inKorea: boolean): boolean {
  if (!value) return true;
  const v = value.trim().replace(/,$/, "");
  if (/^\d+$/.test(v)) return true; // 우편번호
  if (inKorea) return !SIDO.some((s) => v.startsWith(s));
  return false; // 해외 region은 자동 판정하지 않는다 — country 쪽으로 판정한다
}

/**
 * ISO country-name whitelist for the overseas `country` check. Doesn't need
 * to cover the whole world per the brief — just what actually shows up in
 * `place_cache` today (대한민국, Hong Kong, Vietnam, Japan) plus ~20 common
 * countries. Google's adapter requests `language=en`, so English long_name
 * values are what actually arrive; Kakao always emits the literal "대한민국".
 */
const ISO_COUNTRY_NAMES = new Set([
  "대한민국",
  "Korea",
  "South Korea",
  "Republic of Korea",
  "Hong Kong",
  "Japan",
  "Vietnam",
  "China",
  "Taiwan",
  "Thailand",
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "United States",
  "USA",
  "United States of America",
  "Canada",
  "United Kingdom",
  "UK",
  "France",
  "Germany",
  "Italy",
  "Spain",
  "Australia",
  "New Zealand",
  "Mexico",
  "Brazil",
  "India",
  "Netherlands",
  "Switzerland",
  "Cambodia",
  "Laos",
  "Mongolia",
]);

/** Overseas analogue of looksBroken(): "행정구역으로 보이지 않으면" → "ISO 국가명이 아니면". */
function looksBrokenCountry(value: string | null): boolean {
  if (!value) return true;
  const v = value.trim().replace(/,$/, "");
  if (/^\d+$/.test(v)) return true; // 우편번호
  return !ISO_COUNTRY_NAMES.has(v);
}

/** 정규화: 양끝 공백·후행 쉼표 제거, 시/도 접미사(특별자치시/특별시/광역시/도) 제거. */
const REGION_SUFFIXES = ["특별자치시", "특별시", "광역시", "도"];
function normalize(value: string): string {
  let v = value.trim().replace(/,$/, "");
  for (const suffix of REGION_SUFFIXES) {
    if (v.length > suffix.length && v.endsWith(suffix)) {
      v = v.slice(0, -suffix.length);
      break;
    }
  }
  return v;
}

type Verdict = "개선" | "동일" | "악화" | "판정불가";

/**
 * Applies the brief's 4-way rule set. The 4 conditions as literally written
 * don't cover every (current, next) pair — e.g. current=null, next="06628"
 * (broken non-null) matches none of them: it isn't 개선 (next is still
 * broken), isn't 악화 (current wasn't "정상"), isn't 동일 (values differ),
 * isn't 판정불가 (current is null but next isn't). The same gap exists for
 * "both broken but different garbage strings" and "both valid but
 * disagreeing" (e.g. a 111m grid cell straddling an administrative border).
 * All of these fall through to 동일 here: none of them represents a quality
 * *regression* (that requires current to have been usable) or a confirmed
 * *fix* (that requires current to have been broken and next not), so
 * bucketing them with "no verdict-worthy change" is closer to the truth than
 * forcing them into 개선/악화 or inventing a 5th category outside the brief's
 * four asked-for tallies.
 */
function classify(
  current: string | null,
  next: string | null,
  broken: (value: string | null) => boolean
): Verdict {
  if (current === null && next === null) return "판정불가";
  if (current !== null && next !== null && normalize(current) === normalize(next)) return "동일";

  const brokenCurrent = broken(current);
  const brokenNext = broken(next);
  if (brokenCurrent && !brokenNext) return "개선";
  if (!brokenCurrent && (next === null || brokenNext)) return "악화";
  return "동일";
}

// ============ Sampling ============

interface SampleRow {
  latKey: number;
  lonKey: number;
  provider: string;
}

interface ProviderAllocation {
  provider: string;
  available: number;
  k: number;
}

/**
 * Largest-remainder method: floor each provider's exact proportional share,
 * then hand out the leftover seats (a straight percentage split rarely sums
 * to exactly `effectiveLimit`) to whichever providers' floor() dropped the
 * most, so per-provider counts sum to exactly `effectiveLimit`.
 */
function allocateProportional(
  counts: { provider: string; n: number }[],
  limit: number
): ProviderAllocation[] {
  const totalAvailable = counts.reduce((sum, c) => sum + c.n, 0);
  const effectiveLimit = Math.min(limit, totalAvailable);
  if (effectiveLimit <= 0) return [];

  const allocation: ProviderAllocation[] = counts.map((c) => {
    const exact = (c.n / totalAvailable) * effectiveLimit;
    return { provider: c.provider, available: c.n, k: Math.floor(exact) };
  });

  const remainders = counts.map((c, i) => {
    const exact = (c.n / totalAvailable) * effectiveLimit;
    return { i, remainder: exact - allocation[i].k };
  });
  remainders.sort((a, b) => b.remainder - a.remainder);

  let short = effectiveLimit - allocation.reduce((sum, a) => sum + a.k, 0);
  for (const { i } of remainders) {
    if (short <= 0) break;
    if (allocation[i].k < allocation[i].available) {
      allocation[i].k += 1;
      short -= 1;
    }
  }

  return allocation;
}

async function sampleFromPlaceCache(db: Database, limit: number): Promise<SampleRow[]> {
  const counts = await db
    .select({ provider: placeCache.provider, n: count() })
    .from(placeCache)
    .groupBy(placeCache.provider);

  if (counts.length === 0) return [];

  const allocation = allocateProportional(counts, limit);
  console.log(
    `Sampling ${allocation.reduce((s, a) => s + a.k, 0)} of ${allocation.reduce((s, a) => s + a.available, 0)} place_cache rows: ${allocation.map((a) => `${a.provider}=${a.k}/${a.available}`).join(", ")}`
  );

  const samples: SampleRow[] = [];
  for (const { provider, k } of allocation) {
    if (k <= 0) continue;
    const picked = await db
      .select({
        latKey: placeCache.latKey,
        lonKey: placeCache.lonKey,
        provider: placeCache.provider,
      })
      .from(placeCache)
      .where(eq(placeCache.provider, provider))
      .orderBy(sql`random()`)
      .limit(k);
    samples.push(...picked);
  }
  return samples;
}

// ============ Current visits.city / visits.country_name lookup ============

/**
 * Replicates the private 3-decimal roundCoord() inside visit-persister.ts —
 * see the file header comment for why src/lib/geo's roundCoord (6 decimals)
 * is the wrong function here.
 */
function roundCoord3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface CurrentVisitInfo {
  city: string | null;
  countryName: string | null;
  calculatedAt: Date;
}

/** Loads every visit's rounded coordinate key once; place_cache is user-less and small enough to hold in memory (2215 visits at time of writing). */
async function loadCurrentVisitIndex(db: Database): Promise<Map<string, CurrentVisitInfo>> {
  const rows = await db
    .select({
      centerLat: visits.centerLat,
      centerLon: visits.centerLon,
      city: visits.city,
      countryName: visits.countryName,
      calculatedAt: visits.calculatedAt,
    })
    .from(visits);

  const index = new Map<string, CurrentVisitInfo>();
  for (const row of rows) {
    const key = `${roundCoord3(row.centerLat)}:${roundCoord3(row.centerLon)}`;
    const existing = index.get(key);
    if (!existing || row.calculatedAt > existing.calculatedAt) {
      index.set(key, {
        city: row.city,
        countryName: row.countryName,
        calculatedAt: row.calculatedAt,
      });
    }
  }
  return index;
}

// ============ Google "without result_type restriction" probe (spec §7) ============

interface GoogleAddressComponent {
  long_name: string;
  types: string[];
}

function pickCountryComponent(components: GoogleAddressComponent[] | undefined): string | null {
  if (!components) return null;
  return components.find((c) => c.types.includes("country"))?.long_name ?? null;
}

interface GoogleUnrestrictedResult {
  empty: boolean;
  country: string | null;
}

/**
 * Same coordinate, same Geocoding API, but WITHOUT google.ts's
 * `result_type=street_address|premise` filter — measures how often that
 * filter is the reason a Google coordinate comes back empty, and what
 * country the unfiltered response resolves to when it isn't. This is spec
 * §7's evidence, not something the adapter itself does.
 */
async function fetchGoogleUnrestricted(
  lat: number,
  lon: number,
  apiKey: string
): Promise<GoogleUnrestrictedResult> {
  try {
    const url = `${GOOGLE_GEOCODE_API_BASE}?latlng=${lat},${lon}&key=${apiKey}&language=en`;
    const res = await fetch(url);
    if (!res.ok) return { empty: true, country: null };

    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return { empty: true, country: null };

    return { empty: false, country: pickCountryComponent(result.address_components) };
  } catch {
    return { empty: true, country: null };
  }
}

// ============ Per-coordinate comparison ============

interface ComparisonRow {
  latKey: number;
  lonKey: number;
  provider: string;
  inKorea: boolean;
  currentCity: string | null;
  currentCountry: string | null;
  newRegion: string | null;
  newCountry: string | null;
  verdict: Verdict;
  googleUnrestricted?: GoogleUnrestrictedResult;
}

async function compareOne(
  sample: SampleRow,
  visitIndex: Map<string, CurrentVisitInfo>,
  googleApiKey: string | undefined
): Promise<ComparisonRow> {
  const { latKey, lonKey, provider } = sample;
  const inKorea = isInKorea(latKey, lonKey);
  const current = visitIndex.get(`${latKey}:${lonKey}`);

  let result: GeocodingResult | null = null;
  try {
    const adapter = getGeocodingAdapter(latKey, lonKey);
    result = await adapter.reverseGeocode(latKey, lonKey);
  } catch (e) {
    console.error(`reverseGeocode(${latKey}, ${lonKey}) failed:`, e);
  }

  const newRegion = result?.region ?? null;
  const newCountry = result?.country ?? null;
  const currentCity = current?.city ?? null;
  const currentCountry = current?.countryName ?? null;

  const verdict = inKorea
    ? classify(currentCity, newRegion, (v) => looksBroken(v, true))
    : classify(currentCountry, newCountry, looksBrokenCountry);

  let googleUnrestricted: GoogleUnrestrictedResult | undefined;
  if (provider === "google" && googleApiKey) {
    googleUnrestricted = await fetchGoogleUnrestricted(latKey, lonKey, googleApiKey);
  }

  return {
    latKey,
    lonKey,
    provider,
    inKorea,
    currentCity,
    currentCountry,
    newRegion,
    newCountry,
    verdict,
    googleUnrestricted,
  };
}

/** Concurrency-capped map, chunked like visit-persister.ts's own geocoding loop (CONCURRENCY = 5). */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(worker))));
  }
  return results;
}

// ============ Reporting ============

function printRows(rows: ComparisonRow[]) {
  console.log(
    [
      "lat",
      "lon",
      "provider",
      "inKorea",
      "currentCity",
      "currentCountry",
      "newRegion",
      "newCountry",
      "verdict",
    ].join("\t")
  );
  for (const r of rows) {
    console.log(
      [
        r.latKey,
        r.lonKey,
        r.provider,
        r.inKorea,
        r.currentCity ?? "",
        r.currentCountry ?? "",
        r.newRegion ?? "",
        r.newCountry ?? "",
        r.verdict,
      ].join("\t")
    );
  }
}

function printTally(rows: ComparisonRow[]) {
  const tally: Record<Verdict, number> = { 개선: 0, 동일: 0, 악화: 0, 판정불가: 0 };
  for (const r of rows) tally[r.verdict] += 1;

  console.log("\nTally:");
  for (const verdict of ["개선", "동일", "악화", "판정불가"] as const) {
    console.log(`  ${verdict}: ${tally[verdict]}`);
  }
}

function printGoogleUnrestrictedSummary(rows: ComparisonRow[]) {
  const googleRows = rows.filter(
    (r): r is ComparisonRow & { googleUnrestricted: GoogleUnrestrictedResult } =>
      r.googleUnrestricted !== undefined
  );
  if (googleRows.length === 0) return;

  const emptyCount = googleRows.filter((r) => r.googleUnrestricted.empty).length;
  const countryBreakdown = new Map<string, number>();
  for (const r of googleRows) {
    if (!r.googleUnrestricted.empty && r.googleUnrestricted.country) {
      const key = r.googleUnrestricted.country;
      countryBreakdown.set(key, (countryBreakdown.get(key) ?? 0) + 1);
    }
  }

  console.log(
    `\nGoogle unrestricted geocode (result_type filter removed), n=${googleRows.length}:`
  );
  console.log(
    `  empty results: ${emptyCount} (${((emptyCount / googleRows.length) * 100).toFixed(1)}%)`
  );
  console.log("  non-empty country breakdown:");
  for (const [country, n] of [...countryBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${country}: ${n}`);
  }
}

// ============ Main ============

async function main() {
  const parsed = parseArgs(argv.slice(2));
  if ("error" in parsed) usageAndExit(parsed.error);
  const { limit } = parsed;

  const missingEnv = ["KAKAO_REST_API_KEY", "GOOGLE_MAPS_API_KEY"].filter(
    (key) => !process.env[key]
  );
  if (missingEnv.length > 0) {
    usageAndExit(
      `Missing required environment variable(s): ${missingEnv.join(", ")}. These live in ` +
        `.env (not .env.local) — see the geocoding adapters' own constructor checks. A run ` +
        `without them would silently geocode nothing and produce an all-null comparison ` +
        `that looks like a catastrophic regression.`
    );
  }

  const db = getDb();
  try {
    const samples = await sampleFromPlaceCache(db, limit);
    if (samples.length === 0) {
      console.log("place_cache has no rows to sample — nothing to compare.");
      return;
    }

    const visitIndex = await loadCurrentVisitIndex(db);
    console.log(
      `Loaded ${visitIndex.size} distinct visit coordinate(s) for the current-value join.\n`
    );

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    const rows = await mapWithConcurrency(samples, CONCURRENCY, (sample) =>
      compareOne(sample, visitIndex, googleApiKey)
    );

    printRows(rows);
    printTally(rows);
    printGoogleUnrestrictedSummary(rows);
  } finally {
    await getPool().end();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await getPool().end();
  } catch {}
  exit(1);
});
