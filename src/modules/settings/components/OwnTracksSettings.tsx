"use client";

import { AlertTriangle, Copy, Key, Loader2, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppUrl } from "@/lib/utils";
import { useOwnTracksKey } from "../hooks";

interface OwnTracksSettingsProps {
  hasKey: boolean;
}

export function OwnTracksSettings({ hasKey }: OwnTracksSettingsProps) {
  const { hasOwnTracksKey, newKey, isGenerating, isRevoking, generate, revoke } =
    useOwnTracksKey(hasKey);

  const handleGenerate = async () => {
    if (
      hasOwnTracksKey &&
      !window.confirm(
        "OwnTracks API 키를 재생성할까요? 기존 키는 즉시 사용할 수 없게 되어 휴대폰 앱 설정을 바꿔야 합니다."
      )
    )
      return;
    const success = await generate();
    if (success) {
      toast.success("API 키가 생성되었습니다.");
    } else {
      toast.error("API 키를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleRevoke = async () => {
    if (
      !window.confirm("OwnTracks API 키를 삭제할까요? 휴대폰 앱이 더 이상 위치를 보낼 수 없습니다.")
    )
      return;
    const success = await revoke();
    if (success) {
      toast.success("API 키가 삭제되었습니다.");
    } else {
      toast.error("API 키를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("클립보드에 복사되었습니다.");
  };

  const endpointUrl = `${getAppUrl()}/api/owntracks?apikey=`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          위치 추적 (OwnTracks)
        </CardTitle>
        <CardDescription>
          OwnTracks 앱과 연결하여 위치 데이터를 타임라인에 표시합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasOwnTracksKey ? (
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Key className="h-4 w-4 mr-2" />
            )}
            API 키 생성
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="min-w-0 flex-1 break-all p-2 rounded bg-muted text-xs sm:text-sm font-mono">
                    {newKey}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="키 복사"
                    onClick={() => handleCopy(newKey)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="min-w-0 flex-1 break-all p-2 rounded bg-muted text-xs sm:text-sm font-mono text-muted-foreground">
                  ot_••••••••••••••••••••••••••••••••
                </code>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating}>
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
                className="text-destructive hover:text-destructive"
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
          <p className="text-sm font-medium">OwnTracks 설정 가이드</p>
          <p className="text-sm text-muted-foreground">
            OwnTracks 앱에서 아래 URL을 HTTP 엔드포인트로 설정하세요.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 p-2 rounded bg-background text-xs font-mono break-all border">
              {endpointUrl}YOUR_KEY
            </code>
            {hasOwnTracksKey && newKey && (
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
          <p className="text-xs text-muted-foreground">Mode: HTTP, Method: POST</p>
        </div>
      </CardContent>
    </Card>
  );
}
