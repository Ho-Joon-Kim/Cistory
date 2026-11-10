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
  connectFailed: "Proton 연결을 진행하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  disconnectFailed: "Proton 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  summaryFailed: "Proton 사진 연동 상태를 불러오지 못했습니다.",
  invalidOrigin: "허용되지 않은 요청입니다. 이 앱 화면에서 다시 시도해 주세요.",
  detailsUndecryptable: "세부 정보를 복호화하지 못했습니다",
  thumbnailMissing: "썸네일을 받지 못했습니다",
  thumbnailUnclassifiable: "썸네일 형식을 분류할 수 없습니다",
  originalUnavailable: "원본 파일을 받지 못했습니다",
  originalTooLarge: "원본 파일이 너무 커서 읽지 않았습니다",
  originalUndecodable: "원본 이미지로 썸네일을 만들 수 없습니다",
} as const;

/** A photo whose details failed this many times stays hidden until rescreened. */
export const PROTON_MAX_DETAILS_ATTEMPTS = 3;

/** An original that failed this many reads is not read again until it is re-ingested. */
export const PROTON_MAX_ORIGINAL_ATTEMPTS = 3;

export type ProtonErrorMessage = (typeof PROTON_ERRORS)[keyof typeof PROTON_ERRORS];
