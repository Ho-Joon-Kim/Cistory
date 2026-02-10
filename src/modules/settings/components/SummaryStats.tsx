"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

interface SummaryStatsData {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export function SummaryStats() {
  const [stats, setStats] = useState<SummaryStatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/summaries/process");
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch summary stats:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleProcessSummaries = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/summaries/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });

      if (response.ok) {
        toast.success("요약 생성이 시작되었습니다");
        // Refresh stats after a delay
        setTimeout(() => {
          fetchStats();
        }, 5000);
      } else {
        toast.error("요약 생성 시작에 실패했습니다");
      }
    } catch (error) {
      toast.error("요약 생성 시작에 실패했습니다");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AI 요약</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AI 요약</CardTitle>
          <CardDescription>
            동기화된 커밋이 없습니다
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const completionRate = Math.round((stats.completed / stats.total) * 100);
  const hasPending = stats.pending > 0 || stats.failed > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI 요약</CardTitle>
        <CardDescription>
          커밋에 대한 AI 요약 생성 상태를 관리합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>완료율</span>
            <span>{completionRate}% ({stats.completed}/{stats.total})</span>
          </div>
          <Progress value={completionRate} className="h-2" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <Clock className="h-4 w-4 text-yellow-500" />
            <div>
              <p className="text-sm font-medium">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">대기 중</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <Loader2 className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-sm font-medium">{stats.processing}</p>
              <p className="text-xs text-muted-foreground">처리 중</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{stats.completed}</p>
              <p className="text-xs text-muted-foreground">완료</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-sm font-medium">{stats.failed}</p>
              <p className="text-xs text-muted-foreground">실패</p>
            </div>
          </div>
        </div>

        {/* Action button */}
        {hasPending && (
          <Button
            onClick={handleProcessSummaries}
            disabled={isProcessing}
            className="w-full"
            variant="outline"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                처리 중...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                대기 중인 요약 생성 ({stats.pending + stats.failed}개)
              </>
            )}
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          요약은 백그라운드에서 생성됩니다. 완료까지 시간이 걸릴 수 있습니다.
        </p>
      </CardContent>
    </Card>
  );
}
