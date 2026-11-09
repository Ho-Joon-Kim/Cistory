"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAppUrl } from "@/lib/utils";
import { useTossKey } from "../hooks";
import { ApiKeyPanel } from "./panel";

interface TossNotificationSettingsProps {
  hasKey: boolean;
  tossMyName: string | null;
  onUpdateMyName: (name: string | null) => Promise<boolean>;
}

export function TossNotificationSettings({
  hasKey,
  tossMyName,
  onUpdateMyName,
}: TossNotificationSettingsProps) {
  const { hasTossKey, newKey, isGenerating, isRevoking, generate, revoke } = useTossKey(hasKey);

  const [myName, setMyName] = useState(tossMyName ?? "");
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    setMyName(tossMyName ?? "");
  }, [tossMyName]);

  const handleGenerate = async () => {
    if (
      hasTossKey &&
      !window.confirm(
        "Toss 알림 API 키를 재생성할까요? 기존 키는 즉시 사용할 수 없게 되어 MacroDroid 설정을 바꿔야 합니다."
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
      !window.confirm(
        "Toss 알림 API 키를 삭제할까요? MacroDroid가 더 이상 알림을 보낼 수 없습니다."
      )
    )
      return;
    const success = await revoke();
    if (success) {
      toast.success("API 키가 삭제되었습니다.");
    } else {
      toast.error("API 키를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const saveName = async () => {
    setIsSavingName(true);
    const success = await onUpdateMyName(myName.trim() || null);
    setIsSavingName(false);
    if (success) {
      toast.success(myName.trim() ? "내 이름이 저장되었습니다." : "내 이름이 삭제되었습니다.");
    } else {
      toast.error("내 이름을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <ApiKeyPanel
      description="MacroDroid가 토스 알림을 이 키로 보내면 소비 기록으로 바꿔요."
      hasKey={hasTossKey}
      newKey={newKey}
      prefix="toss_"
      isGenerating={isGenerating}
      isRevoking={isRevoking}
      onGenerate={handleGenerate}
      onRevoke={handleRevoke}
      endpoint={`${getAppUrl()}/api/toss-notifications?apikey=`}
      guideTitle="MacroDroid 설정"
      guide={
        <span>
          토스 알림 트리거 → HTTP 요청 액션으로 아래 URL에 POST하세요. Content-Type은
          application/json, 본문은{" "}
          <code className="font-mono text-xs">{`{"title": "[v:notification_title]", "text": "[v:notification_text]"}`}</code>
          예요.
        </span>
      }
    >
      {hasTossKey ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <label htmlFor="toss-my-name" className="text-[13px] leading-5 font-semibold text-ink">
            내 이름
          </label>
          <span className="text-xs leading-[18px] text-ink-3">
            이 이름으로 받은 송금(내 계좌끼리 이체)은 소비 집계에서 빠져요.
          </span>
          <div className="flex items-center gap-2">
            <Input
              id="toss-my-name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="예: 홍길동"
              className="h-9 w-full text-base sm:max-w-[240px] sm:text-sm"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={isSavingName || (myName.trim() || "") === (tossMyName || "")}
            >
              {isSavingName ? "저장 중…" : "저장"}
            </Button>
          </div>
        </form>
      ) : null}
    </ApiKeyPanel>
  );
}
