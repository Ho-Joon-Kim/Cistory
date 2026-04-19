"use client";

import { Code2, Focus, FolderGit2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ContextSwitchingMetrics } from "../types";

interface ContextSwitchingCardProps {
  metrics: ContextSwitchingMetrics;
}

export function ContextSwitchingCard({ metrics }: ContextSwitchingCardProps) {
  const scoreColor =
    metrics.focusScore >= 70
      ? "text-green-600 dark:text-green-400"
      : metrics.focusScore >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">집중도</h3>

        <div className="flex items-center gap-3 mb-4">
          <Focus className="h-5 w-5 text-violet-500" />
          <span className={`text-3xl font-bold ${scoreColor}`}>{metrics.focusScore}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>

        <Progress value={metrics.focusScore} className="mb-4 h-2" />

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FolderGit2 className="h-4 w-4" />
              <span>하루 평균 프로젝트</span>
            </div>
            <span className="font-medium">{metrics.avgDailyProjects}개</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Code2 className="h-4 w-4" />
              <span>하루 평균 언어</span>
            </div>
            <span className="font-medium">{metrics.avgDailyLanguages}개</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
