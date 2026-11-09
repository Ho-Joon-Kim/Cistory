"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TripDetectDialog } from "@/modules/location/components/TripDetectDialog";
import { TripConfirmationError, useTripDetection } from "@/modules/location/hooks";

export function getTripConfirmationErrorMessage(error: unknown): string {
  if (error instanceof TripConfirmationError && error.code === "STALE_DETECTION") {
    return "여행 후보가 만료되었습니다. 취소한 뒤 여행을 다시 감지해 주세요.";
  }
  return error instanceof Error
    ? error.message
    : "여행을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function SubHead({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] leading-5 font-semibold text-ink">{title}</span>
      <span className="text-[13px] leading-5 text-ink-2">{text}</span>
    </div>
  );
}

function TripRegenerationSection() {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [status, setStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const handleRegenerate = async () => {
    const confirmed = window.confirm(
      "2025-03-08 이후 자동 감지된 여행을 모두 최신 규칙으로 다시 만들까요? 기존 자동 여행은 삭제되고 새로 감지한 여행으로 바뀝니다. 직접 만든 여행은 유지됩니다."
    );
    if (!confirmed) return;

    setIsRegenerating(true);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/trip-regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as {
        error?: string;
        inserted?: number;
        replaced?: number;
        skipped?: number;
      };
      if (!response.ok)
        throw new Error(
          data.error ?? "자동 여행을 다시 만들지 못했습니다. 잠시 후 다시 시도해 주세요."
        );

      const message = `자동 여행 ${data.inserted ?? 0}건을 생성하고 기존 ${
        data.replaced ?? 0
      }건을 교체했습니다.${data.skipped ? ` 수동 여행과 겹친 ${data.skipped}건은 건너뛰었습니다.` : ""}`;
      setStatus({ kind: "success", message });
      toast.success("자동 여행이 다시 만들어졌습니다.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "자동 여행을 다시 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setStatus({ kind: "error", message });
      toast.error(message);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-4">
      <SubHead
        title="자동 여행 전체 다시 만들기"
        text="2025년 3월 8일 이후 자동 감지한 여행을 최신 규칙으로 한 번에 바꿔요. 직접 만든 여행은 그대로예요."
      />
      <Button
        variant="outline"
        size="sm"
        className="self-start text-gain hover:text-gain"
        disabled={isRegenerating}
        onClick={handleRegenerate}
      >
        {isRegenerating ? "분석하고 바꾸는 중…" : "자동 여행 다시 만들기"}
      </Button>
      {status ? (
        <p
          className={
            status.kind === "error" ? "m-0 text-[13px] text-gain" : "m-0 text-[13px] text-ink-2"
          }
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

export function TripDetectionCard() {
  const { detected, isDetecting, isSaving, detect, confirmTrips } = useTripDetection();
  const [showDialog, setShowDialog] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [reclassifyFrom, setReclassifyFrom] = useState(`${currentYear}-01-01`);
  const [reclassifyTo, setReclassifyTo] = useState(`${currentYear}-12-31`);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [reclassificationStatus, setReclassificationStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const handleDetect = async () => {
    setConfirmationError(null);
    const from = `${currentYear}-01-01`;
    const to = `${currentYear}-12-31`;
    const results = await detect(from, to);
    if (results.length > 0) {
      setShowDialog(true);
    } else {
      toast.info(`${currentYear}년에 감지된 여행이 없습니다.`);
    }
  };

  const handleConfirm = async (trips: typeof detected) => {
    setConfirmationError(null);
    try {
      const saved = await confirmTrips(trips);
      if (saved > 0) {
        toast.success(`여행 ${saved}건이 저장되었습니다.`);
      }
      setShowDialog(false);
    } catch (error) {
      const message = getTripConfirmationErrorMessage(error);
      setConfirmationError(message);
      toast.error(message);
    }
  };

  const handleReclassify = async () => {
    if (
      !window.confirm(
        `${reclassifyFrom} ~ ${reclassifyTo} 기간의 교통수단을 다시 판정할까요? 이 기간의 도로 경로 매칭과 지하철 매칭 결과가 삭제되며 자동으로 복구되지 않습니다.`
      )
    )
      return;
    setIsReclassifying(true);
    setReclassificationStatus(null);
    try {
      const response = await fetch("/api/settings/transportation-reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: reclassifyFrom, to: reclassifyTo }),
      });
      const data = (await response.json()) as {
        error?: string;
        failedDate?: string;
        daysProcessed?: number;
        trackCount?: number;
        segmentCount?: number;
      };
      if (!response.ok) {
        const progress = data.daysProcessed ? ` (${data.daysProcessed}일 처리 후 중단)` : "";
        throw new Error(
          `${data.error ?? "교통수단을 다시 판정하지 못했습니다. 잠시 후 다시 시도해 주세요."}${progress}`
        );
      }

      const message = `${data.daysProcessed ?? 0}일, 이동 ${data.trackCount ?? 0}건, 구간 ${
        data.segmentCount ?? 0
      }건을 다시 판정했습니다.`;
      setReclassificationStatus({ kind: "success", message });
      toast.success("교통수단 판정이 완료되었습니다.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "교통수단을 다시 판정하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setReclassificationStatus({ kind: "error", message });
      toast.error(message);
    } finally {
      setIsReclassifying(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!showDialog ? (
        <div className="flex flex-col gap-2.5">
          <SubHead
            title="올해 여행 감지"
            text="매주 일요일 02:00에 자동으로 감지해요. 집에서 100km 넘게 떨어진 곳에서 1박 이상 머문 기간을 여행으로 봐요."
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={isDetecting}
            onClick={handleDetect}
          >
            {isDetecting ? "분석 중…" : `${currentYear}년 여행 감지`}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <TripDetectDialog
            trips={detected}
            isSaving={isSaving}
            onConfirm={handleConfirm}
            onCancel={() => {
              setConfirmationError(null);
              setShowDialog(false);
            }}
          />
          {confirmationError ? (
            <p className="m-0 text-[13px] text-gain" role="alert">
              {confirmationError}
            </p>
          ) : null}
        </div>
      )}

      <TripRegenerationSection />

      <div className="flex flex-col gap-2.5 border-t border-line pt-4">
        <SubHead
          title="교통수단 다시 판정"
          text="고른 기간의 이동 구간을 최신 비행 판정 기준으로 다시 계산해요. 이 기간의 도로 경로·지하철 매칭 결과는 지워지고 자동으로 복구되지 않아요."
        />
        <div className="grid grid-cols-2 gap-3 sm:max-w-[360px]">
          <label
            className="flex flex-col gap-1 text-xs text-ink-3"
            htmlFor="transport-reclassify-from"
          >
            <span>시작일</span>
            <Input
              id="transport-reclassify-from"
              type="date"
              value={reclassifyFrom}
              disabled={isReclassifying}
              onChange={(event) => setReclassifyFrom(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-xs text-ink-3"
            htmlFor="transport-reclassify-to"
          >
            <span>종료일</span>
            <Input
              id="transport-reclassify-to"
              type="date"
              value={reclassifyTo}
              disabled={isReclassifying}
              onChange={(event) => setReclassifyTo(event.target.value)}
            />
          </label>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-start text-gain hover:text-gain"
          disabled={
            isReclassifying || !reclassifyFrom || !reclassifyTo || reclassifyFrom > reclassifyTo
          }
          onClick={handleReclassify}
        >
          {isReclassifying ? "날짜별로 판정하는 중…" : "고른 기간 다시 판정"}
        </Button>
        {reclassificationStatus ? (
          <p
            className={
              reclassificationStatus.kind === "error"
                ? "m-0 text-[13px] text-gain"
                : "m-0 text-[13px] text-ink-2"
            }
            role={reclassificationStatus.kind === "error" ? "alert" : "status"}
          >
            {reclassificationStatus.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
