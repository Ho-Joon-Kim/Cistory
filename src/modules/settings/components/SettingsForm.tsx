"use client";

import { useSettings } from "../hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Moon, Sun, Monitor } from "lucide-react";
import { toast } from "sonner";

export function SettingsForm() {
  const { settings, isLoading, isSaving, updateSettings } = useSettings();

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

  return (
    <div className="space-y-6">
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
    </div>
  );
}
