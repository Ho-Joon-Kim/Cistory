"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MapPin, AlertTriangle, CheckCircle2, Loader2, Shield, Navigation, Car } from "lucide-react";
import { toast } from "sonner";

interface DryRunResult {
  hasData: boolean;
  dateRange: { earliest: string; latest: string; totalDays: number };
  anomaly: { totalPoints: number; scanned: number; unscanned: number; anomaliesFound: number; needsBackfill: boolean };
  visits: { totalDays: number; daysProcessed: number; daysRemaining: number; needsBackfill: boolean };
  transport: { totalDays: number; daysProcessed: number; daysRemaining: number; needsBackfill: boolean };
  geocoding: { uncachedTotal: number; uncachedKorea: number; uncachedOverseas: number; provider: string };
  warnings: string[];
  totalSteps: number;
}

interface ProgressEvent {
  phase: "anomaly" | "visits" | "transport" | "done" | "error";
  day?: string;
  detail?: string;
  progress: number;
  completedSteps?: number;
  totalSteps?: number;
  totalAnomalies?: number;
  totalVisits?: number;
  totalSegments?: number;
  error?: string;
}

const PHASE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  anomaly: { label: "이상치 탐지", icon: <Shield className="h-3.5 w-3.5" /> },
  visits: { label: "방문 감지", icon: <Navigation className="h-3.5 w-3.5" /> },
  transport: { label: "교통수단 감지", icon: <Car className="h-3.5 w-3.5" /> },
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
      toast.error("백필 분석에 실패했습니다");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDryRun();
  }, [fetchDryRun]);

  const runBackfill = async () => {
    setIsRunning(true);
    setProgress(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/settings/location-backfill", {
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
                `백필 완료: 이상치 ${event.totalAnomalies}건, 방문 ${event.totalVisits}건, 교통수단 ${event.totalSegments}건`,
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

  const needsAny =
    dryRun?.anomaly.needsBackfill ||
    dryRun?.visits.needsBackfill ||
    dryRun?.transport.needsBackfill;

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
            {/* Date range */}
            <div className="text-sm text-muted-foreground">
              {dryRun.dateRange.earliest} ~ {dryRun.dateRange.latest} ({dryRun.dateRange.totalDays}일, {dryRun.anomaly.totalPoints.toLocaleString()}개 포인트)
            </div>

            {/* Warnings */}
            {dryRun.warnings.length > 0 && (
              <div className="space-y-2">
                {dryRun.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Status items */}
            <div className="space-y-2">
              <StatusRow
                icon={<Shield className="h-4 w-4" />}
                label="이상치 탐지"
                done={!dryRun.anomaly.needsBackfill}
                detail={
                  dryRun.anomaly.needsBackfill
                    ? `${dryRun.anomaly.unscanned.toLocaleString()}개 미스캔`
                    : `${dryRun.anomaly.anomaliesFound.toLocaleString()}개 이상치 감지됨`
                }
              />
              <StatusRow
                icon={<Navigation className="h-4 w-4" />}
                label="방문 감지"
                done={!dryRun.visits.needsBackfill}
                detail={
                  dryRun.visits.needsBackfill
                    ? `${dryRun.visits.daysRemaining}일 미처리 (geocoding: 국내 ${dryRun.geocoding.uncachedKorea} + 해외 ${dryRun.geocoding.uncachedOverseas}건)`
                    : `${dryRun.visits.daysProcessed}일 처리 완료`
                }
              />
              <StatusRow
                icon={<Car className="h-4 w-4" />}
                label="교통수단 감지"
                done={!dryRun.transport.needsBackfill}
                detail={
                  dryRun.transport.needsBackfill
                    ? `${dryRun.transport.daysRemaining}일 미처리`
                    : `${dryRun.transport.daysProcessed}일 처리 완료`
                }
              />
            </div>

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

            {/* Action / Complete */}
            {!isRunning && needsAny && (
              <Button onClick={runBackfill} className="w-full">
                전체 백필 실행
              </Button>
            )}

            {!isRunning && !needsAny && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                모든 백필이 완료되었습니다
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({
  icon,
  label,
  done,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  done: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className={done ? "text-green-500" : "text-muted-foreground"}>{icon}</div>
      <span className="font-medium w-24">{label}</span>
      <span className={`text-xs ${done ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
        {done ? "✓ " : ""}{detail}
      </span>
    </div>
  );
}
