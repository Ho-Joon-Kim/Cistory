import { describe, expect, it } from "vitest";
import { TripConfirmationError } from "@/modules/location/hooks";
import { getTripConfirmationErrorMessage } from "./TripDetectionCard";

describe("getTripConfirmationErrorMessage", () => {
  it("keeps a generic confirmation failure visible to the user", () => {
    expect(getTripConfirmationErrorMessage(new Error("저장소 오류"))).toBe("저장소 오류");
  });

  it("gives stale candidates explicit redetection guidance", () => {
    expect(
      getTripConfirmationErrorMessage(
        new TripConfirmationError("여행 제외 설정이 바뀌었습니다", "STALE_DETECTION")
      )
    ).toBe("여행 후보가 만료되었습니다. 취소한 뒤 여행을 다시 감지해 주세요.");
  });
});
