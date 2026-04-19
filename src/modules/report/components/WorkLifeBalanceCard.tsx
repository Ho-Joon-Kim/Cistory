"use client";

import { CalendarDays, Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { WorkLifeBalanceMetrics } from "../types";

interface WorkLifeBalanceCardProps {
  metrics: WorkLifeBalanceMetrics;
}

export function WorkLifeBalanceCard({ metrics }: WorkLifeBalanceCardProps) {
  const scoreColor =
    metrics.balanceScore >= 70
      ? "text-green-600 dark:text-green-400"
      : metrics.balanceScore >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">워크라이프 밸런스</h3>

        <div className="flex items-center gap-3 mb-4">
          <span className={`text-3xl font-bold ${scoreColor}`}>{metrics.balanceScore}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>

        <Progress value={metrics.balanceScore} className="mb-4 h-2" />

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Moon className="h-4 w-4" />
              <span>야간 커밋 (22시~6시)</span>
            </div>
            <span className="font-medium">{Math.round(metrics.nightCommitRatio * 100)}%</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>주말 커밋</span>
            </div>
            <span className="font-medium">{Math.round(metrics.weekendCommitRatio * 100)}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
