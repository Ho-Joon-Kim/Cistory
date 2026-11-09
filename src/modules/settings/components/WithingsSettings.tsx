"use client";

import { AlertTriangle, Check, Clock, Loader2, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { useWithings } from "../hooks";

interface WithingsSettingsProps {
  hasConnection: boolean;
  withingsUserId: string | null;
  lastSyncedAt: string | null;
  needsReauth: boolean;
}

export function WithingsSettings({
  hasConnection,
  withingsUserId,
  lastSyncedAt,
  needsReauth,
}: WithingsSettingsProps) {
  const { hasWithingsConnection, isDisconnecting, disconnect } = useWithings(hasConnection);

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        "Withings 연결을 해제할까요? 저장된 인증 정보가 삭제되어 체성분 자동 동기화가 멈춥니다. 이미 수집한 기록은 남습니다."
      )
    )
      return;
    const success = await disconnect();
    if (success) {
      toast.success("Withings 연결이 해제되었습니다.");
    } else {
      toast.error("Withings 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Scale className="h-5 w-5" />
          체성분 (Withings)
        </CardTitle>
        <CardDescription>
          Withings Body 스마트 체중계와 연결하여 체중·체성분 데이터를 인사이트와 리포트에 표시합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasWithingsConnection ? (
          <Button asChild>
            {/* Full-page redirect into the OAuth flow (authorize → Withings consent → callback). */}
            <a href="/api/withings/authorize">
              <Check className="h-4 w-4 mr-2" />
              Withings 연결
            </a>
          </Button>
        ) : (
          <div className="space-y-4">
            {needsReauth && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-warning/40 bg-warning/10">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                <div className="space-y-2">
                  <p className="text-sm">
                    Withings 인증이 만료되었습니다. 다시 연결하면 데이터 동기화가 재개됩니다.
                  </p>
                  <Button size="sm" asChild>
                    <a href="/api/withings/authorize">다시 연결</a>
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="min-w-0 flex-1 break-all p-2 rounded bg-muted text-xs sm:text-sm font-mono text-muted-foreground">
                Withings ID: {withingsUserId ?? "연결됨"}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="text-destructive hover:text-destructive"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                연결 해제
              </Button>
            </div>

            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              마지막 동기화: {lastSyncedAt ? formatRelativeTime(lastSyncedAt) : "없음"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
