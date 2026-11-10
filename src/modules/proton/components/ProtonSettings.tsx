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
import { userErrorMessage } from "@/lib/user-error";
import { reauthCopy } from "@/modules/data-status/reauth-copy";
import {
  PanelActions,
  PanelNote,
  PanelStats,
  PanelText,
} from "@/modules/settings/components/panel";
import { useProtonConnection } from "../hooks";

const DISCLOSURE =
  "Cistory는 Proton의 공식 앱이 아닌 개인 서드파티 앱입니다. 로그인은 Proton 페이지에서 진행되며 비밀번호는 Cistory로 전달되지 않습니다.";

/** Opens Proton's own sign-in page; the password never passes through Cistory. */
function SignInLink({ href }: { href: string }) {
  return (
    <Button size="sm" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        Proton에서 로그인
      </a>
    </Button>
  );
}

export function ProtonSettings() {
  const {
    summary,
    isLoading,
    loadError,
    fork,
    forkPending,
    pollStatus,
    isStarting,
    isDisconnecting,
    start,
    disconnect,
  } = useProtonConnection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Kept after a disconnect whose Proton-side session revoke failed, so the
  // instruction to end the session in Proton outlives the toast.
  const [revokeNotice, setRevokeNotice] = useState<string | null>(null);

  const handleStart = async () => {
    setRevokeNotice(null);
    try {
      await start();
    } catch (e) {
      toast.error(userErrorMessage(e, "Proton 연결을 시작하지 못했어요."));
    }
  };

  const handleDisconnect = async () => {
    try {
      const { notice } = await disconnect();
      toast.success("Proton 연결이 해제됐어요.");
      if (notice) {
        toast.warning(notice);
        setRevokeNotice(notice);
      }
    } catch (e) {
      toast.error(userErrorMessage(e, "Proton 연결을 해제하지 못했어요."));
    } finally {
      setConfirmOpen(false);
    }
  };

  const connected = summary?.connected === true;
  const needsReauth = summary?.status === "needs_reauth";
  const expired = pollStatus.data?.status === "expired";

  const startButton = (label: string) => (
    <Button size="sm" onClick={handleStart} disabled={isStarting}>
      {isStarting ? "준비 중…" : label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PanelText>Proton Drive 사진의 촬영 시각과 위치로 타임라인과 여행을 보강해요.</PanelText>
      <PanelText className="text-xs leading-[18px] text-ink-3">{DISCLOSURE}</PanelText>

      {isLoading ? (
        <PanelText className="text-ink-3">불러오는 중…</PanelText>
      ) : loadError ? (
        <PanelNote tone="danger">{loadError}</PanelNote>
      ) : connected ? (
        <>
          {needsReauth ? (
            <PanelNote
              tone="warn"
              action={
                forkPending && fork ? (
                  <SignInLink href={fork.signInUrl} />
                ) : (
                  startButton("Proton 다시 연결")
                )
              }
            >
              {reauthCopy("Proton", "auth").panel}
            </PanelNote>
          ) : null}
          {summary.backfilling ? (
            <PanelNote tone="brand">
              과거 사진을 가져오고 있어요. 끝나면 새 사진만 이어서 받아요.
            </PanelNote>
          ) : null}
          {/* Counts only: no photo, place or time is ever named here. */}
          <PanelStats
            items={[
              { label: "사진", value: summary.photoCount, unit: "장" },
              {
                label: "마지막 동기화",
                value: summary.lastSyncedAt ? formatRelative(summary.lastSyncedAt) : "없음",
              },
              {
                label: "세부 정보 실패",
                value: summary.detailsFailedCount,
                unit: "장",
                tone: summary.detailsFailedCount > 0 ? "warn" : "muted",
              },
              { label: "차단", value: summary.blockedCount, unit: "장", tone: "muted" },
            ]}
          />
          {summary.originalEligibleCount > 0 ? (
            <PanelNote>
              원본 메타데이터 확인 {formatCount(summary.originalCheckedCount)}/
              {formatCount(summary.originalEligibleCount)}
            </PanelNote>
          ) : null}
          <PanelActions>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={isDisconnecting}
              className="text-danger hover:bg-danger-soft hover:text-danger"
            >
              {isDisconnecting ? "해제 중…" : "연결 해제"}
            </Button>
          </PanelActions>
        </>
      ) : forkPending ? (
        <PanelNote
          tone="brand"
          action={
            fork ? <SignInLink href={fork.signInUrl} /> : startButton("로그인 링크 다시 받기")
          }
        >
          Proton 로그인을 기다리고 있어요. 로그인을 마치면 이 화면이 저절로 바뀌어요.
        </PanelNote>
      ) : (
        <>
          {revokeNotice ? <PanelNote tone="warn">{revokeNotice}</PanelNote> : null}
          {expired ? (
            <PanelNote tone="warn">로그인 시간이 지났어요. 다시 시도해 주세요.</PanelNote>
          ) : null}
          <PanelActions>{startButton("Proton 연결")}</PanelActions>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proton 연결을 해제할까요?</DialogTitle>
            <DialogDescription>
              저장된 인증 정보와 가져온 사진 정보(썸네일 포함)를 모두 삭제해요. 다시 연결하면
              처음부터 다시 가져와요.
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
