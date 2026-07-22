import { Bike, BusFront, CarFront, Footprints, Plane, Route, Ship, TrainFront } from "lucide-react";
import type { ComponentType } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TravelTripDetail } from "../hooks";

type TripTransport = TravelTripDetail["transport"];

const MODE_META: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
  stationary: { label: "정지", icon: Route },
  walking: { label: "도보", icon: Footprints },
  running: { label: "달리기", icon: Footprints },
  cycling: { label: "자전거", icon: Bike },
  driving: { label: "자동차", icon: CarFront },
  motorcycle: { label: "오토바이", icon: Bike },
  bus: { label: "버스", icon: BusFront },
  transit: { label: "대중교통", icon: BusFront },
  train: { label: "기차", icon: TrainFront },
  boat: { label: "선박", icon: Ship },
  flying: { label: "항공", icon: Plane },
  unknown: { label: "기타 이동", icon: Route },
};

export function formatDistance(distanceMeters: number): string {
  const safeDistance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  if (safeDistance < 1000) return `${Math.round(safeDistance).toLocaleString("ko-KR")} m`;
  const kilometers = safeDistance / 1000;
  const decimals = kilometers >= 100 || Number.isInteger(kilometers) ? 0 : 1;
  return `${kilometers.toLocaleString("ko-KR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  })} km`;
}

export function TripTransportCard({ transport }: { transport: TripTransport }) {
  const summedDistance = transport.modes.reduce(
    (total, mode) => total + Math.max(0, mode.distanceMeters),
    0
  );
  const compositionTotal = Math.max(transport.totalDistanceMeters, summedDistance, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="h-4 w-4" aria-hidden="true" />
          교통수단
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-xs text-muted-foreground">총 이동 거리</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {formatDistance(transport.totalDistanceMeters)}
          </p>
        </div>

        {transport.modes.length === 0 ? (
          <p className="text-sm text-muted-foreground">이동 기록이 없습니다</p>
        ) : (
          <ul className="space-y-4">
            {transport.modes.map((mode) => {
              const meta = MODE_META[mode.mode] ?? { label: mode.mode, icon: Route };
              const Icon = meta.icon;
              const share =
                compositionTotal > 0
                  ? Math.min(1, Math.max(0, mode.distanceMeters) / compositionTotal)
                  : 0;
              return (
                <li key={mode.mode}>
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {meta.label}
                      <span className="text-xs text-muted-foreground">{mode.segmentCount}구간</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatDistance(mode.distanceMeters)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
