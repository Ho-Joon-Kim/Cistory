"use client";

import { Card, CardContent } from "@/components/ui/card";

export function TimelineSkeleton() {
  return (
    <div className="relative">
      {/* Stepper line */}
      <div className="absolute left-[14px] md:left-[22px] top-0 bottom-0 w-0.5 bg-border rounded-full" />

      <div className="space-y-10">
        {/* Date group skeletons */}
        {[1, 2].map((group) => (
          <div key={group}>
            {/* Date header */}
            <div className="relative flex items-center mb-2">
              {/* Dot marker skeleton */}
              <div className="absolute left-2 md:left-4 w-3 h-3 rounded-full bg-muted animate-pulse" />
              <div className="ml-10 md:ml-14 flex items-center gap-2">
                <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                {/* Commit count badge skeleton */}
                <div className="h-5 w-5 rounded-full bg-muted animate-pulse" />
              </div>
            </div>

            {/* Commit card skeletons */}
            <div className="space-y-1 ml-10 md:ml-14">
              {[1, 2, 3].map((item) => (
                <Card key={item} className="!py-0 !gap-0 rounded-lg relative overflow-hidden">
                  {/* Left border skeleton */}
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-muted animate-pulse" />

                  <CardContent className="pl-4 pr-3 py-1.5">
                    <div className="flex items-start gap-2">
                      {/* Avatar */}
                      <div className="h-5 w-5 rounded-full bg-muted animate-pulse flex-shrink-0" />

                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Author & time */}
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-14 bg-muted rounded animate-pulse" />
                        </div>

                        {/* Message */}
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />

                        {/* Stats */}
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-14 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-10 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-10 bg-muted rounded animate-pulse" />
                        </div>
                      </div>

                      {/* Expand button */}
                      <div className="h-6 w-6 bg-muted rounded animate-pulse flex-shrink-0" />
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
