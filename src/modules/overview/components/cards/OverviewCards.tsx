"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PeriodDomainEnvelope } from "@/db/schema";
import {
  InsightCard,
  InsightCardEmpty,
} from "@/modules/insights/components/primitives/InsightCard";
import { Pill } from "@/modules/insights/components/primitives/Pill";
import { Stat } from "@/modules/insights/components/primitives/Stat";
import type { PeriodType } from "../../period";
import type { OverviewSnapshotDomains } from "../../service";
import type {
  CodingAggregate,
  HealthAggregate,
  LocationAggregate,
  PortfolioAggregate,
  SpendingAggregate,
} from "../../types";
import { AsOfBadge } from "../AsOfBadge";
import { overviewCardMetadata } from "./model";

const compact = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function cardVisible(id: string, periodType: PeriodType) {
  return overviewCardMetadata.some(
    (card) => card.id === id && card.periods.some((period) => period === periodType)
  );
}

function DomainGroup<T>({
  id,
  title,
  envelope,
  children,
}: {
  id: string;
  title: string;
  envelope: PeriodDomainEnvelope<T> | null;
  children: (data: T) => ReactNode;
}) {
  return (
    <section
      data-overview-slot={id}
      aria-labelledby={`overview-${id}-title`}
      className="scroll-mt-20 space-y-4 focus:outline-none"
      tabIndex={-1}
    >
      <div className="flex items-center gap-3 px-1 pt-2">
        <h2
          id={`overview-${id}-title`}
          className="text-xs font-semibold uppercase tracking-[0.16em]"
        >
          {title}
        </h2>
        <div className="h-px flex-1 bg-[hsl(var(--hairline))]" />
        <AsOfBadge computedAt={envelope?.computedAt} />
      </div>
      {!envelope || envelope.status !== "ready" || !envelope.data ? (
        <InsightCard title={title}>
          <InsightCardEmpty message="이 영역의 요약을 계산하지 못했거나 데이터가 없습니다." />
        </InsightCard>
      ) : (
        children(envelope.data)
      )}
    </section>
  );
}

function streakStats(days: CodingAggregate["dailyCommits"]) {
  const active = [...new Set(days.filter((day) => day.count > 0).map((day) => day.date))].sort();
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of active) {
    const current = Date.parse(`${key}T00:00:00Z`);
    run = previous !== null && current - previous === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = current;
  }
  return { activeDays: active.length, longest };
}

function CodingCards({ data, periodType }: { data: CodingAggregate; periodType: PeriodType }) {
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const streak = streakStats(data.dailyCommits);
  const maxCommits = Math.max(...data.dailyCommits.map((day) => day.count), 1);
  const topHours = data.weekdayHour.hours
    .map((count, hour) => ({ hour, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <InsightCard schema="commits" title="활동 히트맵과 스트릭" subtitle="기간 내 커밋 활동">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="커밋" value={compact.format(data.totalCommits)} tone="green" glow />
          <Stat label="활동일" value={streak.activeDays} suffix="일" />
          <Stat label="최장 스트릭" value={streak.longest} suffix="일" tone="amber" />
        </div>
        {data.dailyCommits.length === 0 ? (
          <InsightCardEmpty message="커밋 활동이 없습니다." />
        ) : (
          <div
            role="img"
            className="grid grid-cols-[repeat(auto-fit,minmax(12px,1fr))] gap-1"
            aria-label="일별 커밋 히트맵"
          >
            {data.dailyCommits.map((day) => (
              <span
                key={day.date}
                className="aspect-square min-h-3 rounded-[2px] bg-[hsl(var(--accent-green))]"
                style={{ opacity: 0.15 + (day.count / maxCommits) * 0.85 }}
                title={`${day.date}: ${day.count}개 커밋`}
              />
            ))}
          </div>
        )}
      </InsightCard>

      <InsightCard schema="coding" title="프로젝트 · 언어 · 커밋 유형">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <RankedList
            title="프로젝트"
            items={data.projects.map((item) => [item.name, item.commits])}
          />
          <RankedList
            title="언어"
            items={data.languages.map((item) => [item.name, duration(item.seconds)])}
          />
          <RankedList
            title="커밋 유형"
            items={data.commitTypes.map((item) => [item.type, item.count])}
          />
        </div>
      </InsightCard>

      <InsightCard schema="coding" title="딥워크와 컨텍스트 전환">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="딥워크" value={data.deepWorkSessions.length} suffix="회" tone="violet" />
          <Stat label="일평균 프로젝트" value={data.contextSwitching.avgDailyProjects.toFixed(1)} />
          <Stat label="일평균 언어" value={data.contextSwitching.avgDailyLanguages.toFixed(1)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.deepWorkSessions.slice(0, 6).map((session) => (
            <Pill
              key={`${session.date}:${session.project}:${session.durationSeconds}`}
              tone="violet"
            >
              {session.project ?? "기타"} · {duration(session.durationSeconds)}
            </Pill>
          ))}
        </div>
      </InsightCard>

      <InsightCard schema="commits" title="요일 · 시간대 활동">
        <div role="img" className="mb-4 flex h-24 items-end gap-2" aria-label="요일별 커밋">
          {dayLabels.map((label, day) => (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-[hsl(var(--accent-green)/0.65)]"
                style={{
                  height: `${Math.max(4, (data.weekdayHour.weekdays[day] / Math.max(...data.weekdayHour.weekdays, 1)) * 72)}px`,
                }}
              />
              <span className="text-[10px] text-ink-mute">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {topHours.map((item) => (
            <Pill key={item.hour} tone="green">
              {String(item.hour).padStart(2, "0")}시 · {item.count}
            </Pill>
          ))}
        </div>
      </InsightCard>

      {cardVisible("coding-yearly-trends", periodType) && data.yearlyReport ? (
        <InsightCard
          className="lg:col-span-2"
          schema="coding"
          title="연간 언어 추이와 프로젝트 타임라인"
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              {data.yearlyReport.languageTrend.map((quarter) => (
                <div key={quarter.quarter}>
                  <p className="mb-1 text-xs font-medium">{quarter.quarter}</p>
                  <div className="flex flex-wrap gap-1">
                    {quarter.languages.map((language) => (
                      <Pill key={`${quarter.quarter}:${language.name}`} tone="green">
                        {language.name} · {duration(language.seconds)}
                      </Pill>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <ol className="space-y-3 border-l border-hairline pl-4">
              {data.yearlyReport.projectTimeline.map((project) => (
                <li key={project.name}>
                  <p className="text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-ink-mute">
                    {project.firstCommit.slice(0, 10)} – {project.lastCommit.slice(0, 10)} ·{" "}
                    {project.totalCommits} commits
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </InsightCard>
      ) : null}
    </div>
  );
}

function RankedList({ title, items }: { title: string; items: Array<[string, string | number]> }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
        {title}
      </p>
      {items.length === 0 ? <p className="text-xs text-ink-mute">데이터 없음</p> : null}
      <ol className="space-y-1.5">
        {items.slice(0, 6).map(([label, value]) => (
          <li key={label} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate">{label}</span>
            <span className="tabular-mono text-ink-dim">{value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LocationCards({ data, periodType }: { data: LocationAggregate; periodType: PeriodType }) {
  const { derived } = data;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <InsightCard schema="location" title="장소와 위치 히트맵">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="방문" value={derived.visits.count} suffix="회" tone="orange" />
          <Stat label="장소" value={derived.visits.uniquePlaceCount} suffix="곳" />
          <Stat label="히트맵 셀" value={data.heatmap.length} />
        </div>
        <RankedList
          title="오래 머문 장소"
          items={derived.visits.places.map((place) => [
            place.placeName,
            duration(place.durationSeconds),
          ])}
        />
        {data.heatmap.length > 0 ? (
          <div role="img" className="mt-4 grid grid-cols-10 gap-1" aria-label="위치 밀도 히트맵">
            {data.heatmap.slice(0, 40).map((point) => (
              <span
                key={`${point.lat}:${point.lon}`}
                className="aspect-square rounded-sm bg-[hsl(var(--accent-orange))]"
                style={{
                  opacity:
                    0.15 +
                    (point.weight / Math.max(...data.heatmap.map((item) => item.weight), 1)) * 0.85,
                }}
                title={`${point.lat.toFixed(3)}, ${point.lon.toFixed(3)} · ${point.weight}`}
              />
            ))}
          </div>
        ) : null}
      </InsightCard>

      <InsightCard schema="transport" title="교통수단과 지하철">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="이동" value={derived.tracks.count} suffix="회" />
          <Stat
            label="거리"
            value={(derived.tracks.distanceMeters / 1000).toFixed(1)}
            suffix="km"
          />
          <Stat label="지하철" value={derived.subway.sessionCount} suffix="회" tone="blue" />
        </div>
        <div className="flex flex-wrap gap-2">
          {derived.transportModes.map((mode) => (
            <Pill key={mode.mode} tone="blue">
              {mode.mode} · {mode.sharePercent.toFixed(0)}%
            </Pill>
          ))}
          {derived.subway.lines.map((line) => (
            <Pill key={`${line.ref}:${line.name}`} tone="violet">
              {line.ref ?? line.name} · {line.tripCount}회
            </Pill>
          ))}
        </div>
      </InsightCard>

      <InsightCard schema="location" title="여행">
        {derived.trips.length === 0 ? (
          <InsightCardEmpty message="이 기간에 감지된 여행이 없습니다." />
        ) : (
          <ol className="space-y-3">
            {derived.trips.map((trip) => (
              <li
                key={`${trip.name}:${trip.startDate}`}
                className="rounded-lg border border-hairline p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{trip.name}</span>
                  {trip.isOverseas ? <Pill tone="violet">해외</Pill> : <Pill>국내</Pill>}
                </div>
                <p className="mt-1 text-xs text-ink-mute">
                  {trip.startDate} – {trip.endDate}
                </p>
                <p className="mt-1 text-xs">
                  {[...trip.visitedCities, ...trip.visitedCountries].join(" · ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </InsightCard>

      <InsightCard schema="cross" title="장소별 생산성">
        <RankedList
          title="커밋과 코딩 세션이 겹친 장소"
          items={derived.placeProductivity.map((place) => [
            place.placeName,
            `${place.productivityScore}점 · ${place.commitCount} commits`,
          ])}
        />
      </InsightCard>

      {cardVisible("location-scratch-map", periodType) ? (
        <InsightCard className="lg:col-span-2" schema="location" title="방문 지역과 처음 방문한 곳">
          {derived.visitedRegions.length === 0 ? (
            <InsightCardEmpty message="이 기간에 표시할 방문 지역이 없습니다." />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <RegionPlot regions={derived.visitedRegions} />
              <div className="flex content-start flex-wrap gap-2">
                {derived.visitedRegions.map((region) => (
                  <Pill
                    key={`${region.countryName}:${region.city}`}
                    tone={region.isFirstVisit ? "orange" : "neutral"}
                  >
                    {region.city}
                    {region.countryName ? ` · ${region.countryName}` : ""}
                    {region.isFirstVisit ? ` · 첫 방문 ${region.firstVisitDate}` : ""}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </InsightCard>
      ) : null}
    </div>
  );
}

function RegionPlot({ regions }: { regions: LocationAggregate["derived"]["visitedRegions"] }) {
  const lats = regions.map((region) => region.centerLat);
  const lons = regions.map((region) => region.centerLon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const x = (lon: number) => 12 + ((lon - minLon) / (maxLon - minLon || 1)) * 276;
  const y = (lat: number) => 108 - ((lat - minLat) / (maxLat - minLat || 1)) * 96;

  return (
    <svg
      viewBox="0 0 300 120"
      role="img"
      aria-label="방문 지역 스크래치 맵"
      className="w-full rounded-lg border border-hairline bg-muted/20"
    >
      {regions.map((region) => (
        <circle
          key={`${region.countryName}:${region.city}`}
          cx={x(region.centerLon)}
          cy={y(region.centerLat)}
          r={region.isFirstVisit ? 6 : 4}
          className={
            region.isFirstVisit
              ? "fill-[hsl(var(--accent-orange))]"
              : "fill-[hsl(var(--accent-blue)/0.75)]"
          }
        >
          <title>
            {region.city} · {region.firstVisitDate}
          </title>
        </circle>
      ))}
    </svg>
  );
}

const healthLabels: Record<HealthAggregate["metrics"][number]["metric"], string> = {
  steps: "걸음",
  sleep: "수면",
  heart_rate: "심박",
  vo2_max: "VO₂max",
};

function HealthCards({ data }: { data: HealthAggregate }) {
  const metrics = new Map(data.metrics.map((metric) => [metric.metric, metric]));
  return (
    <InsightCard
      schema="cross"
      title="건강 요약"
      right={<DestinationLink href="/overview?section=health" />}
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {(Object.keys(healthLabels) as Array<keyof typeof healthLabels>).map((metric) => (
          <Stat
            key={metric}
            label={healthLabels[metric]}
            value={metrics.get(metric)?.average?.toFixed(metric === "steps" ? 0 : 1) ?? "—"}
          />
        ))}
        <Stat label="체중" value={data.body.weightKg?.toFixed(1) ?? "—"} suffix="kg" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Pill>체지방 {data.body.fatRatioPct?.toFixed(1) ?? "—"}%</Pill>
        <Pill>근육량 {data.body.muscleMassKg?.toFixed(1) ?? "—"}kg</Pill>
        <Pill tone={data.body.weightChangeKg && data.body.weightChangeKg > 0 ? "amber" : "green"}>
          체중 변화 {data.body.weightChangeKg?.toFixed(1) ?? "—"}kg
        </Pill>
      </div>
    </InsightCard>
  );
}

function SpendingCards({ data }: { data: SpendingAggregate }) {
  return (
    <InsightCard schema="spending" title="소비 요약" right={<DestinationLink href="/spending" />}>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="지출" value={currency.format(data.spending)} tone="red" />
        <Stat label="수입" value={currency.format(data.income)} tone="green" />
        <Stat label="순지출" value={currency.format(data.netSpend)} tone="amber" glow />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RankedList
          title="계정 역할 반영"
          items={data.accountRoles.map((role) => [
            role.role,
            currency.format(role.spending - role.income),
          ])}
        />
        <RankedList
          title="카테고리"
          items={data.categories.map((item) => [item.category, currency.format(item.spending)])}
        />
      </div>
    </InsightCard>
  );
}

function PortfolioCards({ data }: { data: PortfolioAggregate }) {
  const latest = data.evaluationTrend.at(-1)?.value ?? null;
  return (
    <InsightCard schema="cross" title="자산 요약" right={<DestinationLink href="/portfolio" />}>
      {!data.hasAccounts ? (
        <InsightCardEmpty message="연결된 투자 계좌가 없습니다." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Stat
              label="평가액"
              value={latest == null ? "—" : currency.format(latest)}
              tone="blue"
              glow
            />
            <Stat label="TWR" value={percent(data.twr.totalReturn)} tone="green" />
            <Stat
              label="연환산"
              value={percent(data.twr.annualizedReturn)}
              caption={`${data.twr.days}일 기준`}
            />
          </div>
          <div role="img" className="mt-5 flex h-20 items-end gap-1" aria-label="평가액 추이">
            {data.evaluationTrend.map((point) => {
              const max = Math.max(...data.evaluationTrend.map((item) => item.value), 1);
              return (
                <span
                  key={point.date}
                  className="min-w-1 flex-1 rounded-t bg-[hsl(var(--accent-blue)/0.65)]"
                  style={{ height: `${Math.max(4, (point.value / max) * 80)}px` }}
                  title={`${point.date}: ${currency.format(point.value)}`}
                />
              );
            })}
          </div>
        </>
      )}
    </InsightCard>
  );
}

function DestinationLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs text-ink-dim hover:text-foreground"
    >
      자세히
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </Link>
  );
}

export function OverviewCards({
  payload,
  periodType,
}: {
  payload: OverviewSnapshotDomains;
  periodType: PeriodType;
}) {
  return (
    <div className="space-y-7">
      <DomainGroup id="coding" title="코딩" envelope={payload.coding}>
        {(data) => <CodingCards data={data} periodType={periodType} />}
      </DomainGroup>
      <DomainGroup id="location" title="이동과 장소" envelope={payload.location}>
        {(data) => <LocationCards data={data} periodType={periodType} />}
      </DomainGroup>
      <DomainGroup id="health" title="건강" envelope={payload.health}>
        {(data) => <HealthCards data={data} />}
      </DomainGroup>
      <DomainGroup id="spending" title="소비" envelope={payload.spending}>
        {(data) => <SpendingCards data={data} />}
      </DomainGroup>
      <DomainGroup id="portfolio" title="자산" envelope={payload.portfolio}>
        {(data) => <PortfolioCards data={data} />}
      </DomainGroup>
    </div>
  );
}
