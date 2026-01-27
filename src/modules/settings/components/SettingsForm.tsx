"use client";

import { useSettings } from "../hooks";
import { useAuth } from "@/modules/auth/hooks";
import { SummaryStats } from "./SummaryStats";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Moon, Sun, Monitor, Github, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl } from "@/lib/utils";

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

  const handleThemeChange = async (theme: string) => {
    const success = await updateSettings({ theme: theme as "light" | "dark" | "system" });
    if (success) {
      toast.success("테마가 변경되었습니다");
    }
  };

  const handleSyncIntervalChange = async (interval: string) => {
    const success = await updateSettings({ syncIntervalHours: parseInt(interval) });
    if (success) {
      toast.success("동기화 간격이 변경되었습니다");
    }
  };

  const handleReconnectGithub = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${getAppUrl()}/api/auth/callback?next=/settings`,
        scopes: "repo read:user",
      },
    });
    if (error) {
      toast.error("GitHub 재연결에 실패했습니다");
    }
  };

  const githubUsername = user?.githubUsername;

  return (
    <div className="space-y-6">
      {/* GitHub 연결 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">GitHub 연결</CardTitle>
          <CardDescription>
            GitHub 계정 연결 상태와 Organization 접근 권한을 관리합니다
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleReconnectGithub}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              재연결
            </Button>
          </div>

          {/* Organization 권한 안내 */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <p className="text-sm font-medium">Organization 레포지토리가 안 보이나요?</p>
            <p className="text-sm text-muted-foreground">
              Organization 레포지토리에 접근하려면 해당 Organization에서 OAuth 앱 접근을 승인해야 합니다.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                asChild
              >
                <a
                  href="https://github.com/settings/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  GitHub 앱 설정
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                asChild
              >
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

      {/* 외관 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">외관</CardTitle>
          <CardDescription>
            앱의 테마와 표시 방식을 설정합니다
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 테마 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>테마</Label>
              <p className="text-sm text-muted-foreground">
                앱의 색상 테마를 선택합니다
              </p>
            </div>
            <Select
              value={settings.theme}
              onValueChange={handleThemeChange}
              disabled={isSaving}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  <div className="flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    라이트
                  </div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4" />
                    다크
                  </div>
                </SelectItem>
                <SelectItem value="system">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    시스템
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 동기화 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">동기화</CardTitle>
          <CardDescription>
            GitHub 레포지토리 동기화 설정을 관리합니다
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 동기화 간격 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>동기화 간격</Label>
              <p className="text-sm text-muted-foreground">
                자동 동기화 실행 간격
              </p>
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
        </CardContent>
      </Card>

      {/* AI 요약 */}
      <SummaryStats />
    </div>
  );
}
