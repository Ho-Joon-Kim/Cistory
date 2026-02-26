"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Brain } from "lucide-react";
import type { DeepWorkSession } from "../types";

interface DeepWorkCardProps {
  sessions: DeepWorkSession[];
  stats: {
    totalSessions: number;
    avgDurationSeconds: number;
    totalDeepWorkSeconds: number;
  };
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function DeepWorkCard({ sessions, stats }: DeepWorkCardProps) {
  if (stats.totalSessions === 0) return null;

  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">딥워크 활동</h3>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-2xl font-bold">{stats.totalSessions}</p>
            <p className="text-xs text-muted-foreground">세션 수</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{formatDuration(stats.avgDurationSeconds)}</p>
            <p className="text-xs text-muted-foreground">평균 시간</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{formatDuration(stats.totalDeepWorkSeconds)}</p>
            <p className="text-xs text-muted-foreground">총 딥워크</p>
          </div>
        </div>

        {sessions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">최근 세션</p>
            {sessions.slice(0, 5).map((session) => (
              <div
                key={session.startedAt}
                className="flex items-center justify-between text-sm py-1 border-b last:border-0"
              >
                <div className="flex items-center gap-2">
                  <Brain className="h-3 w-3 text-violet-500" />
                  <span className="text-muted-foreground">{session.date}</span>
                  {session.project && (
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {session.project}
                    </span>
                  )}
                </div>
                <span className="font-medium">{formatDuration(session.durationSeconds)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
