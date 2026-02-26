"use client";

import { Card, CardContent } from "@/components/ui/card";

interface CategoryBreakdownChartProps {
  categories: { name: string; seconds: number }[];
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

const COLORS = [
  "bg-emerald-500",
  "bg-violet-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

export function CategoryBreakdownChart({ categories }: CategoryBreakdownChartProps) {
  if (categories.length === 0) return null;

  const total = categories.reduce((s, c) => s + c.seconds, 0);
  if (total === 0) return null;

  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">활동 유형별 코딩</h3>

        {/* 스택 바 */}
        <div className="flex h-3 rounded-full overflow-hidden mb-4">
          {categories.map((cat, i) => (
            <div
              key={cat.name}
              className={`${COLORS[i % COLORS.length]} transition-all`}
              style={{ width: `${(cat.seconds / total) * 100}%` }}
            />
          ))}
        </div>

        <div className="space-y-2">
          {categories.slice(0, 6).map((cat, i) => (
            <div key={cat.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-sm ${COLORS[i % COLORS.length]}`} />
                <span>{cat.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {Math.round((cat.seconds / total) * 100)}%
                </span>
                <span className="font-medium w-20 text-right">{formatDuration(cat.seconds)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
