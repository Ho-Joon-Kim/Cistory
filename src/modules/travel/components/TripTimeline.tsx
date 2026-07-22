import { Clock3, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TravelTripVisit } from "../hooks";

export interface TripTimelineVisit extends TravelTripVisit {
  arrivalTime: string;
  displayName: string;
  durationLabel: string;
}

export interface TripTimelineGroup {
  dateKey: string;
  dateLabel: string;
  visits: TripTimelineVisit[];
}

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const KST_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "short",
});

function dateKeyToUtcMillis(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(millis).toISOString().slice(0, 10) === dateKey ? millis : null;
}

function enumerateDateKeys(startDate: string, endDate: string): string[] {
  const start = dateKeyToUtcMillis(startDate);
  const end = dateKeyToUtcMillis(endDate);
  if (start === null || end === null || end < start) return [];
  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  );
}

export function getKstDateKey(timestamp: string): string {
  const parts = KST_DATE_FORMATTER.formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatVisitDuration(durationSeconds: number): string {
  const totalMinutes = Math.max(1, Math.round(Math.max(0, durationSeconds) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function buildTripTimeline(
  startDate: string,
  endDate: string,
  visits: TravelTripVisit[]
): TripTimelineGroup[] {
  const groups = enumerateDateKeys(startDate, endDate).map((dateKey) => ({
    dateKey,
    dateLabel: DATE_LABEL_FORMATTER.format(new Date(`${dateKey}T00:00:00.000Z`)),
    visits: [] as TripTimelineVisit[],
  }));
  const groupByDate = new Map(groups.map((group) => [group.dateKey, group]));

  for (const visit of [...visits].sort(
    (left, right) => Date.parse(left.startTime) - Date.parse(right.startTime)
  )) {
    const group = groupByDate.get(getKstDateKey(visit.startTime));
    if (!group) continue;
    group.visits.push({
      ...visit,
      arrivalTime: KST_TIME_FORMATTER.format(new Date(visit.startTime)),
      displayName: visit.placeName?.trim() || visit.address?.trim() || "알 수 없는 장소",
      durationLabel: formatVisitDuration(visit.durationSeconds),
    });
  }

  return groups;
}

interface TripTimelineProps {
  startDate: string;
  endDate: string;
  visits: TravelTripVisit[];
}

export function TripTimeline({ startDate, endDate, visits }: TripTimelineProps) {
  const groups = buildTripTimeline(startDate, endDate, visits);

  return (
    <Card>
      <CardHeader>
        <CardTitle>일자별 방문지</CardTitle>
      </CardHeader>
      <CardContent className="space-y-7">
        {groups.map((group) => (
          <section key={group.dateKey} aria-labelledby={`travel-day-${group.dateKey}`}>
            <h3 id={`travel-day-${group.dateKey}`} className="text-sm font-semibold">
              {group.dateLabel}
            </h3>
            {group.visits.length === 0 ? (
              <p className="mt-3 border-l-2 border-muted pl-4 text-sm text-muted-foreground">
                방문 기록이 없습니다
              </p>
            ) : (
              <ol className="mt-3 space-y-4 border-l-2 border-muted pl-4">
                {group.visits.map((visit) => (
                  <li key={visit.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                    <p className="font-medium">{visit.displayName}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                        {visit.arrivalTime} 도착 · {visit.durationLabel}
                      </span>
                      {visit.city ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          {visit.city}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
