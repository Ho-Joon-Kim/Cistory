"use client";

import {
  Activity,
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  Radio,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { useHealth } from "../hooks";

interface HealthSettingsProps {
  hasConnection: boolean;
  lastSyncedAt: string | null;
  /** Latest real-time (webhook) notification; null until the subscriber is live. */
  lastWebhookAt?: string | null;
  needsReauth: boolean;
}

export function HealthSettings({
  hasConnection,
  lastSyncedAt,
  lastWebhookAt = null,
  needsReauth,
}: HealthSettingsProps) {
  const { hasHealthConnection, isDisconnecting, isSyncing, disconnect, syncNow } =
    useHealth(hasConnection);

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        "Google Health (Fitbit) 연결을 해제할까요? 저장된 인증 정보가 삭제되어 건강 데이터 자동 동기화가 멈춥니다. 이미 수집한 기록은 남습니다."
      )
    )
      return;
    const success = await disconnect();
    if (success) {
      toast.success("Google Health (Fitbit) 연결이 해제되었습니다.");
    } else {
      toast.error("Google Health (Fitbit) 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleSync = async () => {
    const success = await syncNow();
    if (success) {
      toast.success("건강 데이터가 동기화되었습니다.");
    } else {
      toast.error("건강 데이터를 동기화하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          건강 · Google Health (Fitbit)
        </CardTitle>
        <CardDescription>
          Fitbit Air를 Google Health로 연결해 수면·활동·심박·산소포화도 등을 수집합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasHealthConnection ? (
          <Button asChild>
            {/* Full-page redirect into the OAuth flow (authorize → Google consent → callback). */}
            <a href="/api/fitbit/authorize">
              <Check className="h-4 w-4 mr-2" />
              Google Health (Fitbit) 연결
            </a>
          </Button>
        ) : (
          <div className="space-y-4">
            {needsReauth && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-warning/40 bg-warning/10">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                <div className="space-y-2">
                  <p className="text-sm">
                    Google Health (Fitbit) 인증이 만료되었습니다. 다시 연결하면 데이터 동기화가
                    재개됩니다.
                  </p>
                  <Button size="sm" asChild>
                    <a href="/api/fitbit/authorize">다시 연결</a>
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="min-w-0 flex-1 break-all p-2 rounded bg-muted text-xs sm:text-sm font-mono text-muted-foreground">
                연결됨
              </code>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
                  {isSyncing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4 mr-2" />
                  )}
                  {isSyncing ? "동기화 중…" : "지금 동기화"}
                </Button>
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
            </div>

            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              마지막 동기화: {lastSyncedAt ? formatRelativeTime(lastSyncedAt) : "없음"}
            </div>
            {lastWebhookAt ? (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Radio className="h-3.5 w-3.5" />
                실시간 동기화 마지막 수신: {formatRelativeTime(lastWebhookAt)}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
