"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AiLine,
  Chevron,
  CountUp,
  Disclosure,
  ErrorState,
  LoadingState,
  MetaLine,
  PageTitle,
  Segmented,
  SOURCE_ICON_PATHS,
  type SourceIconName,
  type SourceStatus,
  SourceTile,
  StatusBadge,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient, useSession } from "@/lib/auth-client";
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { diagnosis } from "@/lib/facts/helpers";
import type { Fact } from "@/lib/facts/types";
import { formatCount, formatMonthDay, formatRelative, formatShare, formatTime } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { userErrorMessage } from "@/lib/user-error";
import { cn, formatBytes } from "@/lib/utils";
import { useAuth } from "@/modules/auth/hooks";
import { buildSourceView, focusFact, type SourceView } from "@/modules/data-status/insights";
import type { DataStatusResponse, SourceId } from "@/modules/data-status/types";
import { LocationImport } from "@/modules/location/components/LocationImport";
import { SavedPlacesSettings } from "@/modules/location/components/SavedPlacesSettings";
import { KISAccountSettingsCard } from "@/modules/portfolio/components/KISAccountSettingsCard";
import { useDataUsage, useOwnTracksKey, useSettings } from "../hooks";
import { type SummaryCounts, useRetryFailedSummaries, useSummaryCounts } from "../summaries";
import type { LocationSummary, UserSettings } from "../types";
import { AccountRolesCard, isSuspectAccount } from "./AccountRolesCard";
import { DbBenchmarkCard } from "./DbBenchmarkCard";
import { HealthImportSettings } from "./HealthImportSettings";
import { HealthSettings } from "./HealthSettings";
import { LocationBackfillCard } from "./LocationBackfillCard";
import { OwnTracksSettings } from "./OwnTracksSettings";
import { SummaryStats } from "./SummaryStats";
import { TossNotificationSettings } from "./TossNotificationSettings";
import { TripDetectionCard } from "./TripDetectionCard";
import { WakaTimeSettings } from "./WakaTimeSettings";
import { WithingsSettings } from "./WithingsSettings";

// ── OAuth callback toasts (unchanged behaviour) ─────────────────────────────

const WITHINGS_ERROR_MESSAGES: Record<string, string> = {
  denied: "Withings 연결이 취소됐어요. 연결하려면 다시 시도해 주세요.",
  state_invalid: "Withings 연결 요청이 만료됐어요. 다시 연결해 주세요.",
  rate_limited: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  exchange_failed: "Withings를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

const HEALTH_ERROR_MESSAGES: Record<string, string> = {
  denied: "Google Health (Fitbit) 연결이 취소됐어요. 연결하려면 다시 시도해 주세요.",
  state_invalid: "Google Health (Fitbit) 연결 요청이 만료됐어요. 다시 연결해 주세요.",
  rate_limited: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  exchange_failed: "Google Health (Fitbit)을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

const WAKATIME_ERROR_MESSAGES: Record<string, string> = {
  denied: "WakaTime 연동이 취소됐어요",
  state_invalid: "WakaTime 연동 요청이 만료되었거나 유효하지 않아요. 다시 시도해 주세요",
  rate_limited: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요",
  exchange_failed: "WakaTime 연동에 실패했어요. 다시 시도해 주세요",
};

const OAUTH_PROVIDERS: {
  param: string;
  connectedMsg: string;
  errors: Record<string, string>;
  fallback: string;
}[] = [
  {
    param: "withings",
    connectedMsg: "Withings가 연결됐어요.",
    errors: WITHINGS_ERROR_MESSAGES,
    fallback: "Withings를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  },
  {
    param: "health",
    connectedMsg: "Google Health (Fitbit)이 연결됐어요.",
    errors: HEALTH_ERROR_MESSAGES,
    fallback: "Google Health (Fitbit)을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  },
  {
    param: "wakatime",
    connectedMsg: "WakaTime이 연결됐어요",
    errors: WAKATIME_ERROR_MESSAGES,
    fallback: "WakaTime 연동에 실패했어요",
  },
];

/**
 * Surface the Withings/Fitbit/WakaTime OAuth callback outcome (?withings= | ?health= | ?wakatime=,
 * connected | error&reason=...), then strip the params so a refresh doesn't
 * re-fire the toast. Returns true if a connection succeeded (caller refreshes settings).
 */
function surfaceOAuthCallbackToast(): boolean {
  const params = new URLSearchParams(window.location.search);
  let connected = false;

  for (const provider of OAUTH_PROVIDERS) {
    const outcome = params.get(provider.param);
    if (outcome === "connected") {
      toast.success(provider.connectedMsg);
      connected = true;
    } else if (outcome === "error") {
      const reason = params.get("reason") ?? "";
      toast.error(provider.errors[reason] ?? provider.fallback);
    }
    params.delete(provider.param);
  }
  params.delete("reason");

  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  return connected;
}

// ── Shared bits ─────────────────────────────────────────────────────────────

/**
 * Embeds an existing settings card without its card chrome: the disclosure row
 * already names the item, so the card's own frame and title are dropped and its
 * description + controls read as the panel body.
 */
const BARE =
  "[&_[data-slot=card]]:gap-4 [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:py-0 [&_[data-slot=card]]:shadow-none [&_[data-slot=card-header]]:px-0 [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-footer]]:px-0 [&_[data-slot=card-title]]:sr-only [&_[data-slot=card-description]]:text-[13px] [&_[data-slot=card-description]]:leading-5 [&_[data-slot=card-description]]:text-ink-2";

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="m-0 mb-1 font-serif text-xl leading-7 font-semibold tracking-[-0.02em]">
      {children}
    </h2>
  );
}

function DisclosureRow({
  id,
  title,
  meta,
  metaTone = "ink3",
  icon,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  metaTone?: "ink3" | "warn" | "danger";
  icon?: SourceIconName;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `settings-${id}`;
  // A closed panel is inert and collapsed, but its body still mounted — so every
  // card's on-mount fetch (the location dry run alone scans millions of points)
  // ran on page load for panels nobody opened. Mount on first open, then keep it
  // mounted so closing animates and the card keeps its state.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  return (
    <div className="scroll-mt-24 border-b border-line" id={`row-${id}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent text-left text-ink transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-brand",
          icon ? "min-h-[60px] py-3" : "py-3.5"
        )}
      >
        {icon ? <SourceTile icon={icon} /> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] leading-[22px] font-semibold">{title}</span>
          {meta ? (
            // Wraps instead of truncating: on a 320 row a cut "계정 …" had no way to be read.
            <span
              className={cn(
                "text-[13px] leading-[18px] text-pretty",
                metaTone === "warn"
                  ? "text-warn"
                  : metaTone === "danger"
                    ? "text-danger"
                    : "text-ink-3"
              )}
            >
              {meta}
            </span>
          ) : null}
        </span>
        {badge}
        <Chevron />
      </button>
      <Disclosure open={open} id={panelId}>
        <div className={cn("pb-5", icon && "pl-11", BARE)}>{everOpened ? children : null}</div>
      </Disclosure>
    </div>
  );
}

// ── Form ────────────────────────────────────────────────────────────────────

export function SettingsForm() {
  const {
    settings,
    isSaving,
    isLoading: settingsLoading,
    error: settingsError,
    updateSettings,
    refresh,
  } = useSettings();
  const { user } = useAuth();
  const { data: session } = useSession();
  const [now] = useState(() => new Date());
  const today = toKstCalendarDate(now);
  const from = shiftDateKey(today, -6);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => () => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const openAndScroll = (id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    // Focus follows the jump (the row's now-expanded toggle), and the scroll is
    // instant when the user asked the OS to reduce motion.
    requestAnimationFrame(() => {
      const row = document.getElementById(`row-${id}`);
      row?.querySelector<HTMLButtonElement>(":scope > button")?.focus({ preventScroll: true });
      row?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  };

  useEffect(() => {
    if (surfaceOAuthCallbackToast()) refresh();
  }, [refresh]);

  const status = useQuery<DataStatusResponse>({
    queryKey: ["data-status", session?.session.id, from, today],
    enabled: !!session,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/data-status?${new URLSearchParams({ from, to: today })}`, {
        signal,
      });
      if (!response.ok) throw new Error("수집 상태를 불러오지 못했어요.");
      return response.json();
    },
  });
  const summaries = useSummaryCounts();
  const retrySummaries = useRetryFailedSummaries();
  const usage = useDataUsage();
  const manage = useManageStatus(!!session, settings?.hasTossKey ?? false);

  const views = useMemo(() => {
    const map = new Map<SourceId, SourceView>();
    for (const source of status.data?.sources ?? []) {
      map.set(source.id, buildSourceView(source, now));
    }
    return map;
  }, [status.data, now]);

  if (!settings) {
    if (settingsError && !settingsLoading) {
      return (
        <>
          <PageTitle title="설정" />
          <ErrorState
            className="mt-8"
            title="설정을 불러오지 못했어요"
            description="연결 상태와 저장 공간은 설정을 읽은 뒤에 보여 드려요. 잠시 후 다시 시도해 주세요."
            actions={
              <Button variant="outline" onClick={() => refresh()}>
                다시 시도
              </Button>
            }
          />
        </>
      );
    }
    return (
      <>
        <PageTitle title="설정" />
        <LoadingState variant="rows" rows={8} className="mt-10" label="설정을 불러오는 중" />
      </>
    );
  }

  const connections = buildConnections(
    settings,
    views,
    user?.githubUsername ?? null,
    now,
    status.isPending
  );
  const connectedCount = connections.filter((c) => c.status !== "disconnected").length;
  const connectionsPending = connections.some((c) => c.pending);

  return (
    <>
      <PageTitle
        className="ds-enter"
        title="설정"
        meta={
          <MetaLine
            items={[
              connectionsPending ? null : `연결 ${connectedCount}개`,
              usage.data && usage.data.grandTotalBytes > 0
                ? `저장 공간 ${formatBytes(usage.data.grandTotalBytes)}`
                : null,
              <Link
                key="ds"
                href="/data-status"
                className="text-ink-2 underline-offset-[3px] hover:underline"
              >
                수집 상태 보기
              </Link>,
            ]}
          />
        }
      />
      {/* Phones read top to bottom in the mock's order (확인할 것 → 연결 → 저장 공간 →
          관리 → 위험 구역); from lg the storage and danger sections sit in a sticky
          side column. The columns are `display: contents` below lg so `order`
          interleaves their sections. Below sm every button and date input on the
          page gets a 44px touch target (the compact `sm` sizes stay on desktop). */}
      <div className="mt-10 flex flex-col gap-10 max-sm:[&_[data-slot=button]]:min-h-11 max-sm:[&_input[type=date]]:h-11 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-16">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-10">
          <TodoSection
            views={views}
            summaries={summaries.data ?? null}
            unnamedVisits={manage.location?.unnamedVisits ?? 0}
            now={now}
            loading={status.isPending}
            onOpenPanel={openAndScroll}
            onRetrySummaries={() => retrySummaries.mutate()}
            retryingSummaries={retrySummaries.isPending}
          />

          <section
            aria-labelledby="conn"
            className="ds-enter order-2 flex flex-col [animation-delay:200ms]"
          >
            <SectionTitle id="conn">연결</SectionTitle>
            {connections.map((c) => (
              <DisclosureRow
                key={c.id}
                id={c.id}
                icon={c.icon}
                title={c.name}
                meta={c.meta}
                metaTone={c.status === "reauth" || c.status === "delayed" ? "warn" : "ink3"}
                badge={
                  c.pending ? (
                    <span aria-hidden="true" className="block h-5 w-12 rounded-full bg-track" />
                  ) : (
                    <StatusBadge status={c.status} />
                  )
                }
                open={!!open[c.id]}
                onToggle={toggle(c.id)}
              >
                {c.body(settings, updateSettings)}
              </DisclosureRow>
            ))}
          </section>

          <section
            aria-labelledby="more"
            className="ds-enter order-4 flex flex-col [animation-delay:300ms]"
          >
            <SectionTitle id="more">관리</SectionTitle>
            <DisclosureRow
              id="places"
              title="저장한 장소"
              meta={manage.placesMeta ?? "집·회사처럼 자주 가는 곳 · 여행 감지 제외"}
              open={!!open.places}
              onToggle={toggle("places")}
            >
              <SavedPlacesSettings />
            </DisclosureRow>
            {settings.hasTossKey ? (
              <DisclosureRow
                id="roles"
                title="토스 계좌 역할"
                meta={manage.roles?.text ?? "계좌별 소비 · 기본 · 무시 분류"}
                metaTone={manage.roles?.warn ? "warn" : "ink3"}
                open={!!open.roles}
                onToggle={toggle("roles")}
              >
                <AccountRolesCard />
              </DisclosureRow>
            ) : null}
            <DisclosureRow
              id="loc"
              title="위치 처리"
              meta={manage.locationMeta?.text ?? "기간 다시 처리 · 교통수단 · 지하철 매칭"}
              metaTone={manage.locationMeta?.warn ? "warn" : "ink3"}
              open={!!open.loc}
              onToggle={toggle("loc")}
            >
              <LocationBackfillCard />
            </DisclosureRow>
            <DisclosureRow
              id="trip"
              title="여행 자동 감지"
              meta="매주 일요일 02:00"
              open={!!open.trip}
              onToggle={toggle("trip")}
            >
              <TripDetectionCard />
            </DisclosureRow>
            <DisclosureRow
              id="import"
              title="위치 파일 가져오기"
              meta="GPX · GeoJSON · Google Takeout"
              open={!!open.import}
              onToggle={toggle("import")}
            >
              <LocationImport />
            </DisclosureRow>
            <DisclosureRow
              id="summaries"
              title="AI 요약"
              meta={
                summaries.data
                  ? `완료 ${formatCount(summaries.data.completed)} · 대기 ${formatCount(summaries.data.pending)} · 실패 ${formatCount(summaries.data.failed)}`
                  : "커밋 요약 생성 상태"
              }
              open={!!open.summaries}
              onToggle={toggle("summaries")}
            >
              <SummaryStats />
            </DisclosureRow>
            <DisclosureRow
              id="sync"
              title="동기화 간격"
              meta={`${settings.syncIntervalHours}시간마다`}
              open={!!open.sync}
              onToggle={toggle("sync")}
            >
              <div className={cn(isSaving && "pointer-events-none opacity-60")}>
                <Segmented
                  items={INTERVALS}
                  value={String(settings.syncIntervalHours)}
                  onChange={async (v) => {
                    const ok = await updateSettings({ syncIntervalHours: Number(v) });
                    if (ok) toast.success("동기화 간격이 변경됐어요.");
                    else
                      toast.error("동기화 간격을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.");
                  }}
                  ariaLabel="동기화 간격"
                  fullWidth="always"
                />
              </div>
            </DisclosureRow>
            <ThemeRow
              open={!!open.theme}
              onToggle={toggle("theme")}
              onSave={(theme) => updateSettings({ theme })}
            />
            {process.env.NEXT_PUBLIC_ENABLE_DB_BENCHMARK === "true" ? (
              <DisclosureRow
                id="bench"
                title="DB 벤치마크"
                meta="관리자 전용"
                open={!!open.bench}
                onToggle={toggle("bench")}
              >
                <DbBenchmarkCard />
              </DisclosureRow>
            ) : null}
          </section>
        </div>

        <div className="contents lg:sticky lg:top-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-10 lg:self-start">
          <StorageSection usage={usage} now={now} summaries={summaries.data ?? null} />
          <DangerZone hasOwnTracksKey={settings.hasOwnTracksKey} onChanged={refresh} />
        </div>
      </div>
    </>
  );
}

const INTERVALS = [1, 3, 6, 12, 24].map((h) => ({ value: String(h), label: `${h}시간` }));

// ── 확인할 것 ───────────────────────────────────────────────────────────────

const REAUTH_HREF: Partial<Record<SourceId, string>> = {
  wakatime: "/api/wakatime/authorize",
  withings: "/api/withings/authorize",
  health: "/api/fitbit/authorize",
};

interface Todo {
  id: string;
  icon: SourceIconName;
  tone: "danger" | "warn" | "ink";
  title: string;
  meta: string;
  big: number;
  unit: string;
  fact: Fact | null;
  action: ReactNode;
}

const STATUS_TITLE: Record<string, string> = {
  reauth: "다시 연결 필요",
  failed: "동기화 실패",
  delayed: "동기화 지연",
};

function sourceTodos(all: SourceView[], now: Date): Todo[] {
  const todos: Todo[] = [];
  for (const view of all) {
    if (!(view.status in STATUS_TITLE)) continue;
    const last = view.source.lastSuccessAt ? new Date(view.source.lastSuccessAt) : null;
    const reauthHref = view.status === "reauth" ? REAUTH_HREF[view.id] : undefined;
    todos.push({
      id: view.id,
      icon: "alert",
      // Same severity colors as the status badges: re-auth is amber, a real
      // failure red.
      tone: view.status === "delayed" ? "ink" : view.status === "reauth" ? "warn" : "danger",
      title: `${view.name} ${STATUS_TITLE[view.status]}`,
      meta: last
        ? `마지막 성공 ${formatMonthDay(last, { now })} ${formatTime(last)}`
        : "성공한 기록 없음",
      big: view.daysSinceSuccess ?? 0,
      unit: "일째",
      fact: focusFact(view, all, now),
      action: reauthHref ? (
        <Button size="sm" asChild>
          <a href={reauthHref}>다시 연결</a>
        </Button>
      ) : (
        <Button size="sm" asChild>
          <Link href="/data-status">수집 상태에서 재수집</Link>
        </Button>
      ),
    });
  }
  for (const view of all) {
    if (view.status !== "ok" || view.gaps.length === 0) continue;
    todos.push({
      id: `${view.id}-gaps`,
      icon: view.id,
      tone: "ink",
      title: `${view.name} 기록 공백`,
      meta: "최근 7일 중 들어와야 할 기록이 빠진 날",
      big: view.gaps.length,
      unit: "일",
      fact: focusFact(view, [view], now),
      action: (
        <Button variant="outline" size="sm" asChild>
          <Link href="/data-status">수집 상태 보기</Link>
        </Button>
      ),
    });
  }
  return todos;
}

function summaryTodo(summaries: SummaryCounts, onRetry: () => void, retrying: boolean): Todo {
  const share = summaries.failed / summaries.total;
  return {
    id: "summaries",
    icon: "sparkle",
    tone: "ink",
    title: "AI 요약 실패",
    meta: `전체 ${formatCount(summaries.total)}건 · 대기 ${formatCount(summaries.pending)}건`,
    big: summaries.failed,
    unit: "건",
    fact: diagnosis({
      id: "settings.summaries.failed",
      metric: "summaries",
      metricLabel: "AI 요약",
      period: { from: "", to: "", label: "전체" },
      value: share,
      unit: "percent",
      detail: { trigger: share < 0.01 ? `${(share * 100).toFixed(2)}%` : formatShare(share) },
      template:
        share < 0.01
          ? "전체의 {fact}라 급하진 않아요. 자동 재시도를 다 써서 저절로는 다시 만들지 않아요."
          : "전체의 {fact}가 실패했어요. 타임라인에 요약이 빠진 커밋이 보여요.",
      rows: [
        { label: "완료", value: `${formatCount(summaries.completed)}건` },
        {
          label: "실패",
          value: `${formatCount(summaries.failed)}건 · ${formatCount(summaries.total)}건 중 ${(share * 100).toFixed(2)}%`,
        },
        {
          label: "대기·처리 중",
          value: `${formatCount(summaries.pending)}건 · ${formatCount(summaries.processing)}건`,
        },
      ],
    }),
    action: (
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? "요청 중…" : `${formatCount(summaries.failed)}건 다시 시도`}
      </Button>
    ),
  };
}

function unnamedVisitsTodo(count: number, onOpen: () => void): Todo {
  return {
    id: "unnamed-visits",
    icon: "location",
    tone: "ink",
    title: "장소 이름 없는 방문",
    meta: "주소 조회에 실패해 이름 없이 남은 방문",
    big: count,
    unit: "곳",
    fact: null,
    action: (
      <Button variant="outline" size="sm" onClick={onOpen}>
        위치 처리 열기
      </Button>
    ),
  };
}

function TodoSection({
  views,
  summaries,
  unnamedVisits,
  now,
  loading,
  onOpenPanel,
  onRetrySummaries,
  retryingSummaries,
}: {
  views: Map<SourceId, SourceView>;
  summaries: SummaryCounts | null;
  unnamedVisits: number;
  now: Date;
  loading: boolean;
  onOpenPanel: (id: string) => void;
  onRetrySummaries: () => void;
  retryingSummaries: boolean;
}) {
  const all = [...views.values()];
  const todos = sourceTodos(all, now);
  if (summaries && summaries.failed > 0 && summaries.total > 0) {
    todos.splice(
      todos.findIndex((t) => t.id.endsWith("-gaps")) >= 0
        ? todos.findIndex((t) => t.id.endsWith("-gaps"))
        : todos.length,
      0,
      summaryTodo(summaries, onRetrySummaries, retryingSummaries)
    );
  }
  if (unnamedVisits > 0) todos.push(unnamedVisitsTodo(unnamedVisits, () => onOpenPanel("loc")));
  const todayPoints = views.get("location")?.cells.at(-1)?.count ?? 0;

  return (
    <section
      aria-labelledby="todo"
      className="ds-enter order-1 flex flex-col [animation-delay:100ms]"
    >
      <SectionTitle id="todo">
        확인할 것{" "}
        {todos.length > 0 ? (
          <span className="num text-[15px] font-normal text-ink-3">{todos.length}</span>
        ) : null}
      </SectionTitle>
      {loading ? (
        <LoadingState variant="rows" rows={2} label="확인할 것을 찾는 중" />
      ) : todos.length === 0 ? (
        <p className="m-0 border-b border-line py-4 text-sm leading-[22px] text-ink-2">
          확인할 것이 없어요. 연결된 소스가 모두 정상이고 빠진 기록도 없어요.
        </p>
      ) : (
        todos.map((todo) => (
          <div key={todo.id} className="flex flex-col gap-2 border-b border-line py-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid size-8 flex-none place-items-center rounded-[9px] bg-sunken",
                  todo.tone === "danger"
                    ? "text-danger"
                    : todo.tone === "warn"
                      ? "text-warn"
                      : "text-ink-2"
                )}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={SOURCE_ICON_PATHS[todo.icon]} />
                </svg>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] leading-[22px] font-semibold">{todo.title}</span>
                <span className="text-[13px] leading-[18px] text-ink-3">{todo.meta}</span>
              </div>
              <span
                className={cn(
                  "num text-[22px] leading-7 font-medium whitespace-nowrap",
                  todo.tone === "danger"
                    ? "text-danger"
                    : todo.tone === "warn"
                      ? "text-warn"
                      : "text-ink"
                )}
              >
                <CountUp value={todo.big} />
                <span className="font-sans text-xs text-ink-3">{todo.unit}</span>
              </span>
            </div>
            <div className="flex flex-col gap-2.5 pl-11">
              <AiLine fact={todo.fact} />
              <div className="flex gap-2">{todo.action}</div>
            </div>
          </div>
        ))
      )}
      {todayPoints > 0 ? (
        <p className="m-0 mt-3 flex items-center gap-2 text-[13px] leading-5 text-ink-3">
          <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-ink-3" />
          <span>
            오늘 좌표 <span className="tabular-nums text-ink-2">{formatCount(todayPoints)}</span>
            개는 내일 01:00에 처리돼요
          </span>
        </p>
      ) : null}
    </section>
  );
}

// ── 연결 ────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  name: string;
  icon: SourceIconName;
  status: SourceStatus;
  /** The status comes from /api/data-status, which hasn't answered yet. */
  pending?: boolean;
  meta: string;
  body: (
    settings: UserSettings,
    update: (s: Partial<UserSettings>) => Promise<boolean>
  ) => ReactNode;
}

function lastText(view: SourceView | undefined, now: Date): string | null {
  const at = view?.source.lastSuccessAt;
  return at ? formatRelative(at, now) : null;
}

const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");

function buildConnections(
  settings: UserSettings,
  views: Map<SourceId, SourceView>,
  githubUsername: string | null,
  now: Date,
  statusPending = false
): Connection[] {
  const st = (id: SourceId, connected: boolean): SourceStatus =>
    !connected ? "disconnected" : (views.get(id)?.status ?? "ok");
  const waka = views.get("wakatime");
  const wakaLegacy = settings.hasLegacyWakaTimeKey && !settings.hasWakaTimeConnection;
  const location = lastText(views.get("location"), now);
  const kis = views.get("kis");
  return [
    {
      id: "wakatime",
      name: "WakaTime",
      icon: "wakatime",
      status:
        settings.wakatimeNeedsReauth || wakaLegacy
          ? "reauth"
          : st("wakatime", settings.hasWakaTimeConnection),
      meta: settings.hasWakaTimeConnection
        ? settings.wakatimeNeedsReauth
          ? join("인증 만료", lastText(waka, now) && `마지막 성공 ${lastText(waka, now)}`)
          : join(lastText(waka, now) && `마지막 성공 ${lastText(waka, now)}`, "계정 연결됨")
        : wakaLegacy
          ? // Action first: it is what the row is asking for.
            join("다시 연결 필요", lastText(waka, now) && `마지막 성공 ${lastText(waka, now)}`)
          : "연결 안 됨",
      body: () => (
        <WakaTimeSettings
          hasConnection={settings.hasWakaTimeConnection}
          needsReauth={settings.wakatimeNeedsReauth}
          hasLegacyKey={settings.hasLegacyWakaTimeKey}
        />
      ),
    },
    {
      id: "github",
      name: "GitHub",
      icon: "github",
      status: st("github", true),
      meta: join(
        githubUsername,
        `${settings.syncIntervalHours}시간마다`,
        lastText(views.get("github"), now)
      ),
      body: () => <GithubPanel />,
    },
    {
      id: "owntracks",
      name: "위치 · OwnTracks",
      icon: "location",
      status: st("location", settings.hasOwnTracksKey),
      meta: settings.hasOwnTracksKey
        ? join(location && `${location} 수신`, "키 사용 중")
        : "키 없음",
      body: () => <OwnTracksSettings hasKey={settings.hasOwnTracksKey} />,
    },
    {
      id: "toss",
      name: "토스 알림",
      icon: "toss",
      status: st("toss", settings.hasTossKey),
      meta: settings.hasTossKey
        ? join(
            settings.tossMyName && `내 이름 ${settings.tossMyName}`,
            lastText(views.get("toss"), now)
          )
        : "키 없음",
      body: (s, update) => (
        <TossNotificationSettings
          hasKey={s.hasTossKey}
          tossMyName={s.tossMyName}
          onUpdateMyName={async (name) => update({ tossMyName: name })}
        />
      ),
    },
    {
      id: "health-import",
      name: "Health Connect",
      icon: "health",
      status: settings.hasHealthImportKey ? "ok" : "disconnected",
      meta: settings.hasHealthImportKey ? "휴대폰 가져오기 키 사용 중" : "키 없음",
      body: () => <HealthImportSettings hasKey={settings.hasHealthImportKey} />,
    },
    {
      id: "google-health",
      name: "Google Health",
      icon: "heart",
      status: settings.healthNeedsReauth ? "reauth" : st("health", settings.hasHealthConnection),
      meta: settings.hasHealthConnection
        ? join(
            "Fitbit",
            settings.healthLastSyncedAt && formatRelative(settings.healthLastSyncedAt, now)
          )
        : "연결 안 됨",
      body: () => (
        <HealthSettings
          hasConnection={settings.hasHealthConnection}
          lastSyncedAt={settings.healthLastSyncedAt}
          lastWebhookAt={settings.healthLastWebhookAt}
          needsReauth={settings.healthNeedsReauth}
          ecgGranted={settings.healthEcgGranted}
          irnGranted={settings.healthIrnGranted}
        />
      ),
    },
    {
      id: "withings",
      name: "Withings",
      icon: "withings",
      status: settings.withingsNeedsReauth
        ? "reauth"
        : st("withings", settings.hasWithingsConnection),
      meta: settings.hasWithingsConnection
        ? join(
            settings.withingsUserId && `ID ${settings.withingsUserId}`,
            settings.withingsLastSyncedAt && formatRelative(settings.withingsLastSyncedAt, now)
          )
        : "연결 안 됨",
      body: () => (
        <WithingsSettings
          hasConnection={settings.hasWithingsConnection}
          withingsUserId={settings.withingsUserId}
          lastSyncedAt={settings.withingsLastSyncedAt}
          needsReauth={settings.withingsNeedsReauth}
        />
      ),
    },
    {
      id: "kis",
      name: "한국투자증권",
      icon: "kis",
      status: kis?.status ?? "disconnected",
      // KIS has no settings flag: only the status response knows if an account
      // is linked, so "계좌 없음" must wait for it.
      pending: statusPending && !kis,
      meta: kis?.source.connected
        ? join("계좌 연결됨", lastText(kis, now))
        : statusPending
          ? "확인 중…"
          : "계좌 없음",
      body: () => <KISAccountSettingsCard />,
    },
  ];
}

function GithubPanel() {
  const reconnect = async () => {
    await authClient.signIn.social({ provider: "github", callbackURL: "/settings" });
  };
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-5 text-ink-2">
      <p className="m-0">
        Organization 레포지토리가 안 보이면 해당 Organization에서 OAuth 앱 접근을 승인해야 해요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={reconnect}>
          다시 연결
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a
            href="https://github.com/settings/applications"
            target="_blank"
            rel="noopener noreferrer"
          >
            Organization 권한
          </a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a
            href="https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization"
            target="_blank"
            rel="noopener noreferrer"
          >
            도움말
          </a>
        </Button>
      </div>
    </div>
  );
}

// ── 관리 controls ───────────────────────────────────────────────────────────

const THEMES = [
  { value: "system" as const, label: "시스템 설정" },
  { value: "light" as const, label: "라이트" },
  { value: "dark" as const, label: "다크" },
];

function ThemeRow({
  open,
  onToggle,
  onSave,
}: {
  open: boolean;
  onToggle: () => void;
  onSave: (theme: UserSettings["theme"]) => Promise<boolean>;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = ((mounted ? theme : null) ?? "system") as UserSettings["theme"];
  return (
    <DisclosureRow
      id="theme"
      title="화면 테마"
      meta={THEMES.find((t) => t.value === current)?.label ?? "시스템 설정"}
      open={open}
      onToggle={onToggle}
    >
      <Segmented
        items={THEMES}
        value={current}
        onChange={(v) => {
          setTheme(v);
          void onSave(v);
        }}
        ariaLabel="화면 테마"
        fullWidth="always"
      />
    </DisclosureRow>
  );
}

// ── 저장 공간 ───────────────────────────────────────────────────────────────

/**
 * A cache written before commit summaries were counted through `commits`
 * ownership (bb64bb8) reads 0 summary rows while summaries exist. That is a
 * stale cache, not something to explain to the user: recompute it once.
 */
function isStaleSummaryCount(summaries: SummaryCounts | null, summaryRows: number | null) {
  return !!summaries && summaries.completed > 0 && summaryRows === 0;
}

function StorageSection({
  usage,
  now,
  summaries,
}: {
  usage: ReturnType<typeof useDataUsage>;
  now: Date;
  summaries: SummaryCounts | null;
}) {
  const [open, setOpen] = useState(false);
  const data = usage.data;
  const cats = data?.categories ?? [];
  const total = data?.grandTotalBytes ?? 0;
  const [top, second] = cats;
  const share = (b: number) => (total > 0 ? b / total : 0);
  const summaryRows =
    cats
      .find((c) => c.category === "commits")
      ?.tables.find((t) => t.tableName === "commit_summaries")?.rowCount ?? null;
  const stale = isStaleSummaryCount(summaries, summaryRows);
  const healed = useRef(false);
  const { refresh, isRefreshing } = usage;
  useEffect(() => {
    if (!stale || healed.current || isRefreshing) return;
    healed.current = true;
    void refresh();
  }, [stale, refresh, isRefreshing]);
  const restBytes = cats.slice(2).reduce((s, c) => s + c.totalBytes, 0);

  return (
    <section
      aria-labelledby="store"
      className="ds-enter order-3 flex flex-col [animation-delay:300ms]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id="store">저장 공간</SectionTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={usage.refresh}
          disabled={usage.isRefreshing}
          className="-mr-2"
        >
          {usage.isRefreshing ? "계산 중…" : "다시 계산"}
        </Button>
      </div>
      {usage.isLoading ? (
        <LoadingState variant="block" label="데이터 용량을 불러오는 중" />
      ) : !top || total === 0 ? (
        <p className="m-0 mt-1 text-sm leading-[22px] text-ink-2">
          아직 계산된 용량이 없어요. 다시 계산을 눌러 지금 크기를 확인하세요.
        </p>
      ) : (
        <>
          <p className="m-0 mt-1 mb-3.5 text-[15px] leading-6">
            {/* Figures inside a Korean sentence stay in the sans face (tabular only). */}
            <span className="tabular-nums">{formatBytes(total)}</span> 중 {top.label} 기록이{" "}
            <span className="font-semibold tabular-nums">{formatShare(share(top.totalBytes))}</span>
            <span className="text-ink-2">
              (<span className="tabular-nums">{formatBytes(top.totalBytes)}</span>)
            </span>
            예요.
          </p>
          <div
            role="img"
            aria-label={cats
              .map((c) => `${c.label} ${formatShare(share(c.totalBytes))}`)
              .join(", ")}
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
          >
            <span
              className="ds-growx bg-ink"
              style={{ width: `${share(top.totalBytes) * 100}%` }}
            />
            {second ? (
              <span
                className="ds-growx [animation-delay:80ms]"
                style={{
                  width: `${share(second.totalBytes) * 100}%`,
                  background: "color-mix(in oklab, var(--ink) 45%, var(--track))",
                }}
              />
            ) : null}
            <span
              className="ds-growx min-w-1.5 flex-1 [animation-delay:160ms]"
              style={{ background: "color-mix(in oklab, var(--ink) 18%, var(--track))" }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-4">
            <span>
              <span className="text-ink-2">{top.label}</span>{" "}
              <span className="num">{formatBytes(top.totalBytes)}</span>
            </span>
            {second ? (
              <span>
                <span className="text-ink-2">{second.label}</span>{" "}
                <span className="num">{formatBytes(second.totalBytes)}</span>
              </span>
            ) : null}
            {restBytes > 0 ? (
              <span className="text-ink-3">
                나머지 <span className="num">{formatBytes(restBytes)}</span>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="storage-detail"
            onClick={() => setOpen((o) => !o)}
            className="mt-2 flex w-full cursor-pointer items-center justify-between border-0 border-b border-line bg-transparent py-3 text-left text-[13px] text-ink-2 hover:text-ink"
          >
            <span>
              항목별 ·{" "}
              <span className="tabular-nums">{formatCount(data?.grandTotalRows ?? 0)}</span>행
              {data?.calculatedAt ? ` · ${formatRelative(data.calculatedAt, now)} 계산` : ""}
            </span>
            <Chevron />
          </button>
          <Disclosure open={open} id="storage-detail">
            <ul className="m-0 flex list-none flex-col p-0 py-1">
              {cats.map((c) => (
                <li
                  key={c.category}
                  className="grid grid-cols-[minmax(0,1fr)_84px_76px] gap-2 border-b border-line py-2.5 text-[13px] leading-5"
                >
                  <span className="truncate">
                    {c.label}
                    <span className="text-ink-3"> · 테이블 {c.tables.length}개</span>
                  </span>
                  <span className="num text-right text-ink-2">{formatCount(c.totalRows)}</span>
                  <span className="num text-right">{formatBytes(c.totalBytes)}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </>
      )}
    </section>
  );
}

// ── 위험 구역 ───────────────────────────────────────────────────────────────

type DangerAction = "owntracks" | "trips" | "account";

const DANGER_COPY: Record<DangerAction, { title: string; description: string; confirm: string }> = {
  owntracks: {
    title: "OwnTracks 키를 삭제할까요?",
    description: "휴대폰 앱이 더 이상 위치를 보낼 수 없어요. 저장된 위치 기록은 그대로 남아요.",
    confirm: "키 삭제",
  },
  trips: {
    title: "자동 감지 여행을 다시 만들까요?",
    description:
      "자동으로 감지된 여행을 최신 판정 규칙으로 다시 감지해 교체해요. 직접 만든 여행은 유지돼요.",
    confirm: "다시 만들기",
  },
  account: {
    title: "계정과 모든 기록을 삭제할까요?",
    description:
      "커밋·위치·소비·건강 기록과 연결 정보, 로그인 세션이 모두 지워지고 되돌릴 수 없어요.",
    confirm: "영구 삭제",
  },
};

async function regenerateTrips() {
  const response = await fetch("/api/settings/trip-regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    inserted?: number;
    replaced?: number;
  };
  if (!response.ok) throw new Error(data.error ?? "자동 여행을 다시 만들지 못했어요.");
  toast.success(
    `자동 여행 ${data.inserted ?? 0}건을 만들고 기존 ${data.replaced ?? 0}건을 교체했어요.`
  );
}

async function deleteAccount() {
  const response = await fetch("/api/auth/disconnect", { method: "DELETE" });
  if (!response.ok) throw new Error("계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
  await authClient.signOut().catch(() => undefined);
  window.location.assign("/login");
}

const DANGER_BTN =
  "h-10 w-full justify-center bg-transparent text-danger shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_36%,transparent)] hover:bg-danger-soft hover:text-danger";

function DangerZone({
  hasOwnTracksKey,
  onChanged,
}: {
  hasOwnTracksKey: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<DangerAction | null>(null);
  const [busy, setBusy] = useState(false);
  const owntracks = useOwnTracksKey(hasOwnTracksKey);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending === "owntracks") {
        if (!(await owntracks.revoke())) throw new Error("API 키를 삭제하지 못했어요.");
        toast.success("OwnTracks 키가 삭제됐어요.");
        onChanged();
      } else if (pending === "trips") {
        await regenerateTrips();
      } else {
        await deleteAccount();
        return;
      }
      setPending(null);
    } catch (error) {
      toast.error(userErrorMessage(error, "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="danger"
      className="ds-enter order-5 flex flex-col [animation-delay:400ms]"
    >
      <SectionTitle id="danger">위험 구역</SectionTitle>
      <p className="m-0 mb-3.5 text-[13px] leading-5 text-ink-3">
        되돌릴 수 없어요. 누르면 한 번 더 확인해요.
      </p>
      <div className="flex flex-col gap-2">
        {hasOwnTracksKey ? (
          <Button variant="ghost" className={DANGER_BTN} onClick={() => setPending("owntracks")}>
            OwnTracks 키 삭제
          </Button>
        ) : null}
        <Button variant="ghost" className={DANGER_BTN} onClick={() => setPending("trips")}>
          자동 감지 여행 다시 만들기
        </Button>
        <Button variant="ghost" className={DANGER_BTN} onClick={() => setPending("account")}>
          계정과 모든 기록 삭제
        </Button>
      </div>
      <Dialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent>
          {pending ? (
            <>
              <DialogHeader>
                <DialogTitle>{DANGER_COPY[pending].title}</DialogTitle>
                <DialogDescription>{DANGER_COPY[pending].description}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
                  취소
                </Button>
                <Button variant="destructive" onClick={run} disabled={busy}>
                  {busy ? "처리 중…" : DANGER_COPY[pending].confirm}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── 관리 live status ────────────────────────────────────────────────────────

interface SavedPlaceRow {
  name: string;
  excludeFromTrips: boolean;
}
interface AccountRoleRow {
  transactionCount: number | string;
  role: "default" | "spending" | "ignore";
}

/** Data-bearing subtitles for the 관리 rows; each falls back to static copy. */
function useManageStatus(enabled: boolean, hasToss: boolean) {
  const places = useQuery<{ places: SavedPlaceRow[] }>({
    queryKey: ["saved-places-summary"],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/saved-places", { signal });
      if (!response.ok) throw new Error("saved places");
      return response.json();
    },
  });
  const roles = useQuery<{ accounts: AccountRoleRow[] }>({
    queryKey: ["account-roles-summary"],
    enabled: enabled && hasToss,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/settings/account-roles", { signal });
      if (!response.ok) throw new Error("account roles");
      return response.json();
    },
  });
  const location = useQuery<LocationSummary>({
    queryKey: ["location-summary"],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/settings/location-summary", { signal });
      if (!response.ok) throw new Error("location summary");
      return response.json();
    },
  });

  const placeList = places.data?.places;
  const excluded = placeList?.filter((p) => p.excludeFromTrips).length ?? 0;
  const placesMeta = placeList
    ? placeList.length === 0
      ? "아직 없음 · 집·회사를 저장하면 방문에 이름이 붙어요"
      : `${placeList.map((p) => p.name).join(" · ")} — ${excluded > 0 ? `여행 제외 ${excluded}곳` : "여행 제외 없음"}`
    : null;

  const accounts = roles.data?.accounts;
  const suspect = accounts?.filter((a) => isSuspectAccount(a)).length ?? 0;
  const rolesMeta = accounts
    ? {
        text: join(
          `${formatCount(accounts.length)}개`,
          suspect > 0 && `거래 1건뿐인 이름 ${suspect}개 확인 필요`
        ),
        warn: suspect > 0,
      }
    : null;

  const loc = location.data;
  const locationMeta = loc
    ? {
        text: join(
          `${formatCount(loc.processedDays)}일 처리`,
          loc.failedDays > 0 && `실패 ${formatCount(loc.failedDays)}일`,
          `이상치 ${formatCount(loc.anomalies)}개`
        ),
        warn: loc.failedDays > 0,
      }
    : null;

  return { placesMeta, roles: rolesMeta, locationMeta, location: loc ?? null };
}
