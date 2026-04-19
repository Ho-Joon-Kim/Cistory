"use client";

import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProductivityByLocation() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>장소별 생산성</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <MapPin className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">장소별 생산성 분석은 위치 데이터가 필요합니다</p>
          <p className="text-xs mt-1">OwnTracks 연동 후 데이터가 쌓이면 자동으로 분석됩니다</p>
        </div>
      </CardContent>
    </Card>
  );
}
