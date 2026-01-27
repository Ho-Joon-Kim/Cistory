"use client";

import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SummaryViewProps {
  status: string | null;
  summary: string | null;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

export function SummaryView({
  status,
  summary,
  onRegenerate,
  isRegenerating,
}: SummaryViewProps) {

  // 로딩 중
  if (status === "pending") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>요약 생성 대기 중...</span>
      </div>
    );
  }

  // 처리 중
  if (status === "processing") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>AI가 요약을 생성하고 있습니다...</span>
      </div>
    );
  }

  // 실패
  if (status === "failed") {
    return (
      <div className="space-y-2 py-2">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>요약 생성에 실패했습니다</span>
        </div>
        {onRegenerate && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            다시 시도
          </Button>
        )}
      </div>
    );
  }

  // 요약 완료
  if (summary) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</p>
        {onRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="text-xs text-muted-foreground"
          >
            {isRegenerating ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            재생성
          </Button>
        )}
      </div>
    );
  }

  // 요약 없음
  return (
    <div className="text-sm text-muted-foreground italic py-2">
      요약을 생성할 수 없습니다
    </div>
  );
}
