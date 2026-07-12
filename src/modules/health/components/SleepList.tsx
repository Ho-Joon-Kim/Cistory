"use client";

import { Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthSleepSession } from "@/modules/health/types";

const DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

export function SleepList({ sessions }: { sessions: HealthSleepSession[] }) {
  if (!sessions?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">최근 수면</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {sessions.map((s) => {
          const d = new Date(s.start);
          return (
            <div key={s.start} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500">
                <Moon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{duration(s.minutes)}</div>
                <div className="text-xs text-muted-foreground">
                  {DATE_FMT.format(d)} {TIME_FMT.format(d)} 취침
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
