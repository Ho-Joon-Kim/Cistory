"use client";

import { useState } from "react";
import { useWakaTimeKey } from "../hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Code, Trash2, Loader2, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";

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
          <div className="space-y-3">
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
