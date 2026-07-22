import type { OverviewSnapshotResponse } from "./service";

export function currentKstYear(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(now);
}

function canonicalYear(value: string | null, currentYear: string) {
  return value && /^\d{4}$/.test(value) && value <= currentYear ? value : null;
}

export function resolveComparisonYears(
  rawYear1: string | null,
  rawYear2: string | null,
  now: Date = new Date()
) {
  const currentYear = currentKstYear(now);
  const year2 = canonicalYear(rawYear2, currentYear) ?? currentYear;
  const year1 = canonicalYear(rawYear1, currentYear) ?? String(Number(year2) - 1);
  if (year1 >= year2) return { year1: String(Number(year2) - 1), year2 };
  return { year1, year2 };
}

export async function loadComparisonSnapshots(
  year1: string,
  year2: string,
  getSnapshot: (year: string) => Promise<OverviewSnapshotResponse>
) {
  return Promise.all([getSnapshot(year1), getSnapshot(year2)]);
}

type SnapshotRequest = (
  input: string,
  init: { signal: AbortSignal }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchStoredOverviewSnapshot(
  year: string,
  signal: AbortSignal,
  request: SnapshotRequest = fetch
) {
  const params = new URLSearchParams({ periodType: "year", periodKey: year });
  const response = await request(`/api/overview?${params.toString()}`, { signal });
  const body = (await response.json()) as OverviewSnapshotResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "연간 스냅샷을 불러오지 못했습니다.");
  return body;
}

export function loadStoredOverviewComparison(
  year1: string,
  year2: string,
  signal: AbortSignal,
  request: SnapshotRequest = fetch
) {
  return loadComparisonSnapshots(year1, year2, (year) =>
    fetchStoredOverviewSnapshot(year, signal, request)
  );
}

export interface OverviewComparisonMetric {
  key: string;
  label: string;
  first: number;
  second: number;
  delta: number;
  format: "number" | "duration" | "distance" | "currency" | "percent";
}

function readyDomains(snapshot: OverviewSnapshotResponse) {
  return snapshot.status === "ready" || snapshot.status === "failed" ? snapshot.domains : null;
}

export function buildOverviewComparison(
  first: OverviewSnapshotResponse,
  second: OverviewSnapshotResponse
) {
  const firstDomains = readyDomains(first);
  const secondDomains = readyDomains(second);
  const metrics: OverviewComparisonMetric[] = [];
  const add = (
    key: string,
    label: string,
    firstValue: number | null | undefined,
    secondValue: number | null | undefined,
    format: OverviewComparisonMetric["format"]
  ) => {
    if (firstValue == null || secondValue == null) return;
    metrics.push({
      key,
      label,
      first: firstValue,
      second: secondValue,
      delta: secondValue - firstValue,
      format,
    });
  };

  add(
    "commits",
    "커밋",
    firstDomains?.coding?.data?.totalCommits,
    secondDomains?.coding?.data?.totalCommits,
    "number"
  );
  add(
    "codingSeconds",
    "코딩 시간",
    firstDomains?.coding?.data?.totalCodingSeconds,
    secondDomains?.coding?.data?.totalCodingSeconds,
    "duration"
  );
  add(
    "distance",
    "이동 거리",
    firstDomains?.location?.data?.derived.tracks.distanceMeters,
    secondDomains?.location?.data?.derived.tracks.distanceMeters,
    "distance"
  );
  add(
    "netSpend",
    "순지출",
    firstDomains?.spending?.data?.netSpend,
    secondDomains?.spending?.data?.netSpend,
    "currency"
  );
  add(
    "twr",
    "TWR",
    firstDomains?.portfolio?.data?.twr.totalReturn,
    secondDomains?.portfolio?.data?.twr.totalReturn,
    "percent"
  );
  return { year1: first.periodKey, year2: second.periodKey, metrics };
}
