"use client";

import { Activity, Bike, Dumbbell, Footprints, Mountain, Waves } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthWorkout } from "@/modules/health/types";

// Activity-type icon (keyword match on the localized name + raw enum), warm accent.
const ICON_RULES: { match: RegExp; Icon: typeof Activity }[] = [
  { match: /bik|cycl|자전거/i, Icon: Bike },
  { match: /swim|수영/i, Icon: Waves },
  { match: /hik|mountain|climb|등산|하이킹/i, Icon: Mountain },
  { match: /strength|weight|workout|gym|근력|웨이트|헬스|기구|운동/i, Icon: Dumbbell },
  { match: /walk|run|걷기|걸음|러닝|달리기|조깅/i, Icon: Footprints },
];
function iconFor(w: HealthWorkout): typeof Activity {
  const hay = `${w.name ?? ""} ${w.type ?? ""}`;
  return ICON_RULES.find((r) => r.match.test(hay))?.Icon ?? Activity;
}

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
function whenLabel(iso: string): string {
  const d = new Date(iso);
  return `${DATE_FMT.format(d)} ${TIME_FMT.format(d)}`;
}

export function WorkoutList({ workouts }: { workouts: HealthWorkout[] }) {
  if (workouts.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">최근 운동</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {workouts.map((w) => {
          const Icon = iconFor(w);
          return (
            <div key={w.start} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{w.name ?? "운동"}</div>
                <div className="text-xs text-muted-foreground">{whenLabel(w.start)}</div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-base font-semibold tabular-nums">{w.minutes}</span>
                <span className="ml-1 text-xs text-muted-foreground">분</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
