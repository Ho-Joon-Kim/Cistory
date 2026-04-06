"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MapPin } from "lucide-react";

export function ProductivityByLocation() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          장소별 생산성
        </CardTitle>
        <CardDescription>
          위치 데이터와 커밋 데이터의 교차 분석
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-48 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
          <MapPin className="h-8 w-8 opacity-50" />
          <p>위치 추적 기능이 활성화되면</p>
          <p>장소별 생산성을 분석할 수 있습니다</p>
        </div>
      </CardContent>
    </Card>
  );
}
