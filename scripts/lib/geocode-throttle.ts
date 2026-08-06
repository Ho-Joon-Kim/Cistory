/**
 * Kakao/other-provider throttling and retry, shared by scripts that fire
 * live reverse-geocode requests at volume:
 * scripts/compare-region-extraction.ts (Task 5) and
 * scripts/backfill-visit-regions.ts (Task 6).
 *
 * Extracted during Task 6's coordinator review round 1: the backfill script
 * was about to reinvent flat-concurrency-5 geocoding, which Task 5 already
 * measured as unsafe at this volume — an n=100 comparison run at
 * concurrency 5 produced 35 failures out of 92 live coordinates, purely
 * from Kakao rate limiting, and compare-region-extraction.ts was throttled
 * to Kakao concurrency 1 with 300ms pacing as a result. That fix now lives
 * here once instead of drifting between two copies.
 */

import type { GeocodingAdapter, GeocodingResult } from "../../src/lib/adapters/geocoding";

/**
 * Kakao's `reverseGeocode` costs 7 HTTP requests per coordinate: 1
 * `coord2address` (awaited first) then 6 category searches fired together
 * via `Promise.all` (`CATEGORY_CODES` in `src/lib/adapters/geocoding/kakao.ts`
 * — not exported, so the count is hardcoded here with this citation).
 */
export const KAKAO_REQUESTS_PER_COORDINATE = 7;

/** Caps the peak at 6 concurrent requests from one coordinate's category-search fan-out. */
export const KAKAO_CONCURRENCY = 1;

/** Spreads throughput to roughly 7 requests / ~750ms (~9 req/s), comfortably under typical per-app quotas. */
export const KAKAO_BATCH_PAUSE_MS = 300;

/** Google/Mapbox have a much higher default quota than Kakao — left at the outer cap. */
export const OTHER_CONCURRENCY = 5;

/** A `reverseGeocode` call that returns null or throws gets exactly one retry after this backoff. */
export const RETRY_BACKOFF_MS = 800;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Concurrency-capped map. `pauseMs` (default 0, no pause) sleeps between
 * batches — not after the last one — so throughput can be spread out for a
 * rate-limited provider without slowing down a provider that doesn't need
 * it.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  pauseMs = 0
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(worker))));
    const isLastBatch = i + concurrency >= items.length;
    if (pauseMs > 0 && !isLastBatch) await sleep(pauseMs);
  }
  return results;
}

/**
 * At most one retry after `RETRY_BACKOFF_MS`. A `null` return (no throw) is
 * treated the same as a thrown error — every geocoding adapter returns
 * `null` on both a non-ok HTTP status and an empty result set, so they're
 * indistinguishable without re-probing. Catches internally: callers never
 * see a rejected promise from this function.
 */
export async function reverseGeocodeWithRetry(
  adapter: GeocodingAdapter,
  lat: number,
  lon: number
): Promise<{ result: GeocodingResult | null; failed: boolean }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await adapter.reverseGeocode(lat, lon);
      if (result !== null) return { result, failed: false };
    } catch (e) {
      if (attempt === 2) {
        console.error(`reverseGeocode(${lat}, ${lon}) failed on retry:`, e);
      }
    }
    if (attempt === 1) await sleep(RETRY_BACKOFF_MS);
  }
  return { result: null, failed: true };
}

/**
 * Splits `items` into Kakao-bound vs. other-provider-bound (via `isKakao`),
 * runs the Kakao group at `KAKAO_CONCURRENCY` with `KAKAO_BATCH_PAUSE_MS`
 * pacing and everything else at `OTHER_CONCURRENCY`, both groups in
 * parallel (different providers, so throttling one never waits on the
 * other). Order of the returned array is not meaningful — if a caller needs
 * to correlate results back to inputs, `worker` should return enough of the
 * input to do so.
 */
export async function runThrottledGeocode<T, R>(
  items: T[],
  isKakao: (item: T) => boolean,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const kakaoItems = items.filter(isKakao);
  const otherItems = items.filter((item) => !isKakao(item));

  const [kakaoResults, otherResults] = await Promise.all([
    mapWithConcurrency(kakaoItems, KAKAO_CONCURRENCY, worker, KAKAO_BATCH_PAUSE_MS),
    mapWithConcurrency(otherItems, OTHER_CONCURRENCY, worker),
  ]);

  return [...kakaoResults, ...otherResults];
}

/**
 * Human-readable throttling-plan line, printed by both scripts' run headers
 * so the operator can see what's about to be issued before it fires.
 */
export function describeThrottlingPlan(kakaoCount: number, otherCount: number): string {
  return (
    `Throttling: kakao=${kakaoCount} coordinate(s) @ concurrency ${KAKAO_CONCURRENCY}` +
    ` (~${kakaoCount * KAKAO_REQUESTS_PER_COORDINATE} Kakao HTTP requests` +
    ` [1 coord2address + ${KAKAO_REQUESTS_PER_COORDINATE - 1} category searches per coordinate],` +
    ` ${KAKAO_BATCH_PAUSE_MS}ms pause between coordinates); other=${otherCount}` +
    ` coordinate(s) @ concurrency ${OTHER_CONCURRENCY}.`
  );
}
