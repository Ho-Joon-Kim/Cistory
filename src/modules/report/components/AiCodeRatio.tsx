"use client";

import { Bot, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AiCodeRatioProps {
  aiLines: number;
  humanLines: number;
}

export function AiCodeRatio({ aiLines, humanLines }: AiCodeRatioProps) {
  const totalLines = aiLines + humanLines;

  if (totalLines === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI vs 직접 작성 코드</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">코드 작성 데이터가 없습니다.</p>
        </CardContent>
      </Card>
    );
  }

  const aiPercent = Math.round((aiLines / totalLines) * 100);
  const humanPercent = 100 - aiPercent;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI vs 직접 작성 코드</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Bar */}
        <div className="h-4 w-full rounded-full overflow-hidden flex bg-muted">
          {aiPercent > 0 && (
            <div
              className="h-full bg-violet-500 transition-all duration-500"
              style={{ width: `${aiPercent}%` }}
            />
          )}
          {humanPercent > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${humanPercent}%` }}
            />
          )}
        </div>

        {/* Labels */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-violet-500" />
              <span className="font-medium">AI</span>
            </div>
            <span className="text-muted-foreground">
              {aiPercent}% ({aiLines.toLocaleString()}줄)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {humanPercent}% ({humanLines.toLocaleString()}줄)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">직접 작성</span>
              <User className="h-4 w-4 text-emerald-500" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
