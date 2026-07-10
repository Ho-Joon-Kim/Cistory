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
    const success = await disconnect();
    if (success) {
      toast.success("Withings 연결이 해제되었습니다");
    } else {
      toast.error("Withings 연결 해제에 실패했습니다");
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
          Withings Body 스마트 체중계와 연동하여 체중·체성분 데이터를 인사이트와 리포트에 표시합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasWithingsConnection ? (
          <Button asChild>
            {/* Full-page redirect into the OAuth flow (authorize → Withings consent → callback). */}
            <a href="/api/withings/authorize">
              <Check className="h-4 w-4 mr-2" />
              Withings 연동
            </a>
          </Button>
        ) : (
          <div className="space-y-4">
            {needsReauth && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-2">
                  <p className="text-sm">
                    Withings 인증이 만료되었습니다. 다시 연동해야 데이터 동기화가 재개됩니다.
                  </p>
                  <Button size="sm" asChild>
                    <a href="/api/withings/authorize">다시 연동</a>
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <code className="p-2 rounded bg-muted text-sm font-mono text-muted-foreground">
                Withings ID: {withingsUserId ?? "연결됨"}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
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
