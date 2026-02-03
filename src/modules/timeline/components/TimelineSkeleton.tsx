"use client";

import { Card, CardContent } from "@/components/ui/card";

export function TimelineSkeleton() {
  return (
    <div className="relative space-y-4">
      {/* Continuous stepper line */}
      <div className="absolute left-[15px] md:left-[23px] top-0 bottom-0 w-0.5 bg-muted-foreground/20 rounded-full" />

      {/* Selected date group skeleton */}
      <div className="relative">
        {/* Stepper dot */}
        <div className="absolute left-1 md:left-3 flex items-center justify-center w-6 h-6">
          <div className="w-3 h-3 rounded-full bg-primary/50 animate-pulse" />
        </div>
        <div className="ml-10 md:ml-14 flex items-center gap-2 mb-2">
          <div className="h-4 w-16 bg-muted rounded animate-pulse" />
          <div className="h-5 w-5 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="space-y-1 ml-10 md:ml-14">
          {[1, 2, 3].map((item) => (
            <Card key={item} className="!py-0 !gap-0 rounded-lg relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-muted animate-pulse" />
              <CardContent className="pl-4 pr-3 py-1.5">
                <div className="flex items-start gap-2">
                  <div className="h-5 w-5 rounded-full bg-muted animate-pulse flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-14 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="h-4 w-full bg-muted rounded animate-pulse" />
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-14 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-10 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-10 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                  <div className="h-6 w-6 bg-muted rounded animate-pulse flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Compact date group skeletons */}
      {[1, 2].map((group) => (
        <div key={group} className="relative">
          {/* Stepper dot */}
          <div className="absolute left-1 md:left-3 flex items-center justify-center w-6 h-6">
            <div className="w-2.5 h-2.5 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="ml-10 md:ml-14 flex items-center gap-2 mb-2">
            <div className="h-4 w-28 bg-muted/50 rounded animate-pulse" />
            <div className="h-5 w-5 rounded-full bg-muted/50 animate-pulse" />
          </div>
          {/* Compact rows */}
          <div className="ml-10 md:ml-14 space-y-0.5">
            {[1, 2].map((item) => (
              <div key={item} className="flex items-center gap-2 py-0.5 px-2">
                <div className="h-3 w-3 bg-muted/40 rounded animate-pulse" />
                <div className="h-3 w-14 bg-muted/40 rounded animate-pulse" />
                <div className="h-3 w-40 bg-muted/40 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
