"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, AlertTriangle, CheckCircle2, Loader2, Navigation, Car, Shield } from "lucide-react";
import { toast } from "sonner";

interface DryRunResult {
  hasData: boolean;
  dateRange: { earliest: string; latest: string; totalDays: number };
  anomaly: {
    totalPoints: number;
    scanned: number;
    unscanned: number;
    anomaliesFound: number;
    needsBackfill: boolean;
  };
  visits: {
    totalDays: number;
    daysProcessed: number;
    daysRemaining: number;
    needsBackfill: boolean;
  };
  transport: {
    totalDays: number;
    daysProcessed: number;
    daysRemaining: number;
    needsBackfill: boolean;
  };
  geocoding: {
    uncachedTotal: number;
    uncachedKorea: number;
    uncachedOverseas: number;
    provider: string;
  };
  warnings: string[];
}

type BackfillType = "anomaly" | "visits" | "transport" | "all";

export function LocationBackfillCard() {
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState<BackfillType | null>(null);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);

  const fetchDryRun = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings/location-backfill");
      if (!res.ok) throw new Error("분석 실패");
      const data = await res.json();
      setDryRun(data);
    } catch (e) {
      toast.error("백필 분석에 실패했습니다");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDryRun();
  }, [fetchDryRun]);

  const runBackfill = async (type: BackfillType) => {
    setIsRunning(type);
    setResults(null);
    try {
      const res = await fetch("/api/settings/location-backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error("백필 실패");
      const data = await res.json();
      setResults(data.results);
      toast.success("백필이 완료되었습니다");
      fetchDryRun(); // Refresh stats
    } catch (e) {
      toast.error("백필 실행에 실패했습니다");
    } finally {
      setIsRunning(null);
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
                과거 위치 데이터에 이상치 탐지, 방문 감지, 교통수단 분류를 적용합니다
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchDryRun} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "새로고침"}
          </Button>
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
            {/* Date range info */}
            <div className="text-sm text-muted-foreground">
              {dryRun.dateRange.earliest} ~ {dryRun.dateRange.latest} ({dryRun.dateRange.totalDays}일, {dryRun.anomaly.totalPoints.toLocaleString()}개 포인트)
            </div>

            {/* Warnings */}
            {dryRun.warnings.length > 0 && (
              <div className="space-y-2">
                {dryRun.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Backfill items */}
            <div className="space-y-3">
              {/* Anomaly Detection */}
              <BackfillItem
                icon={<Shield className="h-4 w-4" />}
                title="이상치 탐지"
                description={`GPS 노이즈 감지 (정확도 + 속도 샌드위치 테스트)`}
                stats={
                  dryRun.anomaly.needsBackfill
                    ? `${dryRun.anomaly.unscanned.toLocaleString()}개 포인트 미스캔`
                    : `완료 (${dryRun.anomaly.anomaliesFound.toLocaleString()}개 이상치 감지됨)`
                }
                needsBackfill={dryRun.anomaly.needsBackfill}
                isRunning={isRunning === "anomaly" || isRunning === "all"}
                onRun={() => runBackfill("anomaly")}
                result={results?.anomaly as Record<string, number> | undefined}
              />

              {/* Visit Detection */}
              <BackfillItem
                icon={<Navigation className="h-4 w-4" />}
                title="방문 감지"
                description={`체류 장소 탐지 + 역지오코딩 (미캐시 ${dryRun.geocoding.uncachedTotal.toLocaleString()}건: 국내 ${dryRun.geocoding.uncachedKorea.toLocaleString()} + 해외 ${dryRun.geocoding.uncachedOverseas.toLocaleString()})`}
                stats={
                  dryRun.visits.needsBackfill
                    ? `${dryRun.visits.daysRemaining}일 / ${dryRun.visits.totalDays}일 미처리`
                    : `완료 (${dryRun.visits.daysProcessed}일 처리됨)`
                }
                needsBackfill={dryRun.visits.needsBackfill}
                isRunning={isRunning === "visits" || isRunning === "all"}
                onRun={() => runBackfill("visits")}
                result={results?.visits as Record<string, number> | undefined}
              />

              {/* Transportation Mode */}
              <BackfillItem
                icon={<Car className="h-4 w-4" />}
                title="교통수단 감지"
                description="속도/가속도 패턴 기반 이동 수단 분류"
                stats={
                  dryRun.transport.needsBackfill
                    ? `${dryRun.transport.daysRemaining}일 / ${dryRun.transport.totalDays}일 미처리`
                    : `완료 (${dryRun.transport.daysProcessed}일 처리됨)`
                }
                needsBackfill={dryRun.transport.needsBackfill}
                isRunning={isRunning === "transport" || isRunning === "all"}
                onRun={() => runBackfill("transport")}
                result={results?.transport as Record<string, number> | undefined}
              />
            </div>

            {/* Run All button */}
            {needsAny && (
              <Button
                onClick={() => runBackfill("all")}
                disabled={isRunning !== null}
                className="w-full"
              >
                {isRunning === "all" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    전체 백필 실행 중...
                  </>
                ) : (
                  "전체 백필 실행"
                )}
              </Button>
            )}

            {!needsAny && (
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

function BackfillItem({
  icon,
  title,
  description,
  stats,
  needsBackfill,
  isRunning,
  onRun,
  result,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  stats: string;
  needsBackfill: boolean;
  isRunning: boolean;
  onRun: () => void;
  result?: Record<string, number>;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
          <div className={`text-xs mt-1 ${needsBackfill ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
            {stats}
          </div>
          {result && (
            <div className="text-xs text-green-600 dark:text-green-400 mt-1">
              결과: {Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(", ")}
            </div>
          )}
        </div>
      </div>
      {needsBackfill && (
        <Button variant="outline" size="sm" onClick={onRun} disabled={isRunning} className="shrink-0 ml-2">
          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "실행"}
        </Button>
      )}
    </div>
  );
}
