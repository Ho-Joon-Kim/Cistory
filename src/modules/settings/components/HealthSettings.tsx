"use client";

import { Activity, AlertTriangle, Check, Clock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { useHealth } from "../hooks";

interface HealthSettingsProps {
  hasConnection: boolean;
  lastSyncedAt: string | null;
  needsReauth: boolean;
}

export function HealthSettings({ hasConnection, lastSyncedAt, needsReauth }: HealthSettingsProps) {
  const { hasHealthConnection, isDisconnecting, disconnect } = useHealth(hasConnection);

  const handleDisconnect = async () => {
    const success = await disconnect();
    if (success) {
      toast.success("Fitbit 연결이 해제되었습니다");
    } else {
      toast.error("Fitbit 연결 해제에 실패했습니다");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          건강 (Fitbit)
        </CardTitle>
        <CardDescription>
          Fitbit Air를 Google Health로 연동해 수면·활동·심박·산소포화도 등을 수집합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasHealthConnection ? (
          <Button asChild>
            {/* Full-page redirect into the OAuth flow (authorize → Google consent → callback). */}
            <a href="/api/fitbit/authorize">
              <Check className="h-4 w-4 mr-2" />
              Fitbit 연동
            </a>
          </Button>
        ) : (
          <div className="space-y-4">
            {needsReauth && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-2">
                  <p className="text-sm">
                    Fitbit(Google) 인증이 만료되었습니다. 다시 연동해야 데이터 동기화가 재개됩니다.
                  </p>
                  <Button size="sm" asChild>
                    <a href="/api/fitbit/authorize">다시 연동</a>
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <code className="p-2 rounded bg-muted text-sm font-mono text-muted-foreground">
                연결됨
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
