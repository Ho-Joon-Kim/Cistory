"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Flame } from "lucide-react";

interface StreakHighlightProps {
  maxStreak: number;
  activeDays: number;
  totalDays: number;
}

export function StreakHighlight({
  maxStreak,
  activeDays,
  totalDays,
}: StreakHighlightProps) {
  const participationRate =
    totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0;

  return (
    <Card
      className={cn(
        "!py-5 !gap-3 bg-gradient-to-br",
        "from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30",
        "border-amber-200 dark:border-amber-800",
      )}
    >
      <CardContent>
        <div className="flex items-center justify-between">
          {/* Streak number */}
          <div className="flex items-center gap-3">
            <Flame className="h-8 w-8 text-orange-500" />
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold tracking-tight text-orange-600 dark:text-orange-400">
                  {maxStreak}
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  일
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                연속 활동일
              </p>
            </div>
          </div>

          {/* Participation rate */}
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight">
              {participationRate}%
            </p>
            <p className="text-xs text-muted-foreground">
              참여율 ({activeDays}/{totalDays}일)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
