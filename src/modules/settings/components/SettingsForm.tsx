"use client";

import { ExternalLink, Github, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/modules/auth/hooks";
import { LocationImport } from "@/modules/location/components/LocationImport";
import { SavedPlacesSettings } from "@/modules/location/components/SavedPlacesSettings";
import { useSettings } from "../hooks";
import { DataUsageCard } from "./DataUsageCard";
import { DbBenchmarkCard } from "./DbBenchmarkCard";
import { LocationBackfillCard } from "./LocationBackfillCard";
import { OwnTracksSettings } from "./OwnTracksSettings";
import { SummaryStats } from "./SummaryStats";
import { TossNotificationSettings } from "./TossNotificationSettings";
import { TripDetectionCard } from "./TripDetectionCard";
import { WakaTimeSettings } from "./WakaTimeSettings";

export function SettingsForm() {
  const { settings, isLoading, isSaving, updateSettings } = useSettings();
  const { user } = useAuth();

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSyncIntervalChange = async (interval: string) => {
    const success = await updateSettings({ syncIntervalHours: parseInt(interval, 10) });
    if (success) {
      toast.success("동기화 간격이 변경되었습니다");
    }
  };

  const handleReconnectGithub = async () => {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "/settings",
    });
  };

  const githubUsername = user?.githubUsername;

  return (
    <div className="space-y-6">
      {/* 데이터 용량 */}
      <DataUsageCard />

      {/* DB 벤치마크 — admin-only, gated by NEXT_PUBLIC_ENABLE_DB_BENCHMARK */}
      {process.env.NEXT_PUBLIC_ENABLE_DB_BENCHMARK === "true" && <DbBenchmarkCard />}

      {/* GitHub 연결 & 동기화 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">GitHub</CardTitle>
          <CardDescription>
            GitHub 계정 연결 상태, Organization 접근 권한, 동기화 간격을 관리합니다
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 현재 연결 상태 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-muted">
                <Github className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">{githubUsername || "연결됨"}</p>
                <p className="text-sm text-muted-foreground">GitHub 계정</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleReconnectGithub}>
              <RefreshCw className="h-4 w-4 mr-2" />
              재연결
            </Button>
          </div>

          {/* 동기화 간격 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>동기화 간격</Label>
              <p className="text-sm text-muted-foreground">자동 동기화 실행 간격</p>
            </div>
            <Select
              value={settings.syncIntervalHours.toString()}
              onValueChange={handleSyncIntervalChange}
              disabled={isSaving}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1시간</SelectItem>
                <SelectItem value="3">3시간</SelectItem>
                <SelectItem value="6">6시간</SelectItem>
                <SelectItem value="12">12시간</SelectItem>
                <SelectItem value="24">24시간</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Organization 권한 안내 */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <p className="text-sm font-medium">Organization 레포지토리가 안 보이나요?</p>
            <p className="text-sm text-muted-foreground">
              Organization 레포지토리에 접근하려면 해당 Organization에서 OAuth 앱 접근을 승인해야
              합니다.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://github.com/settings/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  GitHub 앱 설정
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  도움말
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 위치 추적 */}
      <OwnTracksSettings hasKey={settings.hasOwnTracksKey} />

      {/* 저장된 장소 */}
      <SavedPlacesSettings />

      {/* 위치 데이터 임포트 */}
      <LocationImport />

      {/* 위치 데이터 백필 */}
      <LocationBackfillCard />

      {/* 여행 자동 감지 */}
      <TripDetectionCard />

      {/* 소비 추적 */}
      <TossNotificationSettings
        hasKey={settings.hasTossKey}
        tossMyName={settings.tossMyName}
        onUpdateMyName={async (name) =>
          updateSettings({ tossMyName: name } as Partial<typeof settings>)
        }
      />

      {/* Coding */}
      <WakaTimeSettings hasKey={settings.hasWakaTimeKey} />

      {/* AI 요약 */}
      <SummaryStats />
    </div>
  );
}
