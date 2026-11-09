"use client";

import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Check,
  Clock,
  Code,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRelativeTime } from "@/lib/utils";
import { useWakaTime } from "../hooks";

interface WakaTimeSettingsProps {
  hasConnection: boolean;
  needsReauth: boolean;
  /** Deprecated API key stored without an OAuth connection. */
  hasLegacyKey: boolean;
}

/** Full-page redirect into the OAuth flow (authorize → WakaTime consent → callback). */
const AUTHORIZE_HREF = "/api/wakatime/authorize";

function ReconnectNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
      <div className="space-y-2">
        <p className="text-sm">{message}</p>
        <Button size="sm" asChild>
          <a href={AUTHORIZE_HREF}>다시 연결</a>
        </Button>
      </div>
    </div>
  );
}

export function WakaTimeSettings({
  hasConnection,
  needsReauth,
  hasLegacyKey,
}: WakaTimeSettingsProps) {
  const { hasWakaTimeConnection, isDisconnecting, disconnect, syncStats, isSyncing, triggerSync } =
    useWakaTime(hasConnection);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDisconnect = async () => {
    const success = await disconnect();
    setConfirmOpen(false);
    if (success) {
      toast.success("WakaTime 연결이 해제되었습니다");
    } else {
      toast.error("WakaTime 연결 해제에 실패했습니다");
    }
  };

  const handleSync = async (mode: "initial" | "regular") => {
    try {
      await triggerSync(mode);
      toast.success("WakaTime 동기화가 완료되었습니다");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "동기화에 실패했습니다");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Code className="h-5 w-5" />
          Coding (WakaTime)
        </CardTitle>
        <CardDescription>
          WakaTime과 연동하여 코딩 세션 데이터를 타임라인에 표시합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasWakaTimeConnection ? (
          hasLegacyKey ? (
            <ReconnectNotice message="WakaTime이 API 키 연결을 더 이상 지원하지 않아 동기화가 중단되었습니다. WakaTime 계정을 다시 연결해 주세요." />
          ) : (
            <Button asChild>
              <a href={AUTHORIZE_HREF}>
                <Check className="h-4 w-4 mr-2" />
                WakaTime 연결
              </a>
            </Button>
          )
        ) : (
          <div className="space-y-4">
            {needsReauth && (
              <ReconnectNotice message="WakaTime 인증이 만료되었습니다. 다시 연결해야 데이터 동기화가 재개됩니다." />
            )}

            <div className="flex items-center justify-between">
              <code className="p-2 rounded bg-muted text-sm font-mono text-muted-foreground">
                WakaTime 계정 연결됨
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={isDisconnecting}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                연결 해제
              </Button>
            </div>

            {syncStats && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <BarChart3 className="h-3.5 w-3.5" />총 세션 수
                    </div>
                    <p className="text-lg font-semibold">
                      {syncStats.totalSessions.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Calendar className="h-3.5 w-3.5" />
                      기록 일수
                    </div>
                    <p className="text-lg font-semibold">{syncStats.totalDays.toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Clock className="h-3.5 w-3.5" />
                      마지막 동기화
                    </div>
                    <p className="text-sm font-medium">
                      {syncStats.lastSyncedAt ? formatRelativeTime(syncStats.lastSyncedAt) : "없음"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <RefreshCw className="h-3.5 w-3.5" />
                      미동기화 일수
                    </div>
                    <p className="text-lg font-semibold">
                      {syncStats.unsyncedDays.toLocaleString()}
                    </p>
                  </div>
                </div>

                {!needsReauth && (
                  <div className="flex gap-2">
                    {syncStats.unsyncedDays > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync("initial")}
                        disabled={isSyncing}
                      >
                        {isSyncing ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Calendar className="h-4 w-4 mr-2" />
                        )}
                        과거 데이터 동기화 ({syncStats.unsyncedDays}일)
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync("regular")}
                      disabled={isSyncing}
                    >
                      {isSyncing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      지금 동기화
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WakaTime 연결을 해제할까요?</DialogTitle>
            <DialogDescription>
              WakaTime 접근 권한을 철회하고 저장된 인증 정보를 삭제합니다. 이미 가져온 코딩 기록은
              유지되며, 다시 연결하면 동기화가 재개됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isDisconnecting}
            >
              취소
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={isDisconnecting}>
              {isDisconnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              연결 해제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
