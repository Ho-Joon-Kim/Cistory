"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { PanelActions, PanelNote, PanelStats, PanelText } from "./panel";

interface DryRunResult {
  hasData: boolean;
  dateRange: { earliest: string; latest: string; totalDays: number; today: string };
  past: {
    totalDays: number;
    daysProcessed: number;
    daysRemaining: number;
    needsBackfill: boolean;
  };
  today: {
    date: string;
    unscannedPoints: number;
    pending: boolean;
  };
  anomaly: {
    totalPoints: number;
    anomaliesFound: number;
  };
  geocoding: {
    uncachedTotal: number;
    uncachedKorea: number;
    uncachedOverseas: number;
    provider: string;
  };
  warnings: string[];
  totalSteps: number;
}

interface ProgressEvent {
  phase: "anomaly" | "visits" | "tracks" | "enrich" | "trips" | "done" | "error";
  day?: string;
  detail?: string;
  progress: number;
  totalAnomalies?: number;
  totalVisits?: number;
  totalTracks?: number;
  totalSegments?: number;
  totalTrips?: number;
  pointsEnriched?: number;
  error?: string;
}

const PHASE_LABELS: Record<string, string> = {
  anomaly: "이상치 탐지",
  visits: "방문 감지",
  tracks: "교통수단 감지",
  enrich: "장소 정보 적용",
  trips: "여행 감지",
};

export function LocationBackfillCard() {
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDryRun = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings/location-backfill");
      if (!res.ok) throw new Error();
      setDryRun(await res.json());
    } catch {
      toast.error("처리 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDryRun();
  }, [fetchDryRun]);

  const runBackfill = async (scope: "past" | "today" | "all", confirmMessage: string) => {
    if (!window.confirm(confirmMessage)) return;
    setIsRunning(true);
    setProgress(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/settings/location-backfill?scope=${scope}`, {
        method: "POST",
        signal: abort.signal,
      });

      if (!res.ok || !res.body) throw new Error("과거 데이터 처리를 시작하지 못했어요.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6));
            setProgress(event);

            if (event.phase === "done") {
              toast.success(
                `위치 데이터 처리가 완료됐어요. 이상치 ${event.totalAnomalies}건, 방문 ${event.totalVisits}건, 교통수단 ${event.totalSegments}건`
              );
              fetchDryRun();
            } else if (event.phase === "error") {
              toast.error("위치 데이터를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error("위치 데이터를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const geo = dryRun?.hasData ? dryRun.geocoding : null;
  return (
    <div className="flex flex-col gap-4">
      <PanelText>
        이상치 탐지 → 방문 감지 → 교통수단 분류 순서로 하루씩 처리해요. 매일 01:00에 전날이 자동으로
        처리돼요.
      </PanelText>

      {isLoading && !dryRun ? (
        <LoadingState variant="rows" rows={2} label="처리 상태를 확인하는 중" />
      ) : null}
      {dryRun && !dryRun.hasData ? <PanelText>아직 위치 기록이 없어요.</PanelText> : null}

      {dryRun?.hasData ? (
        <>
          {dryRun.warnings.map((w) => (
            <PanelNote key={w} tone="warn">
              {w}
            </PanelNote>
          ))}

          <PanelStats
            items={[
              {
                label: "처리한 날",
                value: dryRun.past.daysProcessed,
                unit: `/ ${formatCount(dryRun.past.totalDays)}일`,
              },
              {
                label: "남은 날",
                value: dryRun.past.daysRemaining,
                unit: "일",
                tone: dryRun.past.daysRemaining > 0 ? "warn" : "muted",
              },
              { label: "이상치", value: dryRun.anomaly.anomaliesFound, unit: "개" },
              { label: "좌표", value: dryRun.anomaly.totalPoints, unit: "개" },
            ]}
          />

          {dryRun.past.needsBackfill ? (
            <PanelNote tone="warn">
              과거 <span className="tabular-nums">{formatCount(dryRun.past.daysRemaining)}</span>
              일이 아직 처리되지 않았어요.
            </PanelNote>
          ) : (
            <PanelNote tone="brand">
              {formatDay(dryRun.dateRange.earliest)}부터{" "}
              {formatDay(previousDateString(dryRun.dateRange.today, dryRun.dateRange.latest))}까지
              모두 처리됐어요.
            </PanelNote>
          )}
          {dryRun.today.pending ? (
            <PanelNote>
              오늘 좌표{" "}
              <span className="tabular-nums">{formatCount(dryRun.today.unscannedPoints)}</span>
              개는 내일 01:00에 자동으로 처리돼요.
            </PanelNote>
          ) : null}
          {geo && geo.uncachedTotal > 0 ? (
            <PanelText className="text-ink-3">
              주소를 아직 조회하지 않은 좌표 칸{" "}
              <span className="tabular-nums">{formatCount(geo.uncachedTotal)}</span>곳(국내{" "}
              <span className="tabular-nums">{formatCount(geo.uncachedKorea)}</span> · 해외{" "}
              <span className="tabular-nums">{formatCount(geo.uncachedOverseas)}</span>)은
              지나가기만 한 곳이에요. 주소는 머문 곳(방문)만 조회해요.
            </PanelText>
          ) : null}

          {isRunning && progress ? (
            <div className="flex flex-col gap-2" role="status">
              <div className="h-1 rounded-full bg-track">
                <div
                  className="h-1 rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${Math.max(2, progress.progress)}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
                <span className="min-w-0 truncate">
                  {progress.phase !== "done" && progress.phase !== "error"
                    ? [
                        PHASE_LABELS[progress.phase],
                        progress.day,
                        progress.detail && `— ${progress.detail}`,
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : null}
                </span>
                <span className="tabular-nums">{progress.progress}%</span>
              </div>
            </div>
          ) : null}

          {!isRunning ? (
            <div className="flex flex-col gap-2.5">
              {dryRun.past.needsBackfill || dryRun.today.pending ? (
                <PanelText className="text-xs leading-[18px] text-ink-3">
                  처리하는 기간의 도로 경로·지하철 매칭 결과는 지워지고 자동으로 복구되지 않아요.
                </PanelText>
              ) : null}
              <PanelActions>
                {dryRun.past.needsBackfill ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      runBackfill(
                        "past",
                        `과거 ${dryRun.past.daysRemaining}일의 위치 데이터를 처리할까요? 이 기간의 도로 경로 매칭과 지하철 매칭 결과가 삭제되며 자동으로 복구되지 않아요.`
                      )
                    }
                  >
                    과거 {formatCount(dryRun.past.daysRemaining)}일 처리
                  </Button>
                ) : dryRun.today.pending ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      runBackfill(
                        "today",
                        "오늘 위치 데이터를 지금 처리할까요? 오늘의 도로 경로 매칭과 지하철 매칭 결과가 삭제되며 자동으로 복구되지 않아요."
                      )
                    }
                  >
                    오늘 데이터 지금 처리
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={fetchDryRun} disabled={isLoading}>
                  {isLoading ? "확인 중…" : "상태 다시 확인"}
                </Button>
              </PanelActions>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function formatDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}월 ${d}일`;
}

function previousDateString(today: string, latest: string): string {
  // Show the last fully-processed past day. If latest < today, all data is past;
  // otherwise show (today - 1).
  if (latest < today) return latest;
  const [y, m, d] = today.split("-").map(Number);
  const prev = new Date(y, m - 1, d - 1);
  const yy = prev.getFullYear();
  const mm = String(prev.getMonth() + 1).padStart(2, "0");
  const dd = String(prev.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
