"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import { useHealth } from "../hooks";
import { OAuthPanel } from "./panel";

interface HealthSettingsProps {
  hasConnection: boolean;
  lastSyncedAt: string | null;
  needsReauth: boolean;
}

export function HealthSettings({ hasConnection, lastSyncedAt, needsReauth }: HealthSettingsProps) {
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
    <OAuthPanel
      description="Fitbit 기기를 Google Health로 연결해 걸음·심박·수면·운동·산소포화도를 가져와요."
      connected={hasHealthConnection}
      needsReauth={needsReauth}
      authorizeHref="/api/fitbit/authorize"
      providerName="Google Health"
      stats={[
        {
          label: "마지막 동기화",
          value: lastSyncedAt ? formatRelative(lastSyncedAt) : "없음",
        },
        { label: "주기", value: "10분마다" },
      ]}
      extraActions={
        <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
          {isSyncing ? "동기화 중…" : "지금 동기화"}
        </Button>
      }
      isDisconnecting={isDisconnecting}
      onDisconnect={handleDisconnect}
    />
  );
}
