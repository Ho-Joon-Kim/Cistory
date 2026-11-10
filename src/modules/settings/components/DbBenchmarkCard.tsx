"use client";

import { ChevronDown, ChevronUp, Loader2, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { type BenchmarkItem, type BenchmarkRun, useDbBenchmark } from "../hooks";

function getLatencyColor(ms: number): string {
  if (ms < 5) return "text-success";
  if (ms < 20) return "text-warning";
  return "text-destructive";
}

function getBarColor(ms: number): string {
  if (ms < 5) return "bg-success";
  if (ms < 20) return "bg-warning";
  return "bg-destructive";
}

function StatsRow({
  item,
  maxMs,
  compareItem,
}: {
  item: BenchmarkItem;
  maxMs: number;
  compareItem?: BenchmarkItem;
}) {
  const barWidth = maxMs > 0 ? (item.stats.mean / maxMs) * 100 : 0;
  const diff = compareItem
    ? ((item.stats.mean - compareItem.stats.mean) / compareItem.stats.mean) * 100
    : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground w-24 shrink-0">{item.label}</span>
        <div className="flex-1 mx-3 h-5 bg-muted rounded overflow-hidden relative">
          <div
            className={`h-full ${getBarColor(item.stats.mean)} rounded transition-[width] duration-300 ease-out`}
            style={{ width: `${Math.max(barWidth, 2)}%` }}
          />
        </div>
        <span
          className={`tabular-nums font-medium w-20 text-right ${getLatencyColor(item.stats.mean)}`}
        >
          {item.stats.mean.toFixed(2)}ms
        </span>
        {diff !== null && (
          <span
            className={`tabular-nums text-xs w-16 text-right ${
              diff < 0 ? "text-success" : diff > 0 ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {diff > 0 ? "+" : ""}
            {diff.toFixed(0)}%
          </span>
        )}
      </div>
      <div className="flex gap-3 text-xs text-muted-foreground pl-24 ml-3">
        <span>min {item.stats.min.toFixed(2)}</span>
        <span>med {item.stats.median.toFixed(2)}</span>
        <span>p95 {item.stats.p95.toFixed(2)}</span>
        <span>max {item.stats.max.toFixed(2)}</span>
      </div>
    </div>
  );
}

function BenchmarkResultView({
  run,
  compareRun,
}: {
  run: BenchmarkRun;
  compareRun?: BenchmarkRun;
}) {
  const maxMs = Math.max(...run.benchmarks.map((b) => b.stats.mean), 1);

  const compareMap = compareRun
    ? new Map(compareRun.benchmarks.map((b) => [b.name, b]))
    : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{run.dbHost}</span>
        <span>{formatRelativeTime(run.timestamp)}</span>
      </div>
      {run.benchmarks.map((item) => (
        <StatsRow
          key={item.name}
          item={item}
          maxMs={maxMs}
          compareItem={compareMap?.get(item.name)}
        />
      ))}
    </div>
  );
}

function HistoryItem({
  run,
  isSelected,
  onSelect,
  onDelete,
}: {
  run: BenchmarkRun;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const totalMean =
    run.benchmarks.reduce((sum, b) => sum + b.stats.mean, 0) / run.benchmarks.length;

  return (
    // biome-ignore lint/a11y/useSemanticElements: can't use <button> because row contains a nested <button type="button"> delete action (invalid HTML: button inside button)
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-sm cursor-pointer transition-colors ${
        isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="font-mono text-xs text-muted-foreground truncate flex-1" title={run.dbHost}>
        {run.dbHost}
      </span>
      <span className={`tabular-nums text-xs font-medium ${getLatencyColor(totalMean)}`}>
        avg {totalMean.toFixed(1)}ms
      </span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatRelativeTime(run.timestamp)}
      </span>
      <button
        type="button"
        aria-label={`${run.dbHost} 벤치마크 기록 삭제`}
        className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}

export function DbBenchmarkCard() {
  const { isRunning, currentResult, history, error, runBenchmark, deleteRun, clearHistory } =
    useDbBenchmark();
  const [compareId, setCompareId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const compareRun = compareId ? history.find((r) => r.id === compareId) : undefined;
  const displayResult = currentResult ?? history[0] ?? null;

  const handleRun = async () => {
    const result = await runBenchmark();
    if (result) {
      toast.success("벤치마크 측정이 완료됐어요.");
      setCompareId(null);
    } else {
      toast.error("벤치마크를 실행하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleSelectCompare = (id: string) => {
    setCompareId((prev) => (prev === id ? null : id));
  };

  return (
    <Card className="select-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-lg">DB 성능 벤치마크</CardTitle>
          <CardDescription>데이터베이스 쿼리 응답 속도를 측정해요</CardDescription>
        </div>
        <Button onClick={handleRun} disabled={isRunning} size="sm">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <span className="ml-1.5">{isRunning ? "측정 중…" : "벤치마크 실행"}</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {isRunning && (
          <div
            role="status"
            className="flex flex-col items-center justify-center py-8 text-muted-foreground"
          >
            <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin mb-2" />
            <p className="text-sm">6개 항목 × 11회 (워밍업 포함) 측정 중…</p>
          </div>
        )}

        {!isRunning && displayResult && (
          <BenchmarkResultView run={displayResult} compareRun={compareRun} />
        )}

        {!isRunning && !displayResult && !error && (
          <p className="text-sm text-muted-foreground text-center py-6">
            벤치마크를 실행하여 DB 응답 속도를 측정하세요
          </p>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="border-t pt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
              aria-expanded={showHistory}
              aria-controls="db-benchmark-history"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span>기록 ({history.length}건)</span>
              {compareRun && (
                <span
                  className="ml-auto min-w-0 truncate text-xs text-primary"
                  title={compareRun.dbHost}
                >
                  비교 중: {compareRun.dbHost}
                </span>
              )}
            </button>

            {showHistory && (
              <div id="db-benchmark-history" className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground mb-2">
                  항목을 클릭하면 현재 결과와 비교해요
                </p>
                {history.map((run) => (
                  <HistoryItem
                    key={run.id}
                    run={run}
                    isSelected={compareId === run.id}
                    onSelect={() => handleSelectCompare(run.id)}
                    onDelete={() => deleteRun(run.id)}
                  />
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `벤치마크 기록 ${history.length}건을 모두 삭제할까요? 삭제한 기록은 복구할 수 없어요.`
                      )
                    )
                      return;
                    clearHistory();
                    setCompareId(null);
                    toast.success("벤치마크 기록이 삭제됐어요.");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  기록 전체 삭제
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
