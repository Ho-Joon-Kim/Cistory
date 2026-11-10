import { describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "@/lib/user-error";
import { SAVE_TARGETS_ERROR, saveTargetAllocations } from "./hooks";

const targets = [{ ticker: "005930", name: "삼성전자", targetWeight: 1 }];

describe("saveTargetAllocations", () => {
  it("네트워크 실패를 던지지 않고 한국어 오류로 돌려준다", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(saveTargetAllocations("acc-1", targets)).resolves.toEqual({
      ok: false,
      error: `목표 비중을 저장하지 못했어요. ${NETWORK_ERROR_MESSAGE}`,
    });
  });

  it("오류 본문이 없거나 영어면 해요체 기본 문구를 쓴다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(saveTargetAllocations("acc-1", targets)).resolves.toEqual({
      ok: false,
      error: SAVE_TARGETS_ERROR,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ error: "Internal Server Error" }, { status: 500 })
    );
    await expect(saveTargetAllocations("acc-1", targets)).resolves.toEqual({
      ok: false,
      error: SAVE_TARGETS_ERROR,
    });
  });

  it("서버의 한국어 오류는 그대로 보여 준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ error: "비중 합계가 100%가 아니에요" }, { status: 400 })
    );
    await expect(saveTargetAllocations("acc-1", targets)).resolves.toEqual({
      ok: false,
      error: "비중 합계가 100%가 아니에요",
    });
  });

  it("성공하면 ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(saveTargetAllocations("acc-1", targets)).resolves.toEqual({ ok: true });
  });
});
