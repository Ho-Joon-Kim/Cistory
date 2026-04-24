"use client";

import { ArrowLeftRight, TrainFront } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SubwayInsightsData } from "@/modules/location/services/subway-match/usage";

interface SubwayInsightsCardProps {
  data: SubwayInsightsData | null;
  isLoading: boolean;
}

function lineLabel(ref: string | null, name: string | null): string {
  if (ref) return /^\d+$/.test(ref) ? `${ref}호선` : ref;
  return name ?? "노선";
}

function formatKm(m: number): string {
  if (m === 0) return "0";
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function SubwayInsightsCard({ data, isLoading }: SubwayInsightsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrainFront className="h-4 w-4" /> 지하철 이용 패턴
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">불러오는 중…</CardContent>
      </Card>
    );
  }

  if (!data || data.totalLegs === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrainFront className="h-4 w-4" /> 지하철 이용 패턴
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          해당 기간에 매칭된 지하철 이용 기록이 없습니다.
        </CardContent>
      </Card>
    );
  }

  const maxRideCount = Math.max(...data.lineFrequency.map((l) => l.rideCount), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrainFront className="h-4 w-4" /> 지하철 이용 패턴
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground mb-4">
          올해 총 <span className="font-medium text-foreground">{data.totalSessions}</span>회 승차,{" "}
          <span className="font-medium text-foreground">{data.totalLegs}</span>구간
        </div>

        {data.lineFrequency.length > 0 && (
          <div className="mb-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              노선별 승차 빈도
            </div>
            <div className="space-y-1.5">
              {data.lineFrequency.map((line) => (
                <div key={line.lineId} className="flex items-center gap-2 text-sm">
                  <div className="w-16 shrink-0 truncate font-medium" style={{ color: line.color }}>
                    {lineLabel(line.ref, line.name)}
                  </div>
                  <div className="flex-1 h-4 bg-muted/40 rounded relative overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${(line.rideCount / maxRideCount) * 100}%`,
                        backgroundColor: line.color,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {line.rideCount}회 · {formatKm(line.totalDistanceMeters)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.transferPairs.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              자주 환승하는 패턴
            </div>
            <ul className="space-y-1.5 text-sm">
              {data.transferPairs.map((pair, idx) => (
                <li
                  key={`${pair.fromLineRef}-${pair.toLineRef}-${pair.stationName}-${idx}`}
                  className="flex items-center gap-2"
                >
                  <span
                    className="font-medium px-1.5 py-0.5 rounded"
                    style={{ color: pair.fromLineColor, borderColor: pair.fromLineColor, borderWidth: 1 }}
                  >
                    {lineLabel(pair.fromLineRef, pair.fromLineName)}
                  </span>
                  <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                  <span
                    className="font-medium px-1.5 py-0.5 rounded"
                    style={{ color: pair.toLineColor, borderColor: pair.toLineColor, borderWidth: 1 }}
                  >
                    {lineLabel(pair.toLineRef, pair.toLineName)}
                  </span>
                  <span className="text-muted-foreground">@ {pair.stationName}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {pair.count}회
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
