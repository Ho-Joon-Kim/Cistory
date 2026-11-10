"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import { useHealth } from "../hooks";
import { OAuthPanel, PanelNote } from "./panel";

interface HealthSettingsProps {
  hasConnection: boolean;
  lastSyncedAt: string | null;
  /** Latest real-time (webhook) notification; null until the subscriber is live. */
  lastWebhookAt?: string | null;
  needsReauth: boolean;
  /** Optional ECG / irregular-rhythm scopes the stored grant actually includes. */
  ecgGranted?: boolean;
  irnGranted?: boolean;
}

export function HealthSettings({
  hasConnection,
  lastSyncedAt,
  lastWebhookAt = null,
  needsReauth,
  ecgGranted = false,
  irnGranted = false,
}: HealthSettingsProps) {
  const { hasHealthConnection, isDisconnecting, isSyncing, disconnect, syncNow } =
    useHealth(hasConnection);

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        "Google Health (Fitbit) 연결을 해제할까요? 저장된 인증 정보가 삭제되어 건강 데이터 자동 동기화가 멈춰요. 이미 수집한 기록은 남아요."
      )
    )
      return;
    const success = await disconnect();
    if (success) {
      toast.success("Google Health (Fitbit) 연결이 해제됐어요.");
    } else {
      toast.error("Google Health (Fitbit) 연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleSync = async () => {
    const success = await syncNow();
    if (success) {
      toast.success("건강 데이터가 동기화됐어요.");
    } else {
      toast.error("건강 데이터를 동기화하지 못했어요. 잠시 후 다시 시도해 주세요.");
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
        ...(lastWebhookAt ? [{ label: "실시간 수신", value: formatRelative(lastWebhookAt) }] : []),
      ]}
      extraActions={
        <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
          {isSyncing ? "동기화 중…" : "지금 동기화"}
        </Button>
      }
      isDisconnecting={isDisconnecting}
      onDisconnect={handleDisconnect}
    >
      <RhythmScopes ecgGranted={ecgGranted} irnGranted={irnGranted} needsReauth={needsReauth} />
    </OAuthPanel>
  );
}

function rhythmScopeStatus(ecg: boolean, irn: boolean): string {
  if (ecg && irn) return "심전도(ECG)와 불규칙 심박 알림을 모두 가져와요.";
  if (ecg) return "심전도(ECG)만 연결돼 있어요. 불규칙 심박 알림은 아직이에요.";
  if (irn) return "불규칙 심박 알림만 연결돼 있어요. 심전도(ECG)는 아직이에요.";
  return "심전도(ECG)와 불규칙 심박 알림은 추가 권한이 필요해요. 기본 연동은 그대로예요.";
}

/**
 * Optional ECG / irregular-rhythm scopes: incremental consent that keeps the
 * existing grant (include_granted_scopes). Google lets the user untick either
 * scope, so the state shown comes from the stored grant, not from having asked.
 */
function RhythmScopes({
  ecgGranted,
  irnGranted,
  needsReauth,
}: {
  ecgGranted: boolean;
  irnGranted: boolean;
  needsReauth: boolean;
}) {
  const complete = ecgGranted && irnGranted;
  return (
    <PanelNote
      tone={complete ? "brand" : "ink"}
      action={
        !complete && !needsReauth ? (
          <Button size="sm" variant="outline" asChild>
            <a href="/api/fitbit/authorize?extra=ecg,irn">심전도 · 불규칙 심박 연결</a>
          </Button>
        ) : undefined
      }
    >
      {rhythmScopeStatus(ecgGranted, irnGranted)}
    </PanelNote>
  );
}
