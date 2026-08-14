"use client";

import { AlertTriangle, Copy, Key, Loader2, MoonStar, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppUrl } from "@/lib/utils";
import { useHealthImportKey } from "../hooks";

interface HealthImportSettingsProps {
  hasKey: boolean;
}

export function HealthImportSettings({ hasKey }: HealthImportSettingsProps) {
  const { hasHealthImportKey, newKey, isGenerating, isRevoking, generate, revoke } =
    useHealthImportKey(hasKey);

  const handleGenerate = async () => {
    const success = await generate();
    toast[success ? "success" : "error"](
      success ? "API 키가 생성되었습니다" : "API 키 생성에 실패했습니다"
    );
  };
  const handleRevoke = async () => {
    const success = await revoke();
    toast[success ? "success" : "error"](
      success ? "API 키가 삭제되었습니다" : "API 키 삭제에 실패했습니다"
    );
  };
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("클립보드에 복사되었습니다");
  };

  const endpointUrl = `${getAppUrl()}/api/health-import?apikey=`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MoonStar className="h-5 w-5" />
          건강 데이터 가져오기 (Health Connect)
        </CardTitle>
        <CardDescription>
          Google 클라우드로 안 넘어오는 기록을 폰의 Health Connect에서 직접 읽어 백필합니다
          (MacroDroid/Tasker → POST). 수면·운동·심박은 이제 클라우드 동기화로 들어오므로 보조
          수단입니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasHealthImportKey ? (
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
                  <Button variant="outline" size="icon" aria-label="키 복사" onClick={() => handleCopy(newKey)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <code className="block p-2 rounded bg-muted text-sm font-mono text-muted-foreground">
                hi_••••••••••••••••••••••••••••••••
              </code>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                재생성
              </Button>
              <Button variant="outline" size="sm" onClick={handleRevoke} disabled={isRevoking}>
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

        <div className="p-3 rounded-lg bg-muted/50 space-y-2">
          <p className="text-sm font-medium">설정 가이드</p>
          <p className="text-sm text-muted-foreground">
            폰 자동화(MacroDroid/Tasker + Health Connect 리더)로 아래 URL에 레코드 배열을
            POST하세요.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 p-2 rounded bg-background text-xs font-mono break-all border">
              {endpointUrl}YOUR_KEY
            </code>
            {hasHealthImportKey && newKey && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(`${endpointUrl}${newKey}`)}
              >
                <Copy className="h-3 w-3 mr-1" />
                URL 복사
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Body 예: <code>{`{"records":[{"type":"SleepSession","start":"…","end":"…"}]}`}</code> —
            재전송해도 중복 없이 병합됩니다.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
