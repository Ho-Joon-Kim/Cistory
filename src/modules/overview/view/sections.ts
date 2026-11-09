/**
 * The modules under the flow chart: 이동과 장소, 자산 and the 자세히 tabs
 * (저장소 · 지출 분류 · 이동 수단 · 시간대 · 심박).
 */
import { type Fact, hasBatchim, iGa, pickOne } from "@/lib/facts";
import { formatCount, formatMonthDay, formatReturn, formatWonCompact } from "@/lib/format";
import { distanceM } from "@/lib/geo";
import type { OverviewHistoryResponse } from "../history";
import type {
  CodingAggregate,
  HealthAggregate,
  LocationAggregate,
  PortfolioAggregate,
  SpendingAggregate,
} from "../types";
import { type PeriodContext, seriesTitle } from "./labels";
import { metricByDay, pct, sentenceFact } from "./series";

// ── shared formatting ────────────────────────────────────────────────────────

export function formatHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${formatCount(h)}시간`;
  if (h >= 1) return `${(Math.round(h * 10) / 10).toFixed(1)}시간`;
  return `${Math.round(seconds / 60)}분`;
}

export function formatKm(meters: number): string {
  const km = meters / 1000;
  return km >= 100 ? formatCount(km) : (Math.round(km * 10) / 10).toLocaleString("ko-KR");
}

// ── 이동과 장소 ───────────────────────────────────────────────────────────────

const REGION_SUFFIXES = ["통합특별시", "특별자치도", "특별자치시", "광역시", "특별시"];

/** "전북특별자치도" → "전북", "대전광역시" → "대전" (longest suffix first). */
export function shortRegion(name: string): string {
  for (const suffix of REGION_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) return name.slice(0, -suffix.length);
  }
  return name;
}

export interface PlaceRow {
  key: string;
  name: string;
  /** Name for narrow screens ("대전 · 12곳"). */
  shortName: string;
  seconds: number;
  visits: number;
  /** 0..1 of the top row. */
  share: number;
  flag: string | null;
  members: { name: string; seconds: number; flag: string | null }[] | null;
}

export interface MoveModel {
  stats: { label: string; value: string; unit: string }[];
  fact: Fact | null;
  places: PlaceRow[];
}

type Place = LocationAggregate["derived"]["visits"]["places"][number];

/** Places this far from home count as "away" and are grouped by area. */
const AWAY_METERS = 40_000;
const CLUSTER_METERS = 25_000;
const HOME_NAMES = ["집", "회사"];

/**
 * Groups away-from-home places into areas (single-linkage within 25 km) and
 * names each area after the nearest visited region. Home-area places stay
 * individual rows — they are what the list is about.
 */
export function groupPlaces(location: LocationAggregate["derived"]): {
  name: string;
  places: Place[];
}[] {
  const places = location.visits.places;
  const home = places.find((p) => p.placeName === "집") ?? places[0];
  if (!home) return [];
  const away = places.filter(
    (p) => distanceM(home.centerLat, home.centerLon, p.centerLat, p.centerLon) > AWAY_METERS
  );
  const clusters: Place[][] = [];
  for (const place of away) {
    const near = clusters.filter((c) =>
      c.some(
        (q) =>
          distanceM(q.centerLat, q.centerLon, place.centerLat, place.centerLon) <= CLUSTER_METERS
      )
    );
    if (near.length === 0) clusters.push([place]);
    else {
      const merged = [...near.flat(), place];
      for (const c of near) clusters.splice(clusters.indexOf(c), 1);
      clusters.push(merged);
    }
  }
  const grouped = new Set(clusters.filter((c) => c.length >= 2).flat());
  const result: { name: string; places: Place[] }[] = places
    .filter((p) => !grouped.has(p))
    .map((p) => ({ name: p.placeName, places: [p] }));
  for (const cluster of clusters.filter((c) => c.length >= 2)) {
    const lat = cluster.reduce((s, p) => s + p.centerLat, 0) / cluster.length;
    const lon = cluster.reduce((s, p) => s + p.centerLon, 0) / cluster.length;
    const region = location.visitedRegions
      .map((r) => ({ r, d: distanceM(lat, lon, r.centerLat, r.centerLon) }))
      .sort((a, b) => a.d - b.d)[0];
    const sorted = [...cluster].sort((a, b) => b.durationSeconds - a.durationSeconds);
    result.push({
      name: region && region.d <= AWAY_METERS ? shortRegion(region.r.city) : sorted[0].placeName,
      places: sorted,
    });
  }
  return result;
}

export function buildMove(
  ctx: PeriodContext,
  location: LocationAggregate | null
): MoveModel | null {
  if (!location) return null;
  const d = location.derived;
  const productivity = new Map(d.placeProductivity.map((p) => [p.placeName, p.commitCount]));
  const workFlag = (name: string) => {
    const c = productivity.get(name) ?? 0;
    return c > 0 && !HOME_NAMES.includes(name) ? `작업 ${formatCount(c)}커밋` : null;
  };
  const groups = groupPlaces(d)
    .map((g) => ({
      ...g,
      seconds: g.places.reduce((s, p) => s + p.durationSeconds, 0),
      visits: g.places.reduce((s, p) => s + p.visitCount, 0),
    }))
    .sort((a, b) => b.seconds - a.seconds);
  const top = groups.slice(0, 5);
  const max = Math.max(1, top[0]?.seconds ?? 1);
  const places: PlaceRow[] = top.map((g) => {
    const isGroup = g.places.length > 1;
    const flagged = isGroup ? g.places.find((p) => workFlag(p.placeName)) : g.places[0];
    return {
      key: g.name,
      name: isGroup ? `${g.name} · ${g.places[0].placeName} 외 ${g.places.length - 1}곳` : g.name,
      shortName: isGroup ? `${g.name} · ${g.places.length}곳` : g.name,
      seconds: g.seconds,
      visits: g.visits,
      share: g.seconds / max,
      flag: flagged ? workFlag(flagged.placeName) : null,
      members: isGroup
        ? g.places.map((p) => ({
            name: p.placeName,
            seconds: p.durationSeconds,
            flag: workFlag(p.placeName),
          }))
        : null,
    };
  });

  let fact: Fact | null = null;
  const total = d.visits.durationSeconds;
  const homeSeconds = d.visits.places
    .filter((p) => HOME_NAMES.includes(p.placeName))
    .reduce((s, p) => s + p.durationSeconds, 0);
  const elsewhere = groups.find((g) => !HOME_NAMES.includes(g.name));
  if (total > 0 && homeSeconds > 0 && elsewhere) {
    const share = homeSeconds / total;
    fact = sentenceFact({
      id: "overview.places.home",
      metric: "stay",
      metricLabel: "머문 시간",
      ctx,
      value: share,
      unit: "percent",
      score: 0.6,
      evidence: { kind: "keys", keys: [elsewhere.name] },
      template: "머문 시간의 {fact}가 집·회사 — 그 밖에선 {place}({hours})에 가장 오래 있었어요.",
      trigger: pct(share),
      detail: { place: elsewhere.name, hours: formatHours(elsewhere.seconds) },
      rows: [
        ...d.visits.places
          .filter((p) => HOME_NAMES.includes(p.placeName))
          .map((p) => ({ label: p.placeName, value: formatHours(p.durationSeconds) })),
        { label: "전체 체류", value: formatHours(total) },
        {
          label:
            elsewhere.places.length > 1
              ? `${elsewhere.name} ${elsewhere.places.length}곳`
              : elsewhere.name,
          value: formatHours(elsewhere.seconds),
        },
      ],
    });
  }
  const firstRegion = d.visitedRegions.find(
    (r) => r.isFirstVisit && r.firstVisitDate >= ctx.from && r.firstVisitDate <= ctx.to
  );
  if (firstRegion) {
    fact = sentenceFact({
      id: "overview.places.firstRegion",
      metric: "region",
      metricLabel: "지역",
      ctx,
      value: 1,
      score: 0.8,
      evidence: { kind: "keys", keys: [firstRegion.city] },
      template: `{region}${hasBatchim(shortRegion(firstRegion.city)) ? "은" : "는"} {day} {fact}이에요.`,
      trigger: "첫 방문",
      detail: {
        region: shortRegion(firstRegion.city),
        day: formatMonthDay(firstRegion.firstVisitDate, { now: ctx.now }),
      },
      rows: [
        {
          label: "첫 방문",
          value: `${shortRegion(firstRegion.city)} · ${formatMonthDay(firstRegion.firstVisitDate, { now: ctx.now })}`,
        },
        { label: "이동 거리", value: `${formatKm(d.tracks.distanceMeters)}km` },
      ],
    });
  }

  return {
    stats: [
      { label: "이동 거리", value: formatKm(d.tracks.distanceMeters), unit: "km" },
      { label: "이동", value: formatCount(d.tracks.count), unit: "회" },
      { label: "방문", value: formatCount(d.visits.count), unit: "회" },
      { label: "장소", value: formatCount(d.visits.uniquePlaceCount), unit: "곳" },
    ],
    fact,
    places,
  };
}

// ── 자산 ─────────────────────────────────────────────────────────────────────

export interface AssetModel {
  twr: number | null;
  days: number;
  points: { date: string; value: number }[];
  /** Point the AI line talks about (trough or peak). */
  mark: string | null;
  fact: Fact | null;
}

export function buildAsset(
  ctx: PeriodContext,
  portfolio: PortfolioAggregate | null
): AssetModel | null {
  if (!portfolio?.hasAccounts || portfolio.evaluationTrend.length < 2) return null;
  const points = portfolio.evaluationTrend;
  const last = points[points.length - 1];
  let low = points[0];
  let high = points[0];
  for (const p of points) {
    if (p.value < low.value) low = p;
    if (p.value > high.value) high = p;
  }
  const recovery = last.value / low.value - 1;
  const drawdown = 1 - last.value / high.value;
  const day = (d: string) => formatMonthDay(d, { now: ctx.now });
  const candidates: (Fact | null)[] = [];
  if (low.date !== last.date && recovery >= 0.01) {
    candidates.push(
      sentenceFact({
        id: "overview.asset.recovery",
        metric: "evaluation",
        metricLabel: "평가액",
        ctx,
        value: recovery,
        unit: "percent",
        score: Math.min(1, 0.4 + recovery * 10),
        evidence: { kind: "keys", keys: [low.date] },
        template: `{day} 저점 {low}에서 ${ctx.inProgress ? "지금" : ctx.endWord}까지 {fact} 회복했어요.`,
        trigger: `${(Math.round(recovery * 1000) / 10).toFixed(1)}%`,
        detail: { day: day(low.date), low: formatWonCompact(low.value) },
        rows: [
          { label: `${day(points[0].date)} 평가액`, value: formatWonCompact(points[0].value) },
          { label: `저점 ${day(low.date)}`, value: formatWonCompact(low.value) },
          { label: day(last.date), value: formatWonCompact(last.value) },
          ...(portfolio.twr.totalReturn !== null
            ? [
                {
                  label: `TWR (${portfolio.twr.days}일)`,
                  value: formatReturn(portfolio.twr.totalReturn),
                },
              ]
            : []),
        ],
      })
    );
  }
  // A recovery off the trough is the story when there is one; the drawdown otherwise.
  if (high.date !== last.date && drawdown >= 0.02 && candidates.length === 0) {
    candidates.push(
      sentenceFact({
        id: "overview.asset.drawdown",
        metric: "evaluation",
        metricLabel: "평가액",
        ctx,
        value: drawdown,
        unit: "percent",
        score: Math.min(1, 0.4 + drawdown * 8),
        evidence: { kind: "keys", keys: [high.date] },
        template: "{day} 고점 {high}보다 {fact} 낮아요.",
        trigger: `${(Math.round(drawdown * 1000) / 10).toFixed(1)}%`,
        detail: { day: day(high.date), high: formatWonCompact(high.value) },
        rows: [
          { label: `고점 ${day(high.date)}`, value: formatWonCompact(high.value) },
          { label: `최근 ${day(last.date)}`, value: formatWonCompact(last.value) },
        ],
      })
    );
  }
  const fact = pickOne(candidates, 0.4);
  return {
    twr: portfolio.twr.totalReturn,
    days: portfolio.twr.days,
    points,
    mark: fact?.evidence?.kind === "keys" ? fact.evidence.keys[0] : null,
    fact,
  };
}

// ── 자세히 ───────────────────────────────────────────────────────────────────

export interface DetailRow {
  key: string;
  name: string;
  sub?: string;
  value: string;
  share: number;
  pct?: string;
  flag?: string | null;
  flagTone?: "place" | "warn";
  current?: boolean;
  members?: { name: string; value: string }[] | null;
}

export type DetailTabId = "repo" | "category" | "mode" | "hour" | "heart";

export interface DetailTab {
  id: DetailTabId;
  label: string;
  hint: string;
  fact: Fact | null;
  rows: DetailRow[];
  hours?: { hour: number; value: number; ratio: number; night: boolean }[];
  weekdays?: { label: string; value: number; ratio: number }[];
}

const CATEGORY_LABELS: Record<string, string> = {
  food: "식비",
  cafe: "카페",
  transport: "교통",
  shopping: "쇼핑",
  housing: "주거·생활",
  subscription: "구독",
  health: "의료·건강",
  leisure: "문화·여가",
  education: "교육",
  gift: "경조·선물",
  finance: "금융",
  travel: "여행·숙박",
  other: "기타",
  uncategorized: "미분류",
};

const MODE_LABELS: Record<string, string> = {
  bus: "버스",
  train: "기차",
  running: "달리기",
  unknown: "미분류",
  cycling: "자전거",
  driving: "자동차",
  subway: "지하철",
  walking: "걷기",
  motorcycle: "오토바이",
  flying: "비행기",
  stationary: "정지",
};

function repoTab(ctx: PeriodContext, coding: CodingAggregate | null): DetailTab | null {
  const projects = (coding?.projects ?? []).filter((p) => p.commits > 0);
  if (projects.length === 0) return null;
  const total = projects.reduce((s, p) => s + p.commits, 0);
  const [top, ...rest] = projects;
  const byOwner = new Map<string, typeof projects>();
  for (const p of rest) {
    const owner = p.name.split("/")[0];
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), p]);
  }
  type Item = { name: string; sub?: string; commits: number; members: typeof projects | null };
  const split = (full: string) => {
    const [owner, repo] = full.includes("/") ? full.split("/") : ["", full];
    return { owner, repo };
  };
  const items: Item[] = [
    { name: split(top.name).repo, sub: split(top.name).owner, commits: top.commits, members: null },
  ];
  const grouped: string[] = [];
  for (const [owner, list] of byOwner) {
    if (list.length >= 3) {
      grouped.push(owner);
      items.push({
        name: `${owner} · 저장소 ${list.length}개`,
        commits: list.reduce((s, p) => s + p.commits, 0),
        members: list,
      });
    } else {
      for (const p of list)
        items.push({
          name: split(p.name).repo,
          sub: split(p.name).owner,
          commits: p.commits,
          members: null,
        });
    }
  }
  items.sort((a, b) => b.commits - a.commits);
  const share = top.commits / total;
  const topName = split(top.name).repo;
  const fact =
    projects.length > 1
      ? sentenceFact({
          id: "overview.repo.top",
          metric: "commits",
          metricLabel: "커밋",
          ctx,
          value: share,
          unit: "percent",
          score: share >= 0.5 ? 0.7 : 0.45,
          evidence: { kind: "keys", keys: [topName] },
          template:
            share >= 0.85
              ? `{repo}${iGa(topName)} {fact} — 사실상 한 프로젝트의 ${ctx.unitNoun}${ctx.unitNoun === "달" ? "이었어요" : "였어요"}.{grouped}`
              : `{repo}${iGa(topName)} {fact}로 가장 커요.{grouped}`,
          trigger: pct(share),
          detail: {
            repo: topName,
            grouped: grouped.length ? ` 작은 저장소는 ${grouped.join("·")} 단위로 묶었어요.` : "",
          },
          rows: [
            { label: top.name, value: formatCount(top.commits) },
            { label: `나머지 ${projects.length - 1}개`, value: formatCount(total - top.commits) },
          ],
        })
      : null;
  return {
    id: "repo",
    label: "저장소",
    hint: `${projects.length}개`,
    fact,
    rows: items.map((it) => ({
      key: it.name,
      name: it.name,
      sub: it.sub,
      value: formatCount(it.commits),
      share: it.commits / items[0].commits,
      pct: pct(it.commits / total),
      members:
        it.members?.map((m) => ({ name: split(m.name).repo, value: formatCount(m.commits) })) ??
        null,
    })),
  };
}

function categoryTab(ctx: PeriodContext, spending: SpendingAggregate | null): DetailTab | null {
  const cats = (spending?.categories ?? []).filter((c) => c.spending > 0);
  if (cats.length === 0) return null;
  const total = cats.reduce((s, c) => s + c.spending, 0);
  const [top, second] = cats;
  const share = top.spending / total;
  const label = (c: string) => CATEGORY_LABELS[c] ?? c;
  const fact =
    second && share >= 0.3
      ? sentenceFact({
          id: "overview.category.top",
          metric: "spending",
          metricLabel: "지출",
          ctx,
          value: share,
          unit: "percent",
          score: Math.min(1, share * (1 - second.spending / top.spending) * 1.6),
          evidence: { kind: "keys", keys: [top.category] },
          template: `${label(top.category)}${iGa(label(top.category))} 지출의 {fact} — 이를 빼면 지출은 {rest}.`,
          trigger: pct(share),
          detail: { rest: formatWonCompact(total - top.spending) },
          rows: [
            { label: label(top.category), value: formatWonCompact(top.spending) },
            { label: `${ctx.label} 지출`, value: formatWonCompact(total) },
            { label: `그다음 ${label(second.category)}`, value: formatWonCompact(second.spending) },
          ],
        })
      : null;
  return {
    id: "category",
    label: "지출 분류",
    hint: `${cats.length}개`,
    fact,
    rows: cats.map((c) => ({
      key: c.category,
      name: label(c.category),
      value: formatWonCompact(c.spending),
      share: c.spending / top.spending,
      pct: pct(c.spending / total),
    })),
  };
}

function modeTab(
  ctx: PeriodContext,
  location: LocationAggregate | null,
  health: HealthAggregate | null
): DetailTab | null {
  const modes = (location?.derived.transportModes ?? []).filter((m) => m.distanceMeters > 0);
  if (modes.length === 0) return null;
  const total = modes.reduce((s, m) => s + m.distanceMeters, 0);
  const sorted = [...modes].sort((a, b) => b.distanceMeters - a.distanceMeters);
  const stepTotal = [...metricByDay(health, "steps").values()].reduce((s, v) => s + v, 0);
  const running = modes.find((m) => m.mode === "running");
  let suspect: string | null = null;
  let fact: Fact | null = null;
  // ~1,300 steps per km even at a run; far fewer steps than the run distance means
  // the segments were mislabelled (cycling/scooter read as running).
  if (running && running.distanceMeters >= 5_000 && stepTotal > 0) {
    const perKm = stepTotal / (running.distanceMeters / 1000);
    if (perKm < 600) {
      suspect = "running";
      fact = sentenceFact({
        id: "overview.mode.running",
        metric: "steps",
        metricLabel: "걸음",
        ctx,
        value: perKm,
        unit: "steps",
        score: 0.75,
        evidence: { kind: "keys", keys: ["running"] },
        template: `달리기 {km}km는 오분류로 보여요 — ${ctx.label} 걸음을 전부 달리기에 써도 1km에 {fact}뿐이에요.`,
        trigger: `${formatCount(perKm)}보`,
        detail: { km: formatKm(running.distanceMeters) },
        rows: [
          {
            label: "달리기로 분류",
            value: `${running.segmentCount}구간 · ${formatKm(running.distanceMeters)}km`,
          },
          { label: "같은 기간 걸음", value: `${formatCount(stepTotal)}보` },
          { label: "1km당 걸음", value: `${formatCount(perKm)}보` },
        ],
      });
    }
  }
  const subway = location?.derived.subway;
  return {
    id: "mode",
    label: "이동 수단",
    hint: `${modes.length}가지`,
    fact,
    rows: sorted.map((m) => ({
      key: m.mode,
      name: MODE_LABELS[m.mode] ?? m.mode,
      sub: `${m.segmentCount}구간${m.mode === "subway" && subway?.tripCount ? ` · ${subway.tripCount}회 탑승` : ""}`,
      value: `${formatKm(m.distanceMeters)}km`,
      share: m.distanceMeters / sorted[0].distanceMeters,
      pct: pct(m.distanceMeters / total),
      flag: m.mode === suspect ? "오분류 의심" : null,
      flagTone: "warn",
    })),
  };
}

function hourTab(ctx: PeriodContext, coding: CodingAggregate | null): DetailTab | null {
  const hours = coding?.weekdayHour?.hours ?? [];
  const weekdays = coding?.weekdayHour?.weekdays ?? [];
  const total = hours.reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  const hmax = Math.max(1, ...hours);
  const wmax = Math.max(1, ...weekdays);
  const night = hours.slice(0, 4).reduce((s, v) => s + v, 0);
  const morning = hours.slice(10, 14).reduce((s, v) => s + v, 0);
  const nightShare = night / total;
  const fact =
    nightShare >= 0.15
      ? sentenceFact({
          id: "overview.hour.night",
          metric: "commits",
          metricLabel: "커밋",
          ctx,
          value: nightShare,
          unit: "percent",
          score: 0.5 + Math.min(0.4, nightShare),
          template:
            night >= morning
              ? "새벽 0–3시 커밋이 {fact}로 오전 10–13시({morning})보다 많아요."
              : "새벽 0–3시 커밋이 {fact} — 오전 10–13시({morning})에 버금가요.",
          trigger: pct(nightShare),
          detail: { morning: pct(morning / total) },
          rows: [
            { label: "0–3시", value: formatCount(night) },
            { label: "10–13시", value: formatCount(morning) },
            { label: "전체", value: formatCount(total) },
          ],
        })
      : null;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  return {
    id: "hour",
    label: "시간대",
    hint: "",
    fact,
    rows: [],
    hours: hours.map((v, hour) => ({ hour, value: v, ratio: v / hmax, night: hour <= 3 })),
    weekdays:
      weekdays.length === 7
        ? order.map((i) => ({ label: names[i], value: weekdays[i], ratio: weekdays[i] / wmax }))
        : [],
  };
}

function heartTab(
  ctx: PeriodContext,
  health: HealthAggregate | null,
  history: OverviewHistoryResponse | null
): DetailTab | null {
  const fmt = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}bpm`;
  let rows: DetailRow[];
  if (ctx.periodType === "week") {
    rows = [...metricByDay(health, "heart_rate")].map(([date, v]) => ({
      key: date,
      name: formatMonthDay(date, { now: ctx.now }),
      value: fmt(v),
      share: v / 100,
    }));
  } else {
    rows = (history?.series ?? [])
      .filter((p) => p.heartRate !== null)
      .map((p) => ({
        key: p.periodKey,
        name: `${seriesTitle(p, ctx.now)}${p.inProgress ? " (진행 중)" : ""}`,
        value: fmt(p.heartRate ?? 0),
        share: (p.heartRate ?? 0) / 100,
        current: p.periodKey === ctx.periodKey,
      }));
  }
  if (rows.length === 0) return null;
  return { id: "heart", label: "심박", hint: "", fact: null, rows };
}

export function buildDetails(input: {
  ctx: PeriodContext;
  coding: CodingAggregate | null;
  spending: SpendingAggregate | null;
  health: HealthAggregate | null;
  location: LocationAggregate | null;
  history: OverviewHistoryResponse | null;
}): DetailTab[] {
  const { ctx, coding, spending, health, location, history } = input;
  return [
    repoTab(ctx, coding),
    categoryTab(ctx, spending),
    modeTab(ctx, location, health),
    hourTab(ctx, coding),
    heartTab(ctx, health, history),
  ].filter((t): t is DetailTab => t !== null);
}
