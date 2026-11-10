"use client";

import { toast } from "sonner";
import { getAppUrl } from "@/lib/utils";
import { useOwnTracksKey } from "../hooks";
import { ApiKeyPanel } from "./panel";

interface OwnTracksSettingsProps {
  hasKey: boolean;
}

export function OwnTracksSettings({ hasKey }: OwnTracksSettingsProps) {
  const { hasOwnTracksKey, newKey, isGenerating, isRevoking, generate, revoke } =
    useOwnTracksKey(hasKey);

  const handleGenerate = async () => {
    if (
      hasOwnTracksKey &&
      !window.confirm(
        "OwnTracks API 키를 재생성할까요? 기존 키는 즉시 사용할 수 없게 되어 휴대폰 앱 설정을 바꿔야 해요."
      )
    )
      return;
    const success = await generate();
    if (success) {
      toast.success("API 키가 생성됐어요.");
    } else {
      toast.error("API 키를 생성하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleRevoke = async () => {
    if (
      !window.confirm("OwnTracks API 키를 삭제할까요? 휴대폰 앱이 더 이상 위치를 보낼 수 없어요.")
    )
      return;
    const success = await revoke();
    if (success) {
      toast.success("API 키가 삭제됐어요.");
    } else {
      toast.error("API 키를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <ApiKeyPanel
      description="휴대폰 OwnTracks 앱이 이 키로 위치를 보내요. 키를 다시 만들면 앱 설정도 바꿔야 해요."
      hasKey={hasOwnTracksKey}
      newKey={newKey}
      prefix="ot_"
      isGenerating={isGenerating}
      isRevoking={isRevoking}
      onGenerate={handleGenerate}
      onRevoke={handleRevoke}
      endpoint={`${getAppUrl()}/api/owntracks?apikey=`}
      guideTitle="OwnTracks 설정"
      guide={
        <span>앱의 Mode를 HTTP로 두고 아래 URL을 엔드포인트로 넣으세요. Method는 POST예요.</span>
      }
    />
  );
}
