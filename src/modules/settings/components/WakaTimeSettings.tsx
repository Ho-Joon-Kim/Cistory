"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCount, formatRelative } from "@/lib/format";
import { reauthCopy } from "@/modules/data-status/reauth-copy";
import { useWakaTime } from "../hooks";
import { PanelActions, PanelNote, PanelStats, PanelText } from "./panel";

interface WakaTimeSettingsProps {
  hasConnection: boolean;
  needsReauth: boolean;
  /** Deprecated API key stored without an OAuth connection. */
  hasLegacyKey: boolean;
}

/** Full-page redirect into the OAuth flow (authorize → WakaTime consent → callback). */
const AUTHORIZE_HREF = "/api/wakatime/authorize";

function ReconnectNotice({ message }: { message: string }) {
  return (
    <PanelNote
      tone="warn"
      action={
        <Button size="sm" asChild>
          <a href={AUTHORIZE_HREF}>WakaTime 다시 연결</a>
        </Button>
      }
    >
      {message}
    </PanelNote>
  );
}

export function WakaTimeSettings({
  hasConnection,
  needsReauth,
  hasLegacyKey,
}: WakaTimeSettingsProps) {
  const { hasWakaTimeConnection, isDisconnecting, disconnect, syncStats, isSyncing, triggerSync } =
    useWakaTime(hasConnection);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDisconnect = async () => {
    const success = await disconnect();
    setConfirmOpen(false);
    if (success) {
      toast.success("WakaTime 연결이 해제되었습니다");
    } else {
      toast.error("WakaTime 연결 해제에 실패했습니다");
    }
  };

  const handleSync = async (mode: "initial" | "regular") => {
    try {
      await triggerSync(mode);
      toast.success("WakaTime 동기화가 완료되었습니다");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "동기화에 실패했습니다");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelText>WakaTime 코딩 세션을 10분마다 가져와 타임라인과 개요에 보여 줘요.</PanelText>
      {!hasWakaTimeConnection ? (
        hasLegacyKey ? (
          <ReconnectNotice message={reauthCopy("WakaTime", "legacy_key").panel} />
        ) : (
          <PanelActions>
            <Button size="sm" asChild>
              <a href={AUTHORIZE_HREF}>WakaTime 연결</a>
            </Button>
          </PanelActions>
        )
      ) : (
        <>
          {needsReauth ? <ReconnectNotice message={reauthCopy("WakaTime", "auth").panel} /> : null}
          {syncStats ? (
            <PanelStats
              items={[
                { label: "세션", value: syncStats.totalSessions },
                { label: "기록한 날", value: syncStats.totalDays, unit: "일" },
                {
                  label: "마지막 동기화",
                  value: syncStats.lastSyncedAt ? formatRelative(syncStats.lastSyncedAt) : "없음",
                },
                {
                  label: "미동기화",
                  value: syncStats.unsyncedDays,
                  unit: "일",
                  tone: syncStats.unsyncedDays > 0 ? "warn" : "muted",
                },
              ]}
            />
          ) : null}
          <PanelActions>
            {!needsReauth ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync("regular")}
                  disabled={isSyncing}
                >
                  {isSyncing ? "동기화 중…" : "지금 동기화"}
                </Button>
                {syncStats && syncStats.unsyncedDays > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync("initial")}
                    disabled={isSyncing}
                  >
                    과거 {formatCount(syncStats.unsyncedDays)}일 가져오기
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={isDisconnecting}
              className="text-gain hover:bg-gain-soft hover:text-gain"
            >
              연결 해제
            </Button>
          </PanelActions>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WakaTime 연결을 해제할까요?</DialogTitle>
            <DialogDescription>
              WakaTime 접근 권한을 철회하고 저장된 인증 정보를 삭제합니다. 이미 가져온 코딩 기록은
              유지되며, 다시 연결하면 동기화가 재개됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isDisconnecting}
            >
              취소
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={isDisconnecting}>
              {isDisconnecting ? "해제 중…" : "연결 해제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
