"use client";

import { useTossKey } from "../hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, Key, Copy, Trash2, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getAppUrl } from "@/lib/utils";

interface TossNotificationSettingsProps {
  hasKey: boolean;
}

export function TossNotificationSettings({ hasKey }: TossNotificationSettingsProps) {
  const {
    hasTossKey,
    newKey,
    isGenerating,
    isRevoking,
    generate,
    revoke,
  } = useTossKey(hasKey);

  const handleGenerate = async () => {
    const success = await generate();
    if (success) {
      toast.success("API 키가 생성되었습니다");
    } else {
      toast.error("API 키 생성에 실패했습니다");
    }
  };

  const handleRevoke = async () => {
    const success = await revoke();
    if (success) {
      toast.success("API 키가 삭제되었습니다");
    } else {
      toast.error("API 키 삭제에 실패했습니다");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("클립보드에 복사되었습니다");
  };

  const endpointUrl = `${getAppUrl()}/api/toss-notifications?apikey=`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          소비 추적 (토스 알림)
        </CardTitle>
        <CardDescription>
          MacroDroid로 토스 알림을 후킹하여 소비 데이터를 수집합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasTossKey ? (
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Key className="h-4 w-4 mr-2" />
            )}
            API Key 생성
          </Button>
        ) : (
          <div className="space-y-4">
            {newKey ? (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <p className="text-sm text-primary">
                    이 키는 다시 표시되지 않습니다. 안전한 곳에 복사해 두세요.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 rounded bg-muted text-sm font-mono break-all">
                    {newKey}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(newKey)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 rounded bg-muted text-sm font-mono text-muted-foreground">
                  toss_••••••••••••••••••••••••••••••••
                </code>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                재생성
              </Button>
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
                삭제
              </Button>
            </div>
          </div>
        )}

        {/* Setup Guide */}
        <div className="p-3 rounded-lg bg-muted/50 space-y-2">
          <p className="text-sm font-medium">MacroDroid 설정 가이드</p>
          <p className="text-sm text-muted-foreground">
            MacroDroid에서 토스 알림 트리거 → HTTP Request 액션으로 아래 URL에 POST 요청을 보내세요.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 p-2 rounded bg-background text-xs font-mono break-all border">
              {endpointUrl}YOUR_KEY
            </code>
            {hasTossKey && newKey && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(`${endpointUrl}${newKey}`)}
              >
                <Copy className="h-3 w-3 mr-1" />
                전체 URL 복사
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Content-Type: application/json, Body 예시: {`{"title": "[v:notification_title]", "text": "[v:notification_text]"}`}
          </p>
          {hasTossKey && (
            <div className="pt-1">
              <p className="text-xs text-muted-foreground">
                수집된 로그 확인: GET {`${getAppUrl()}/api/toss-notifications?apikey=YOUR_KEY`}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
