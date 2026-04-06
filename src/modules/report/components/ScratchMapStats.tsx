"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";

interface ScratchMapStatsProps {
  totalRegions: number;
  totalCells: number;
  regions: { name: string; visits: number }[];
}

export function ScratchMapStats({ totalRegions, totalCells, regions }: ScratchMapStatsProps) {
  const topTen = regions.slice(0, 10);
  const maxVisits = topTen.length > 0 ? topTen[0].visits : 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-green-600" />
          방문 지도
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1 mb-4">
          <span className="text-2xl font-bold">{totalRegions}</span>
          <span className="text-sm text-muted-foreground">개 지역 방문</span>
          <span className="text-xs text-muted-foreground ml-2">
            ({totalCells.toLocaleString()}개 셀)
          </span>
        </div>

        {topTen.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              자주 방문한 지역 TOP {topTen.length}
            </p>
            <div className="space-y-1.5">
              {topTen.map((region, idx) => (
                <div key={region.name} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-4 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm truncate">{region.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {region.visits.toLocaleString()}회
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${(region.visits / maxVisits) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
