"use client";

import { Loader2, Plane } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TripDetectDialog } from "@/modules/location/components/TripDetectDialog";
import { useTripDetection } from "@/modules/location/hooks";

export function TripDetectionCard() {
  const { detected, isDetecting, isSaving, detect, confirmTrips } = useTripDetection();
  const [showDialog, setShowDialog] = useState(false);

  const currentYear = new Date().getFullYear();

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
              위치 데이터를 분석하여 올해의 여행을 자동으로 감지합니다. 집에서 50km 이상 떨어진
              곳에서 2일 이상 체류한 기간을 여행으로 판정합니다.
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
      </CardContent>
    </Card>
  );
}
