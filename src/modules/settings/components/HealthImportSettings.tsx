"use client";

import { toast } from "sonner";
import { getAppUrl } from "@/lib/utils";
import { useHealthImportKey } from "../hooks";
import { ApiKeyPanel } from "./panel";

interface HealthImportSettingsProps {
  hasKey: boolean;
}

export function HealthImportSettings({ hasKey }: HealthImportSettingsProps) {
  const { hasHealthImportKey, newKey, isGenerating, isRevoking, generate, revoke } =
    useHealthImportKey(hasKey);

  const handleGenerate = async () => {
    if (
      hasHealthImportKey &&
      !window.confirm(
        "Health Connect 가져오기 API 키를 재생성할까요? 기존 키는 즉시 사용할 수 없게 되어 휴대폰 자동화 설정을 바꿔야 해요."
      )
    )
      return;
    const success = await generate();
    toast[success ? "success" : "error"](
      success ? "API 키가 생성됐어요." : "API 키를 생성하지 못했어요. 잠시 후 다시 시도해 주세요."
    );
  };
  const handleRevoke = async () => {
    if (
      !window.confirm(
        "Health Connect 가져오기 API 키를 삭제할까요? 휴대폰 자동화가 더 이상 기록을 보낼 수 없어요."
      )
    )
      return;
    const success = await revoke();
    toast[success ? "success" : "error"](
      success ? "API 키가 삭제됐어요." : "API 키를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요."
    );
  };
  return (
    <ApiKeyPanel
      description="Google 클라우드에 없는 과거 기록을 휴대폰 Health Connect에서 직접 보내요. 수면·운동·심박은 이제 클라우드 동기화로 들어오니 보조 수단이에요."
      hasKey={hasHealthImportKey}
      newKey={newKey}
      prefix="hi_"
      isGenerating={isGenerating}
      isRevoking={isRevoking}
      onGenerate={handleGenerate}
      onRevoke={handleRevoke}
      endpoint={`${getAppUrl()}/api/health-import?apikey=`}
      guideTitle="휴대폰 자동화 설정"
      guide={
        <span>
          MacroDroid나 Tasker와 Health Connect 리더로 아래 URL에 레코드 배열을 POST하세요. 같은
          기록을 다시 보내도 중복 없이 합쳐져요.
        </span>
      }
    />
  );
}
