"use client";

import { MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ScratchMapStatsProps {
  totalRegions: number;
  totalCells: number;
  regions: { name: string; visits: number }[];
}

export function ScratchMapStats({ totalRegions, totalCells, regions }: ScratchMapStatsProps) {
  const top10 = regions.slice(0, 10);
  const maxVisits = top10.length > 0 ? top10[0].visits : 1;

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">방문 통계</h3>
        </div>
        <div className="space-y-1 mb-4">
          <p className="text-2xl font-bold">{totalRegions}개 지역</p>
          <p className="text-xs text-muted-foreground">
            {totalCells.toLocaleString()}개 위치 포인트 기반
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">상위 방문 지역</p>
          {top10.map((region, i) => (
            <div key={region.name} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-4 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs truncate">{region.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {region.visits.toLocaleString()}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${(region.visits / maxVisits) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
