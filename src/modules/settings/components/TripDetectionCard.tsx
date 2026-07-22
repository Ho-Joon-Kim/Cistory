"use client";

import { Loader2, Plane, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TripDetectDialog } from "@/modules/location/components/TripDetectDialog";
import { useTripDetection } from "@/modules/location/hooks";

export function TripDetectionCard() {
  const { detected, isDetecting, isSaving, detect, confirmTrips } = useTripDetection();
  const [showDialog, setShowDialog] = useState(false);

  const currentYear = new Date().getFullYear();
  const [reclassifyFrom, setReclassifyFrom] = useState(`${currentYear}-01-01`);
  const [reclassifyTo, setReclassifyTo] = useState(`${currentYear}-12-31`);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [reclassificationStatus, setReclassificationStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const handleDetect = async () => {
    const from = `${currentYear}-01-01`;
    const to = `${currentYear}-12-31`;
    const results = await detect(from, to);
    if (results.length > 0) {
      setShowDialog(true);
    } else {
      toast.info("감지된 여행이 없습니다");
    }
  };

  const handleConfirm = async (trips: typeof detected) => {
    const saved = await confirmTrips(trips);
    if (saved > 0) {
      toast.success(`${saved}건의 여행이 저장되었습니다`);
    }
    setShowDialog(false);
  };

  const handleReclassify = async () => {
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
        throw new Error(`${data.error ?? "교통수단 재분류에 실패했습니다"}${progress}`);
      }

      const message = `${data.daysProcessed ?? 0}일, 이동 ${data.trackCount ?? 0}건, 구간 ${
        data.segmentCount ?? 0
      }건을 재분류했습니다.`;
      setReclassificationStatus({ kind: "success", message });
      toast.success("교통수단 재분류가 완료되었습니다");
    } catch (error) {
      const message = error instanceof Error ? error.message : "교통수단 재분류에 실패했습니다";
      setReclassificationStatus({ kind: "error", message });
      toast.error(message);
    } finally {
      setIsReclassifying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plane className="h-4 w-4" />
          여행 자동 감지
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!showDialog ? (
          <>
            <p className="text-sm text-muted-foreground">
              위치 데이터를 분석하여 올해의 여행을 자동으로 감지합니다. 집에서 100km를 초과한 곳에서
              1박 이상 체류한 기간을 여행으로 판정합니다.
            </p>
            <Button variant="outline" disabled={isDetecting} onClick={handleDetect}>
              {isDetecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  분석 중...
                </>
              ) : (
                <>
                  <Plane className="h-4 w-4 mr-2" />
                  {currentYear}년 여행 감지
                </>
              )}
            </Button>
          </>
        ) : (
          <TripDetectDialog
            trips={detected}
            isSaving={isSaving}
            onConfirm={handleConfirm}
            onCancel={() => setShowDialog(false)}
          />
        )}

        <div className="border-t pt-4 space-y-3">
          <div>
            <p className="text-sm font-medium">교통수단 다시 판정</p>
            <p className="text-sm text-muted-foreground">
              선택한 기간의 이동 구간을 최신 비행 판정 기준으로 다시 계산합니다.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm" htmlFor="transport-reclassify-from">
              <span>시작일</span>
              <Input
                id="transport-reclassify-from"
                type="date"
                value={reclassifyFrom}
                disabled={isReclassifying}
                onChange={(event) => setReclassifyFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="transport-reclassify-to">
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
            disabled={
              isReclassifying || !reclassifyFrom || !reclassifyTo || reclassifyFrom > reclassifyTo
            }
            onClick={handleReclassify}
          >
            {isReclassifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                날짜별 이동 구간 재분류 중...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                선택 기간 재분류
              </>
            )}
          </Button>
          {reclassificationStatus ? (
            <p
              className={
                reclassificationStatus.kind === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
              role={reclassificationStatus.kind === "error" ? "alert" : "status"}
            >
              {reclassificationStatus.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
