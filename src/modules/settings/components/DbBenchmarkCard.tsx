"use client";

import { ChevronDown, ChevronUp, Loader2, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { type BenchmarkItem, type BenchmarkRun, useDbBenchmark } from "../hooks";

function getLatencyColor(ms: number): string {
  if (ms < 5) return "text-emerald-500";
  if (ms < 20) return "text-amber-500";
  return "text-red-500";
}

function getBarColor(ms: number): string {
  if (ms < 5) return "bg-emerald-500";
  if (ms < 20) return "bg-amber-500";
  return "bg-red-500";
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
            className={`h-full ${getBarColor(item.stats.mean)} rounded transition-all duration-300`}
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
              diff < 0 ? "text-emerald-500" : diff > 0 ? "text-red-500" : "text-muted-foreground"
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
      <span className="font-mono text-xs text-muted-foreground truncate flex-1">{run.dbHost}</span>
      <span className={`tabular-nums text-xs font-medium ${getLatencyColor(totalMean)}`}>
        avg {totalMean.toFixed(1)}ms
      </span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatRelativeTime(run.timestamp)}
      </span>
      <button
        type="button"
        className="p-0.5 text-muted-foreground/50 hover:text-destructive transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3 w-3" />
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
      toast.success("벤치마크 완료");
      setCompareId(null);
    } else {
      toast.error("벤치마크 실행에 실패했습니다");
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
          <CardDescription>데이터베이스 쿼리 응답 속도를 측정합니다</CardDescription>
        </div>
        <Button onClick={handleRun} disabled={isRunning} size="sm">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <span className="ml-1.5">{isRunning ? "측정 중..." : "벤치마크 실행"}</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {isRunning && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <p className="text-sm">6개 항목 x 11회 (warm-up 포함) 실행 중...</p>
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
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span>히스토리 ({history.length}건)</span>
              {compareRun && (
                <span className="ml-auto text-xs text-primary">비교 중: {compareRun.dbHost}</span>
              )}
            </button>

            {showHistory && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground mb-2">
                  항목을 클릭하면 현재 결과와 비교합니다
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
                    clearHistory();
                    setCompareId(null);
                    toast.success("히스토리가 삭제되었습니다");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  전체 삭제
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
