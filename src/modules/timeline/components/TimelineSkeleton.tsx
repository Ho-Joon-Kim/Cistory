"use client";

import { Card, CardContent } from "@/components/ui/card";

export function TimelineSkeleton() {
  return (
    <div className="relative">
      {/* 타임라인 세로선 */}
      <div className="absolute left-4 md:left-6 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-8">
        {/* 날짜 그룹 스켈레톤 */}
        {[1, 2].map((group) => (
          <div key={group}>
            {/* 날짜 헤더 */}
            <div className="relative flex items-center mb-4">
              <div className="absolute left-2 md:left-4 w-4 h-4 rounded-full bg-muted animate-pulse" />
              <div className="ml-10 md:ml-14 h-4 w-24 bg-muted rounded animate-pulse" />
            </div>

            {/* 커밋 카드 스켈레톤 */}
            <div className="space-y-3 ml-10 md:ml-14">
              {[1, 2, 3].map((item) => (
                <Card key={item}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* 아바타 */}
                      <div className="h-8 w-8 rounded-full bg-muted animate-pulse flex-shrink-0" />

                      <div className="flex-1 min-w-0 space-y-2">
                        {/* 작성자 & 시간 */}
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                        </div>

                        {/* 레포지토리 */}
                        <div className="h-3 w-32 bg-muted rounded animate-pulse" />

                        {/* 메시지 */}
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />

                        {/* 통계 */}
                        <div className="flex items-center gap-3">
                          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-12 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-12 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                        </div>
                      </div>

                      {/* 확장 버튼 */}
                      <div className="h-8 w-8 bg-muted rounded animate-pulse flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
