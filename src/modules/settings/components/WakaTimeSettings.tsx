"use client";

import { useState } from "react";
import { useWakaTimeKey } from "../hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Code, Trash2, Loader2, ExternalLink, Check, RefreshCw, Calendar, BarChart3, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatRelativeTime } from "@/lib/utils";

interface WakaTimeSettingsProps {
  hasKey: boolean;
}

export function WakaTimeSettings({ hasKey }: WakaTimeSettingsProps) {
  const {
    hasWakaTimeKey,
    wakatimeUser,
    isConnecting,
    isRevoking,
    connect,
    revoke,
    syncStats,
    isSyncing,
    triggerSync,
  } = useWakaTimeKey(hasKey);

  const [apiKeyInput, setApiKeyInput] = useState("");

  const handleConnect = async () => {
    if (!apiKeyInput.trim()) {
      toast.error("API 키를 입력해주세요");
      return;
    }

    try {
      await connect(apiKeyInput.trim());
      toast.success("WakaTime이 연결되었습니다");
      setApiKeyInput("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "WakaTime 연결에 실패했습니다");
    }
  };

  const handleRevoke = async () => {
    const success = await revoke();
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
          코딩 활동 (WakaTime)
        </CardTitle>
        <CardDescription>
          WakaTime과 연동하여 코딩 세션 데이터를 타임라인에 표시합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasWakaTimeKey ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="WakaTime API Key"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect();
                }}
                disabled={isConnecting}
              />
              <Button onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                연결
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Connection info */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <code className="p-2 rounded bg-muted text-sm font-mono text-muted-foreground">
                  waka_••••••••••••••••
                </code>
                {wakatimeUser && (
                  <span className="text-sm text-muted-foreground">
                    ({wakatimeUser.displayName})
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevoke}
                disabled={isRevoking}
              >
                {isRevoking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                연결 해제
              </Button>
            </div>

            {/* Sync stats */}
            {syncStats && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <BarChart3 className="h-3.5 w-3.5" />
                      총 세션 수
                    </div>
                    <p className="text-lg font-semibold">{syncStats.totalSessions.toLocaleString()}</p>
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
                      {syncStats.lastSyncedAt
                        ? formatRelativeTime(syncStats.lastSyncedAt)
                        : "없음"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <RefreshCw className="h-3.5 w-3.5" />
                      미동기화 일수
                    </div>
                    <p className="text-lg font-semibold">{syncStats.unsyncedDays.toLocaleString()}</p>
                  </div>
                </div>

                {/* Sync buttons */}
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
              </div>
            )}
          </div>
        )}

        {/* Setup Guide */}
        <div className="p-3 rounded-lg bg-muted/50 space-y-2">
          <p className="text-sm font-medium">WakaTime 설정 가이드</p>
          <p className="text-sm text-muted-foreground">
            WakaTime 계정의 Settings &gt; API Key에서 키를 복사하세요.
          </p>
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href="https://wakatime.com/settings/api-key"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              WakaTime API Key 페이지
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
