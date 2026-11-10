"use client";

import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { useWithings } from "../hooks";
import { OAuthPanel } from "./panel";

interface WithingsSettingsProps {
  hasConnection: boolean;
  withingsUserId: string | null;
  lastSyncedAt: string | null;
  needsReauth: boolean;
}

export function WithingsSettings({
  hasConnection,
  withingsUserId,
  lastSyncedAt,
  needsReauth,
}: WithingsSettingsProps) {
  const { hasWithingsConnection, isDisconnecting, disconnect } = useWithings(hasConnection);

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        "Withings 연결을 해제할까요? 저장된 인증 정보가 삭제되어 체성분 자동 동기화가 멈춰요. 이미 수집한 기록은 남아요."
      )
    )
      return;
    const success = await disconnect();
    if (success) {
      toast.success("Withings 연결이 해제됐어요.");
    } else {
      toast.error("Withings 연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <OAuthPanel
      description="Withings 체중계의 체중·체성분 측정을 하루 한 번 가져와요."
      connected={hasWithingsConnection}
      needsReauth={needsReauth}
      authorizeHref="/api/withings/authorize"
      providerName="Withings"
      stats={[
        { label: "Withings ID", value: withingsUserId ?? "—" },
        {
          label: "마지막 동기화",
          value: lastSyncedAt ? formatRelative(lastSyncedAt) : "없음",
        },
      ]}
      isDisconnecting={isDisconnecting}
      onDisconnect={handleDisconnect}
    />
  );
}
