import type { ProtonConnection } from "@/db/schema";

export type ProtonConnectionStatus = ProtonConnection["status"];

/**
 * Every user-visible Proton error. `last_error`, `details_error` and route
 * error bodies only ever carry one of these — never a Proton payload.
 */
export const PROTON_ERRORS = {
  authExpired: "Proton 인증이 만료되었습니다. 다시 연결해 주세요.",
  treeRemoved: "Proton 사진 보관함에 접근할 수 없습니다. 다시 연결해 주세요.",
  rateLimited: "Proton 요청 한도에 도달해 다음 주기에 다시 시도합니다.",
  syncFailed: "사진을 동기화하지 못했습니다. 잠시 후 다시 시도합니다.",
  classifierUnavailable: "사진 분류 모델을 불러오지 못해 세부 정보 수집을 미뤘습니다.",
  revokeFailed: "Proton 계정 설정의 세션 목록에서 Cistory 세션을 직접 삭제해 주세요.",
} as const;

export type ProtonErrorMessage = (typeof PROTON_ERRORS)[keyof typeof PROTON_ERRORS];
