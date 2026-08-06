"use client";

import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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

const PHASE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  anomaly: { label: "이상치 탐지", icon: <Shield className="h-3.5 w-3.5" /> },
  visits: { label: "방문 감지", icon: <Navigation className="h-3.5 w-3.5" /> },
  tracks: { label: "교통수단 감지", icon: <Car className="h-3.5 w-3.5" /> },
  enrich: { label: "장소 정보 적용", icon: <MapPin className="h-3.5 w-3.5" /> },
  trips: { label: "여행 감지", icon: <Navigation className="h-3.5 w-3.5" /> },
};

export function LocationBackfillCard() {
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDryRun = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings/location-backfill");
      if (!res.ok) throw new Error();
      setDryRun(await res.json());
    } catch {
      toast.error("백필 분석에 실패했습니다");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDryRun();
  }, [fetchDryRun]);

  const runBackfill = async (scope: "past" | "today" | "all") => {
    setIsRunning(true);
    setProgress(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/settings/location-backfill?scope=${scope}`, {
        method: "POST",
        signal: abort.signal,
      });

      if (!res.ok || !res.body) throw new Error("백필 시작 실패");

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
                `백필 완료: 이상치 ${event.totalAnomalies}건, 방문 ${event.totalVisits}건, 교통수단 ${event.totalSegments}건`
              );
              fetchDryRun();
            } else if (event.phase === "error") {
              toast.error(`백필 실패: ${event.error}`);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error("백필 실행에 실패했습니다");
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">위치 데이터 백필</CardTitle>
              <CardDescription>
                이상치 탐지 → 방문 감지 → 교통수단 분류 순서로 처리합니다
              </CardDescription>
            </div>
          </div>
          {!isRunning && (
            <Button variant="ghost" size="sm" onClick={fetchDryRun} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "새로고침"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !dryRun && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            분석 중...
          </div>
        )}

        {dryRun && !dryRun.hasData && (
          <p className="text-sm text-muted-foreground">위치 데이터가 없습니다.</p>
        )}

        {dryRun?.hasData && (
          <>
            {/* Warnings */}
            {dryRun.warnings.length > 0 && (
              <div className="space-y-2">
                {dryRun.warnings.map((w) => (
                  <div
                    key={w}
                    className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {dryRun.past.needsBackfill ? (
              <BacklogView dryRun={dryRun} />
            ) : (
              <SuccessView dryRun={dryRun} />
            )}

            {/* Progress bar during execution */}
            {isRunning && progress && (
              <div className="space-y-2">
                <Progress value={progress.progress} className="h-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    {progress.phase !== "done" && progress.phase !== "error" && (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {PHASE_LABELS[progress.phase]?.icon}
                        <span>{PHASE_LABELS[progress.phase]?.label}</span>
                        {progress.day && <span className="text-foreground">{progress.day}</span>}
                        {progress.detail && <span>— {progress.detail}</span>}
                      </>
                    )}
                  </div>
                  <span>{progress.progress}%</span>
                </div>
              </div>
            )}

            {/* Actions */}
            {!isRunning && (
              <div className="space-y-2">
                {dryRun.past.needsBackfill && (
                  <Button onClick={() => runBackfill("past")} className="w-full">
                    과거 데이터 백필 실행 ({dryRun.past.daysRemaining}일)
                  </Button>
                )}
                {!dryRun.past.needsBackfill && dryRun.today.pending && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => runBackfill("today")}
                    className="w-full"
                  >
                    지금 처리하기
                  </Button>
                )}
              </div>
            )}

            {/* Collapsible details — only shown in success state */}
            {!dryRun.past.needsBackfill && (
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                  />
                  세부 상태 보기
                </button>
                {detailsOpen && (
                  <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    <DetailRow
                      icon={<Shield className="h-3.5 w-3.5" />}
                      label="이상치 탐지"
                      value={`${dryRun.past.daysProcessed}일 처리 · ${dryRun.anomaly.anomaliesFound.toLocaleString()}개 감지`}
                    />
                    <DetailRow
                      icon={<Navigation className="h-3.5 w-3.5" />}
                      label="방문 감지"
                      value={`${dryRun.past.daysProcessed}일 처리`}
                    />
                    <DetailRow
                      icon={<Car className="h-3.5 w-3.5" />}
                      label="교통수단 감지"
                      value={`${dryRun.past.daysProcessed}일 처리`}
                    />
                    <div className="pt-1.5 mt-1.5 border-t text-[11px]">
                      {dryRun.dateRange.earliest} ~ {dryRun.dateRange.latest} ·{" "}
                      {dryRun.anomaly.totalPoints.toLocaleString()}개 포인트
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SuccessView({ dryRun }: { dryRun: DryRunResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
        <div>
          <div className="font-medium text-green-700 dark:text-green-400">
            모든 과거 데이터가 처리되었습니다
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {dryRun.dateRange.earliest} ~{" "}
            {previousDateString(dryRun.dateRange.today, dryRun.dateRange.latest)} ·{" "}
            {dryRun.past.daysProcessed}일 처리 완료
          </div>
        </div>
      </div>

      {dryRun.today.pending && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <Clock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-foreground">
              오늘({dryRun.today.date}) 데이터 {dryRun.today.unscannedPoints.toLocaleString()}개는
              내일 01:00에 자동 처리됩니다
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BacklogView({ dryRun }: { dryRun: DryRunResult }) {
  const processed = dryRun.past.daysProcessed;
  const total = dryRun.past.totalDays;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {dryRun.dateRange.earliest} ~ {dryRun.dateRange.latest} · {dryRun.dateRange.totalDays}일 ·{" "}
        {dryRun.anomaly.totalPoints.toLocaleString()}개 포인트
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>과거 {dryRun.past.daysRemaining}일이 미처리 상태입니다</span>
      </div>

      <div className="space-y-2">
        <PhaseRow label="이상치 탐지" icon={<Shield className="h-4 w-4" />} pct={pct} />
        <PhaseRow label="방문 감지" icon={<Navigation className="h-4 w-4" />} pct={pct} />
        <PhaseRow label="교통수단 감지" icon={<Car className="h-4 w-4" />} pct={pct} />
      </div>

      <div className="text-xs text-muted-foreground">
        {processed}/{total}일 처리 완료
        {dryRun.today.pending && " · 오늘 데이터는 자동 처리됩니다"}
      </div>
    </div>
  );
}

function PhaseRow({ label, icon, pct }: { label: string; icon: React.ReactNode; pct: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="text-muted-foreground">{icon}</div>
      <span className="font-medium w-24">{label}</span>
      <Progress value={pct} className="h-1.5 flex-1" />
      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="w-20">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
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
