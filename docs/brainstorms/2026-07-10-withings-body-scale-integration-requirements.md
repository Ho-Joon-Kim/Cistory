---
date: 2026-07-10
topic: withings-body-scale-integration
---

# Withings Body Smart 체중계 연동

## Summary

Withings 계정을 OAuth2로 연동해 Body Smart 저울의 모든 측정 지표를 백그라운드 cron으로 동기화·저장하고, 인사이트에 전용 "바디" 섹션과 월간/연간 리포트 섹션으로 추이를 보여준다.

---

## Problem Frame

Cistory는 커밋·위치·코딩·금융·투자를 한곳에 모으는 개인 라이프로깅 앱이다. 사용자가 새로 Withings Body Smart 저울을 구입했지만, 그 측정값(체중·체성분 등)은 Withings 앱 안에만 갇혀 있어 Cistory의 다른 삶의 기록과 나란히 볼 수 없다. 매번 별도 앱을 열어야 하고, 시간축·기간 리포트 같은 Cistory의 통합 뷰에는 신체 데이터만 빠져 있는 상태다. 신체 지표는 Cistory가 이미 다루는 "시간에 따른 개인 지표"와 성격이 같아, 통합했을 때의 가치가 크고 누락된 채로 두는 비용이 눈에 띈다.

---

## Key Flows

- F1. Withings 계정 연동 (OAuth2 인증 코드)
  - **Trigger:** 사용자가 설정 페이지의 "Withings 연동" 버튼 클릭
  - **Actors:** 사용자, Cistory, Withings
  - **Steps:** authorize URL로 리다이렉트 → Withings 로그인/권한 승인 → 콜백으로 authorization code 수신 → code를 액세스/리프레시 토큰으로 교환 → 토큰 암호화 저장 → 과거 데이터 백필 동기화를 비동기로 시작
  - **Outcome:** 설정에 "연동됨" 상태 표시, 과거 측정값이 로드되기 시작
  - **Covered by:** R1, R3, R5
  - **Escape path:** 사용자가 Withings에서 승인 거부 시 연동되지 않은 상태로 설정 페이지에 복귀

- F2. 주기적 동기화
  - **Trigger:** cron (사용자별 간격)
  - **Actors:** Cistory, Withings
  - **Steps:** 유효 토큰 확보(만료 임박 시 리프레시) → lastupdate 워터마크 이후 신규 측정값 조회 → 값·시각 정규화 → 중복 제외 upsert → 워터마크 갱신
  - **Outcome:** 최신 측정값이 저장되어 인사이트/리포트에 반영
  - **Covered by:** R3, R4, R6, R7, R13

---

## Requirements

**연동 & 인증**
- R1. 사용자는 설정 페이지에서 Withings 계정을 OAuth2 인증 코드 방식으로 연동할 수 있다 (연동 카드 → Withings 승인 → 콜백 → 완료).
- R2. 설정 페이지에 연동 상태가 표시되고, 사용자가 연동을 해제할 수 있다.
- R3. 액세스/리프레시 토큰 및 자격증명은 암호화되어 저장되고, 만료 전 자동 갱신된다. Withings 리프레시 토큰은 1회용이므로 갱신 시 새 리프레시 토큰까지 원자적으로 교체 저장한다.

**데이터 동기화**
- R4. 백그라운드 cron이 주기적으로 신규 측정값을 가져와 저장한다 (lastupdate 워터마크 기반 증분 동기화).
- R5. 최초 연동 시 과거 측정값을 전체 백필한다.
- R6. Body Smart의 모든 측정 지표를 저장한다 — 체중, 체지방률/체지방량, 근육량, 뼈량, 수분량, 기초대사량, 심박, 혈관나이, 맥파속도 등.
- R7. 동일 측정값을 다시 수집해도 중복 저장하지 않는다 (idempotent upsert).
- R8. 측정 시각은 KST 기준으로 정규화되어 저장·집계된다.

**인사이트 UI**
- R9. 인사이트 대시보드에 전용 "바디" 섹션을 추가한다.
- R10. 바디 섹션은 체중 추이와 체성분 추이(라인 차트 등)를 보여준다.
- R11. 바디 섹션은 최근 측정 스냅샷과 직전 대비 변화량을 보여준다.

**리포트**
- R12. 월간/연간 리포트에 바디 섹션을 추가한다 (기간 평균 체중, 기간 변화량, 최소/최대 등).

**신뢰성**
- R13. 동기화 실패 시 에러를 기록하고 다음 주기에 재시도하며, 한 사용자의 실패가 다른 사용자·다른 처리 블록을 막지 않는다 (기존 cron 격리 패턴).

---

## Acceptance Examples

- AE1. **Covers R3.** 저장된 액세스 토큰이 만료(또는 임박)한 상태에서 동기화가 실행되면, 리프레시 토큰으로 새 토큰을 발급받고 새 리프레시 토큰까지 원자적으로 교체 저장한 뒤 동기화를 계속한다.
- AE2. **Covers R5, R7.** 최초 연동에서 과거 데이터를 백필한 뒤 다음 cron 주기가 같은 기간을 다시 조회해도 중복 행이 생기지 않는다.
- AE3. **Covers R4.** 조회 결과 신규 측정값이 없으면 아무 것도 저장하지 않고 워터마크만 유지한다.
- AE4. **Covers R8.** 00:00–09:00 KST 사이에 측정된 값이 전날로 밀리지 않고 올바른 KST 날짜로 집계된다.

---

## Success Criteria

- 저울에서 측정한 뒤 사용자가 별도 조작을 하지 않아도, 다음 동기화 주기에 Cistory 인사이트/리포트에 반영된다.
- 인사이트 "바디" 섹션에서 체중·체성분 추이와 최근 변화량을 한눈에 파악할 수 있다.
- ce-plan이 스키마·라우트·차트를 바로 설계할 수 있을 만큼 데이터 범위, 동작, 인증/동기화 방식이 명확하다.

---

## Scope Boundaries

- 크로스도메인 상관분석 (체중 vs 여행/지출/코딩 세션) — 제외, 향후 과제.
- Withings 다른 기기 데이터 (수면·혈압·활동량 등) — 제외. 저울 지표에 집중하되 동일 `getmeas` API라 확장은 용이.
- 실시간 webhook 푸시 — 제외 (cron 폴링으로 충분).
- 목표 체중 설정/알림, 데이터 내보내기·재전송 — 제외.

---

## Key Decisions

- **표준 소비자 Data API + OAuth2 인증 코드 방식 채택** (Public Health Data API 아님): 1인이 본인 계정을 연동하는 용도에 맞고, 파트너십 계약·집계 프로그램 승인이 불필요.
- **KIS 브로커리지 통합 패턴을 미러링**: 자격증명 암호화(`src/lib/crypto.ts`), 캐시 토큰 + pg advisory-lock 기반 갱신(`PortfolioSyncService.getValidToken`), 사용자별 cron 블록(`src/lib/cron.ts`), 설정 카드 UI(WakaTime/KIS 카드) 재사용 → 검증된 인프라 활용, 신규 표면 최소화.
- **동기화는 cron 폴링**(webhook 아님): 측정 빈도가 낮고, 공개 콜백 엔드포인트 운영 부담이 없으며, 기존 모든 통합과 패턴 일치.
- **모든 지표 저장, 표시는 점진적**: 저장 비용이 거의 없어 나중에 UI만 추가하면 됨. 지금은 바디 섹션 + 리포트까지만 노출.
- **OAuth 리다이렉트+콜백이 유일한 신규 표면**: 앱 내 전례는 Better Auth GitHub 흐름과 KIS의 붙여넣기 방식뿐. authorize→callback→토큰 교환 흐름은 새로 만들어야 함.

---

## Dependencies / Assumptions

- Withings 개발자 대시보드에 앱 등록 필요 — `client_id`, `client_secret`, `redirect_uri` 발급은 사용자가 수행.
- `redirect_uri`는 배포 도메인의 콜백 경로로 사전 등록되어야 함.
- 암호화 키는 기존 `KIS_ENCRYPTION_KEY` 재사용 또는 전용 키 신설 — 계획 단계에서 결정 (env 이름이 KIS-특정이라 범용화 여부 검토).
- Withings 액세스 토큰 만료는 약 3시간, 리프레시 토큰은 1회용(갱신마다 새 토큰 발급)이라는 API 특성을 전제로 함.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] 측정값 스키마 형태 — 측정그룹 + 측정치(long/EAV) vs 지표별 컬럼(wide) 중 차트·집계에 유리한 쪽.
- [Affects R10][User decision] 바디 섹션 기본 노출 지표 — 체중 + 체지방%를 1차로 두고 나머지는 접기/토글 여부.
- [Affects R3][Technical][Needs research] 리프레시 토큰 1회용 처리 — 갱신 실패·동시성 충돌 시 재연동 유도 방식.
- [Affects R1][Technical] OAuth 콜백을 Better Auth `genericOAuth` 플러그인으로 붙일지, 전용 라우트로 직접 구현할지.
- [Affects R12][User decision] 리포트 바디 섹션을 기존 월간/연간 AI 내러티브 입력에 포함할지.
