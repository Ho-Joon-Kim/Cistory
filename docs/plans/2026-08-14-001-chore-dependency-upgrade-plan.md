---
title: "chore: 의존성 전면 업그레이드"
type: chore
status: active
date: 2026-08-14
deepened: 2026-08-14
origin: docs/brainstorms/2026-08-14-dependency-upgrade-requirements.md
---

# chore: 의존성 전면 업그레이드

## Summary

의존성 43개를 최신화하고, 실제 해당하는 보안 권고 8건을 닫고, 내러티브 입력 절단을 토큰 기준으로 바꾼다. 배포는 기계가 검증하는 변경과 눈으로만 검증되는 변경으로 나눠 두 번에 걸쳐 나간다.

---

## Problem Frame

`recharts`는 지원이 끊긴 2.x에 고정돼 있고, Node 메이저가 세 개(로컬 24, 배포 22, 타입 20) 돌아다니며 `engines` 선언이 없다. `yarn npm audit`에 6개 패키지 57건이 걸려 있는데, 코드 대조 결과 실제 해당하는 건 8건이다 — RSC DoS·캐시 오염 계열 7건과 OAuth state 검증 1건. 판정 근거는 origin의 Problem Frame에 표로 남아 있다.

origin은 최신 SDK가 여는 기능 3종(Message Batches, 프롬프트 캐싱, 토큰 계수) 도입도 범위에 넣었다. 계획 단계의 실측으로 앞의 둘은 탈락했고 — 근거는 Key Technical Decisions에 있다 — 토큰 계수만 남았다. 내러티브 입력 절단이 문자 수를 기준으로 하는데, Opus 5의 컨텍스트가 1M이므로 현재 한도는 근거 없이 보수적이다.

---

## Requirements

### 보안과 버전

- R1. 실제 해당하는 권고 8건이 닫힌다 — `next` RSC DoS·캐시 계열 7건, `better-auth` OAuth state 1건. (origin R1)
- R15. 해당 없음으로 판정된 패키지(`drizzle-orm`, `undici`, `fast-xml-parser`)도 같은 배치에서 함께 올라간다. (origin R2)
- R2. 작업 완료 시점 `yarn npm audit`에 남는 권고가 없다. (origin R3)
- R3. outdated 43개가 최신으로 올라간다. major 4종(recharts 3, lucide 1.x, stream-json 3 / stream-chain 4, TypeScript 7)을 포함한다. (origin R4)
- R4. 로컬 Node 메이저가 배포 런타임과 같은 22로 고정되고, `@types/node`가 22 계열이다. (origin R5, R6)
- R5. `react-is`가 직접 의존성으로 선언돼 있다. (origin R7)

### AI 워크로드

- R9. 내러티브 입력 절단이 문자 수가 아니라 토큰 수를 기준으로 한다. (origin R12)

### 배포와 검증

- R10. 1단계는 `yarn build`, `yarn test`, `yarn test:integration`, `/api/health`로 검증된다. (origin R13)
- R11. 1단계에서 기계가 못 잡는 두 경로가 수동 확인된다 — GitHub 로그인 왕복, Google Takeout 임포트. (origin R14)
- R12. 2단계는 차트 16개와 `Github` 아이콘을 교체한 두 화면이 눈으로 검수된다. (origin R15)
- R13. TypeScript 7이 1단계의 마지막 커밋이고, 빼도 나머지가 배포 가능하다. (origin R16)
- R14. 업그레이드 후 측정이 origin의 베이스라인과 같은 방법으로 기록된다. (origin R17)

---

## Key Technical Decisions

- **Message Batches는 도입하지 않는다.** `docs/superpowers/specs/2026-08-06-anthropic-model-migration-design.md`가 8일 전 30일 호출량을 실측해 이미 기각했다 — 커밋 요약 511건, 지출 분류 **월 12회 호출**(25건씩 묶으므로), 내러티브 2건, **AI 총지출 월 $5 안팎**. 50% 할인의 절대액은 월 2~3달러 수준이고, 그 대가로 새 테이블·수명주기·유닛 3개·최대 24시간 분류 지연을 떠안게 된다. 그 스펙의 다른 결정(`mapStopReason`, `CLAUDE_MODELS`)은 `src/lib/adapters/ai/claude.ts`에 실제로 반영돼 있으므로 폐기된 초안이 아니다. **이 판단을 뒤집으려면 새 호출량 실측이 선행되어야 한다** — 호출량이 한 자릿수 배 이상 늘었다면 재검토할 값이 있다. origin R10은 이 근거로 종결된다.

- **프롬프트 캐싱은 도입하지 않는다 — 안정 프리픽스가 존재하지 않기 때문이다.** 커밋 요약의 system은 `buildSystemPrompt(repoContext)`가 런타임에 조립하며 레포별 CLAUDE.md 1,000자와 README 500자를 끼워 넣으므로(`src/modules/summary/prompts.ts`) 레포마다 달라진다. 캐시는 접두사 일치이므로 이 형태에는 애초에 걸리지 않는다. 분류기의 안정 프리픽스(시스템 문장 43자 + 카테고리 목록 ~1,471자)는 Haiku 4.5의 최소치 4096토큰에 크게 못 미친다. origin의 AE1이 정한 대로 최소치를 맞추려 프롬프트를 늘리지 않는다. origin R11은 이 근거로 종결된다. (`prompts/commit-system-prompt.txt`는 `src/` 어디에서도 읽히지 않는 미사용 파일이다 — CLAUDE.md의 설명과 어긋나므로 별도로 정리할 대상이다.)

- **`Github` 아이콘은 GitHub 공식 마크를 `fill="currentColor"` 인라인 SVG로 넣는다.** lucide 1.0이 상표 문제로 브랜드 아이콘을 전부 삭제해 대체 이름이 없다. 로그인 버튼이 "GitHub로 로그인"으로 읽혀야 하므로 일반 아이콘으로 바꾸지 않는다. 색상 상속이 요구사항인 이유는 현재 lucide 아이콘이 `currentColor`로 버튼의 `text-primary-foreground`를 물려받고 있어서다 — 공식 브랜드 SVG는 보통 고정 fill(`#181717`)로 배포되므로 그대로 붙이면 한쪽 테마에서 배경과 구분되지 않는다.

- **shadcn 차트 래퍼는 CLI로 재설치한다.** `src/components/ui/chart.tsx`가 recharts의 Legend payload 타입과 `.recharts-*` DOM 클래스에 묶여 있어 수작업 패치보다 업스트림 최신본을 받는 편이 안전하다. (origin Key Decisions)

- **`tailwind-merge`는 2단계에 둔다.** `cn()`이 `twMerge(clsx(...))`라 이 패키지의 클래스 충돌 해소 규칙 변경은 앱의 모든 엘리먼트 className에 조용히 반영된다. 1단계 검증(`yarn build`/테스트/헬스체크)은 그런 회귀를 보지 못하므로, 눈이 검증하는 단계에 있어야 origin AE3의 "용의자는 렌더링 패키지뿐"이 성립한다.

- **TypeScript 7은 속도가 아니라 도입 비용이 낮아서 넣는다.** 실측 타입체크가 4.91초라 8~12배가 아끼는 건 약 4초다. 실제 근거는 `tsconfig.json`에 제거된 레거시 옵션이 없고 JSDoc 파일이 1개라는 점이며, 대가는 Next 16.3 선행 의존과 되돌릴 때의 동반 롤백이다. (origin Key Decisions)

---

## Implementation Units

### Phase 1 — 기계가 검증하는 변경

#### U1. 보안 패치 배치

- **Goal**: 코드 변경 없이 올라가는 보안 관련 패키지를 한 커밋으로 올린다.
- **Requirements**: R1(부분), R15, R2
- **Dependencies**: 없음
- **Files**: `package.json`, `yarn.lock`
- **Approach**: `drizzle-orm` 0.45.2, `undici`, `fast-xml-parser`, `better-auth` 1.6.x, `react`/`react-dom` 패치를 함께 올린다. `better-auth`만 코드 영향 가능성이 있으므로 타입 에러가 나오면 이 커밋에서 처리한다.
- **Patterns to follow**: 없음 — 버전 범프.
- **Test scenarios**: 기존 스위트가 회귀 감지 역할을 한다. `Test expectation: none -- 버전 범프에 새 테스트를 붙이지 않는다(origin 결정).`
- **Verification**: `yarn build`, `yarn test`, `yarn test:integration` 통과. **OAuth state 권고가 실제로 닫혔는지 확인한다** — better-auth 1.6.x의 changelog에서 해당 수정이 무조건 적용인지, PKCE 같은 옵션 설정을 요구하는지 읽고, 옵션이 필요하면 `src/lib/auth.ts`에 이 커밋에서 함께 넣는다. 로그인 왕복 1회 성공은 기능 회귀 확인일 뿐 권고가 닫혔다는 증거가 아니다.

#### U2. Next.js 16.3.1

- **Goal**: RSC DoS·캐시 계열 권고 7건을 닫고, TypeScript 7의 전제 조건을 만든다.
- **Requirements**: R1, R13(전제)
- **Dependencies**: U1
- **Files**: `package.json`, `yarn.lock`
- **Approach**: 16.1.4 → 16.3.1. 이 앱은 middleware, Server Actions, `next/image`, rewrites, PPR을 쓰지 않으므로 해당 계열 breaking change는 무관하다. `next build` 디스크 캐싱이 기본 활성으로 딸려온다.
- **Test scenarios**: `Covers 라우트 임포트 스모크.` 기존 `src/app/api/_routes-import.test.ts`가 전 라우트 모듈 로드를 검증한다 — Next 메이저 내 업그레이드에서 임포트 크래시를 잡는 지점이다.
- **Verification**: `yarn build` 성공, `yarn test` 통과, 로컬 `yarn start` 후 `/api/health` 200.

#### U3. minor 일괄 + Node 정합성

- **Goal**: 렌더링을 건드리지 않는 minor를 모두 올리고 Node 메이저 간극을 닫는다.
- **Requirements**: R2, R3(부분), R4, R5
- **Dependencies**: U2
- **Files**: `package.json`, `yarn.lock`, `.node-version`(신규)
- **Approach**: `@sentry/nextjs`, `mapbox-gl`, `pg`, `zod`, `node-cron`, `@biomejs/biome`, `dotenv`, `drizzle-kit`, `@anthropic-ai/sdk`, `sonner`, `react-map-gl`, `@logtail/node`를 올린다. `tailwindcss`, `@radix-ui/*`, **`tailwind-merge`**는 Phase 2로 미룬다 — 렌더링을 건드린다. `@types/node`는 npm latest(26)가 아니라 22 계열로 올린다. `react-is`를 직접 의존성으로 추가한다(recharts 3가 peer로 옮겼다).
- **Node 고정**: `engines.node`는 선언만으로 아무것도 강제하지 않는다 — 이 저장소 구성(yarn 4.5.0, `nodeLinker: node-modules`)에서 `engines: {"node": "22.x"}`를 넣고 Node 24로 `yarn install`을 돌리면 경고 없이 통과하는 것이 실측으로 확인됐다. 실제 고정은 버전 매니저가 읽는 `.node-version`(내용 `22`)으로 한다. `engines.node`는 문서 값(`>=22 <23`)으로 함께 둔다.
- **Patterns to follow**: `node-cron`은 타임존 처리가 급소다 — 모든 등록이 `timezone: "Asia/Seoul"`을 명시하는지 확인한다(`src/lib/cron.ts`).
- **Test scenarios**: `Test expectation: none -- 버전 범프.` 단 Biome 새 룰이 신규 경고를 낼 수 있으므로 `yarn lint` 결과를 확인한다.
- **Verification**: `yarn build`, `yarn test`, `yarn lint` 통과. `yarn lint`의 경고 수가 베이스라인(92) 대비 늘었다면 새 룰인지 확인하고 기록한다. **`node -v`가 22를 내는지 직접 확인한다** — Yarn이 잡아주지 않는다.

#### U4. stream-json 3 / stream-chain 4

- **Goal**: Google Takeout 파서의 스트리밍 의존성을 major 업그레이드한다.
- **Requirements**: R3(부분), R11(부분)
- **Dependencies**: U3
- **Files**: `package.json`, `yarn.lock`, `src/modules/location/services/import/google-takeout-parser.ts`, `src/modules/location/services/import/google-takeout-parser.test.ts`(신규)
- **Approach**: 영향 범위가 이 파서 하나다. `chainUnchecked`, `pickFilter`, `jsonParser`, `streamValues`의 시그니처 변경 여부를 확인한다. `src/app/api/timeline/locations/import/route.ts:340`이 이 파서의 abort 동작(`ERR_STREAM_PREMATURE_CLOSE` 억제)에 의존하므로 함께 확인한다.
- **Execution note**: 이 파일에는 테스트가 없다. 업그레이드 **전에** 현재 동작을 고정하는 특성화 테스트를 먼저 붙인다 — 순수 파싱 로직이라 `docs/brainstorms/2026-06-27-ci-smoke-testing-requirements.md`가 정한 L1(순수 로직 단정) 계층에 해당하고, 제외 대상인 UI 계층이 아니다.
- **Test scenarios**:
  - 정상 Takeout JSON 조각을 넣으면 기대한 위치 레코드 배열이 나온다.
  - 중간에 끊긴 JSON을 넣으면 그때까지 파싱된 레코드를 내고 예외를 던지지 않는다.
  - 빈 입력에 대해 빈 배열을 낸다.
  - 스트림을 중도 `destroy()` 하면 `ERR_STREAM_PREMATURE_CLOSE`가 호출부로 전파되지 않는다. (이 동작은 파서와 라우트에 나뉘어 있으므로 파서 단독 테스트는 절반만 고정한다 — 실제 임포트 1회로 나머지를 확인한다.)
- **Verification**: 신규 테스트 통과. 실제 Takeout 파일 임포트 1회 성공.

#### U8. 내러티브 입력 절단을 토큰 기준으로

- **Goal**: `NARRATIVE_MAX_INPUT_CHARS`의 문자 수 기준을 토큰 수 기준으로 바꾼다.
- **Requirements**: R9
- **Dependencies**: U3
- **Files**: `src/lib/adapters/ai/claude.ts`, `src/lib/adapters/ai/claude.test.ts`, `src/modules/overview/narrative.ts`, `src/modules/overview/narrative.test.ts`
- **Approach**: 어댑터에 `countTokens` 메서드를 **추가**한다(기존 `generateText` 경로는 건드리지 않는다). `ClaudeAdapter`에는 현재 `generateText` 하나뿐이라 토큰 계수 경로가 없다. `buildNarrativePrompt`와 `serializeNarrativeInput`은 지금 동기 함수이고 서비스가 어댑터를 `Pick<ClaudeAdapter, "generateText">`로만 받으므로, 둘을 async로 바꾸고 `countTokens`를 포함한 형태로 주입받도록 시그니처를 넓힌다. `serializeNarrativeInput`을 export해 테스트가 직접 검증하게 한다. 단계적 축약 루프는 유지하되 종료 조건을 토큰 수로 바꾼다. 토큰 계수는 네트워크 호출이므로 축약 루프 안에서 매번 부르지 않는다 — 문자 수로 후보를 좁히고 마지막에 한 번 검증하는 형태로 둔다.
- **Test scenarios**:
  - 한도 이하 입력은 원본 그대로 직렬화된다.
  - 한도 초과 입력은 도메인별 미리보기가 잘린 형태로 줄어든다.
  - 축약을 최대로 해도 한도를 넘으면 최소 형태를 낸다.
  - 토큰 계수 호출이 실패하면 문자 수 기준으로 폴백하고 절단 자체는 계속 동작한다.
  - 축약 루프 한 번에 `countTokens` 호출이 정해진 횟수를 넘지 않는다.
- **Verification**: 신규 테스트 통과. 실제 스냅샷 하나로 내러티브 생성이 성공한다.

#### U9. TypeScript 7

- **Goal**: TypeScript를 5.9.3에서 7.0.2로 올린다.
- **Requirements**: R3(부분), R13
- **Dependencies**: U2 — Next 16.3이 컴파일러 JS API 대신 프로젝트 로컬 `tsc` CLI를 호출하도록 바꾼 것에 의존한다.
- **Files**: `package.json`, `yarn.lock`, 타입 에러가 나온 파일들
- **Approach**: **Phase 1의 마지막 커밋으로 둔다.** `tsconfig.json`은 `target: ES2017`, `module: esnext`, `moduleResolution: bundler`라 제거된 레거시 옵션을 쓰지 않고, JSDoc 사용 파일이 1개라 JSDoc 시맨틱 변경의 표면이 거의 없다. 그래도 5에서 6을 건너뛰므로 누적 변경이 한 번에 온다.
- **Test scenarios**: `Test expectation: none -- 타입체커 전환. 검증은 빌드가 한다.`
- **Verification**: `yarn build` 성공. 로컬 성공이 Docker 빌드 성공을 보장하지는 않으므로(`node:22-alpine`은 musl) `docker build --target tester`도 한 번 돌린다. 실패하고 원인이 TS 6를 건너뛴 누적 변경이면 이 커밋만 제외하고 U1~U4·U8을 배포한다(origin AE2).

### Phase 2 — 눈으로 검증하는 변경

#### U10. recharts 3

- **Goal**: recharts를 2.15.4에서 3.10.1로 올리고 확정된 두 파손 지점을 고친다.
- **Requirements**: R3(부분), R12 (origin R8)
- **Dependencies**: U1–U8 — Phase 1이 배포되고 정상 동작이 확인된 뒤에 시작한다. U9(TypeScript 7)는 자체 탈출구로 빠질 수 있으므로 전제에 넣지 않는다.
- **Files**: `package.json`, `yarn.lock`, `src/components/ui/chart.tsx`(shadcn 래퍼), 차트 16개 — `src/modules/report/components/`(9), `src/modules/spending/components/`(3), `src/modules/portfolio/components/`(3), `src/modules/settings/components/DataUsageCard.tsx`(1)
- **Approach**: shadcn CLI로 `ui/chart.tsx`를 재설치한다(수작업 패치 금지). `MonthlyTrendChart`는 `YAxis`가 둘인데 `CartesianGrid`에 축 id가 없어 v3에서 그리드가 렌더되지 않는다 — 축 id를 명시한다. `SpendingTrendChart`는 `ComposedChart` 안에서 배경색 `Area`로 예측 밴드를 파내는 기법을 쓰는데 v3가 z-index를 JSX 순서 기준으로 재정의했으므로 가장 먼저 확인한다.
- **Patterns to follow**: 다른 차트들은 `Bar`/`Line`/`Area` + `XAxis`/`YAxis`/`CartesianGrid`/`Tooltip`의 단순 조합이라 저위험이다.
- **Test scenarios**: `Test expectation: none -- 컴포넌트 테스트를 추가하지 않는다(origin 결정). 검증은 화면 검수가 한다.`
- **Verification**: 화면 검수가 유일한 안전망이므로 무엇이 정상인지 먼저 정한다.
  - 업그레이드 **전에** 대상 라우트(`/overview`, `/report`, `/spending`, `/portfolio`, `/settings`)를 한 번 돌며 차트 16개의 현재 모습을 스크린샷으로 남긴다. 데이터가 비어 있는 차트는 그 사실도 함께 기록한다 — 빈 차트로 검수하면 회귀가 보이지 않는다.
  - `SpendingTrendChart` 정상 = 예측 밴드가 실제 누적 지출 라인 주변에만 얇게 떠 있음. 실패 = 밴드가 0부터 그래프 하단까지 통째로 채워져 실제 라인을 덮음.
  - `MonthlyTrendChart` 정상 = 그리드 선이 보임. 실패 = 그리드가 아예 렌더되지 않음.
  - 축 라벨 색·그리드 선·툴팁 커서가 깨져 보이면 v3가 DOM 클래스명을 바꾼 것이므로 래퍼의 스타일 셀렉터를 맞춘다(origin AE4).

#### U11. lucide-react 1.x

- **Goal**: lucide-react를 0.576.0에서 1.31.0으로 올리고 삭제된 `Github` 아이콘을 대체한다.
- **Requirements**: R3(부분), R12 (origin R9)
- **Dependencies**: U10
- **Files**: `package.json`, `yarn.lock`, `src/app/(auth)/login/page.tsx`, `src/modules/settings/components/SettingsForm.tsx`, GitHub 마크 컴포넌트(신규)
- **Approach**: 사용 중인 아이콘 113개 중 1.31.0에 없는 것은 `Github` 하나이고 사용처는 두 곳이다(설치본 export와 직접 대조한 결과). GitHub 공식 마크를 `fill="currentColor"` 인라인 SVG 컴포넌트로 만들어 두 곳에서 쓴다 — 고정 fill로 두면 한쪽 테마에서 사라진다.
- **접근성**: 1.0은 `aria-hidden`이 기본 true다. 점검 범위는 **아이콘만으로 의미를 전달하는 컨트롤 전체**로 잡는다 — `size="icon"` 버튼(복사, 테마 토글, 저장된 장소 편집·삭제 등)이 대상이고, 텍스트 라벨이 함께 있는 버튼은 제외한다.
- **Test scenarios**: `Test expectation: none -- 아이콘 교체. 검증은 화면 검수가 한다.`
- **Verification**: `yarn build` 성공(없는 export를 import하면 빌드가 잡는다). 로그인 화면과 설정 화면에서 마크가 **라이트·다크 두 모드 모두** 배경과 구분되는지 확인한다. `size="icon"` 버튼들의 접근 가능한 이름이 남아 있는지 확인한다.

#### U12. tailwindcss + Radix + tailwind-merge

- **Goal**: 렌더링을 건드리는 나머지 minor를 올린다.
- **Requirements**: R2, R3(부분), R12
- **Dependencies**: U11
- **Files**: `package.json`, `yarn.lock`
- **Approach**: `tailwindcss`와 `@tailwindcss/postcss`를 버전을 맞춰 함께 올린다. `@radix-ui/*` 12개와 `tailwind-merge`를 올린다. 전부 minor라 저위험이지만 조용한 시각 회귀 가능성이 있어 사람이 보는 단계에 둔다.
- **Test scenarios**: `Test expectation: none -- 버전 범프. 검증은 화면 검수가 한다.`
- **Verification**: 다이얼로그, 드롭다운, 셀렉트, 슬라이더, 툴팁, 스위치가 있는 화면을 확인한다. `tailwind-merge`는 `cn()`을 통해 전 화면에 걸리므로 U10에서 남긴 스크린샷과 대조한다.

### 측정

#### U13. 업그레이드 후 측정

- **Goal**: origin의 베이스라인과 같은 방법으로 재고 비교를 기록한다.
- **Requirements**: R14
- **Dependencies**: U12
- **Files**: `docs/brainstorms/2026-08-14-dependency-upgrade-requirements.md`(측정 결과 추가) 또는 별도 기록 파일
- **Approach**: 베이스라인과 동일한 절차로 잰다 — `tsc --noEmit` cold/warm, `yarn lint`, `yarn test`, `yarn build` cold/warm, `docker build --target tester`. 같은 머신에서 재야 비교가 성립한다. TypeScript 7이 실제로 얼마를 아꼈는지, `next build` 디스크 캐싱이 warm 빌드에 얼마나 기여했는지가 확인 대상이다.
- **Test scenarios**: `Test expectation: none -- 측정 작업.`
- **Verification**: 전후 표가 같은 항목으로 채워져 있다.

---

## Scope Boundaries

- **Message Batches** — 선행 실측으로 기각. Key Technical Decisions 참조. (origin R10을 뒤집는다 — Open Questions에 기록)
- **프롬프트 캐싱** — 안정 프리픽스가 존재하지 않아 기각. 최소 캐시 프리픽스를 맞추려 프롬프트를 늘리지 않는다.
- **TanStack Charts** — pre-alpha이고 문서가 프로덕션 사용을 금지한다. (origin)
- **컴포넌트 테스트와 시각 회귀 도구** — 도입하지 않는다. U4의 파서 특성화 테스트는 순수 로직 계층이라 여기 해당하지 않는다. U10의 사전 스크린샷은 도구 도입이 아니라 검수 기준 확보다.
- **크론 아키텍처 변경** — 배치가 빠지면서 크론은 이번 범위에서 손대지 않는다.

### Deferred to Follow-Up Work

- `prompts/commit-system-prompt.txt` 미사용 파일 정리와 CLAUDE.md의 해당 설명 수정.
- AI 호출량 재실측. 호출량이 크게 늘면 Message Batches 판단을 재검토할 근거가 된다.

---

## System-Wide Impact

- **AI 어댑터는 호출부 3개가 공유한다.** 커밋 요약, 지출 분류, 내러티브가 같은 `src/lib/adapters/ai/claude.ts`를 쓴다. U8이 추가하는 `countTokens`는 **추가**여야 하고 기존 `generateText` 경로를 바꾸면 세 호출부가 모두 영향받는다.
- **`cn()`은 전 화면을 통과한다.** `src/lib/utils.ts`의 `twMerge(clsx(...))`가 모든 컴포넌트 className을 거치므로 `tailwind-merge` 변경은 전역 시각 영향을 갖는다. 이것이 U12에 배치한 이유다.
- **마이그레이션이 없다.** 배치가 빠지면서 스키마 변경이 사라졌다. Jenkins의 Run Migrations 스테이지는 이번 배포에서 no-op이다.

---

## Risks & Dependencies

- **`vi.mock("undici")` 때문에 undici 업그레이드는 기존 테스트가 검증하지 않는다.** `withings.test.ts`와 `google-health.test.ts`가 모듈을 통째로 모킹하므로 어떤 버전에서든 통과한다. Withings·Google Health 동기화를 한 번 실제로 돌려 확인한다.
- **recharts v3의 `.recharts-*` DOM 클래스명 유지 여부가 문서화돼 있지 않다.** 타입체커가 잡지 못하고 화면에서만 드러난다. U10의 사전 스크린샷이 유일한 대조 수단이다.
- **TypeScript 7은 Next 16.3의 `tsc` CLI 호출 방식에 의존한다.** Next를 되돌리면 TS 7도 함께 되돌아가야 한다.
- **TypeScript 7이 플랫폼별 네이티브 바이너리를 배포하면 Docker 빌드에서만 드러날 수 있다.** `node:22-alpine`은 musl이다. `@biomejs/biome`이 같은 패턴을 이미 통과시키고 있어 선례는 있으나, U9의 Verification에 Docker 빌드를 포함한 이유다.
- **로컬 측정치는 Jenkins 에이전트와 하드웨어가 달라 절대 시간이 아니라 비율로만 유효하다.**

---

## Open Questions

- **origin 요구사항 문서의 R10(Message Batches)이 이 계획과 어긋난다.** 계획 단계 실측으로 기각했으나 상위 문서를 고치는 것은 이 계획의 권한 밖이다. origin R10과 관련 Key Decision·Call-out을 갱신할지 판단이 필요하다.
- **개인정보처리방침이 Anthropic 처리를 언급하지 않는다.** `src/app/privacy/page.tsx`의 제3자 제공 절이 "제공하지 않습니다"로 되어 있는데, 거래 내역과 커밋 diff가 Claude로 나간다. 배치와 무관하게 현재도 그러하므로 이번 변경이 만든 문제는 아니지만, 확인된 이상 판단이 필요하다.
- `Github` 마크 인라인 SVG를 공용 컴포넌트로 둘지 각 화면에 인라인할지. 사용처가 두 곳이라 어느 쪽이든 무방하다.
- 내러티브 입력의 새 토큰 한도를 얼마로 잡을지. 스냅샷 크기 분포의 P95를 덮는 최소값으로 정하고, 무조건 크게 잡지 않는다 — 내러티브는 Opus 5 동기 호출이라 한도 상향이 곧 비용이다.
- TypeScript 7에서 Next의 TS 언어 서비스 플러그인이 에디터에서 동작하는지. 빌드와 무관하므로 진행을 막지 않는다.

---

## Sources / Research

**베이스라인 측정** (2026-08-14, Mac17,8 / 18 cores / 48GB): `tsc --noEmit` cold 4.91s / warm 1.21s, `yarn lint` 1.22s, `yarn test` 3.37s(106 파일 / 951 테스트), `yarn build` cold 13.32s / warm 12.38s, `docker build --target tester` 26.33s(레이어 캐시 warm). Docker 26.33초 중 16.7초가 이미지 export·unpack이다. 전체 표는 origin의 Sources 절에 있다.

**선행 실측 (Batch API·캐싱 기각의 근거)**: `docs/superpowers/specs/2026-08-06-anthropic-model-migration-design.md` — 30일 호출량 커밋 요약 511건 / 지출 분류 298건(월 12회 호출) / 내러티브 2건, AI 총지출 월 $5 안팎. Batch API와 Prompt caching을 명시적으로 범위 밖에 둔 문서이고, 그 스펙의 다른 결정은 `src/lib/adapters/ai/claude.ts`에 반영돼 있다.

**프롬프트 캐싱 재판정**: 커밋 요약의 system은 `src/modules/summary/prompts.ts`의 `buildSystemPrompt(repoContext)`가 런타임에 조립하며 레포별 CLAUDE.md 1,000자 + README 500자를 포함한다 — 레포마다 달라지므로 접두사 캐시가 성립하지 않는다. `prompts/commit-system-prompt.txt`(703토큰)는 `src/` 어디에서도 읽히지 않는 미사용 파일이므로 캐싱 판정의 근거가 될 수 없다.

**lucide 영향 범위 실측**: `src/`의 `lucide-react` import를 파싱해 고유 아이콘 113개(95개 파일)를 뽑고 `lucide-react@1.31.0` 설치본의 export와 대조했다. 없어지는 것은 `Github` 하나. `X`는 브랜드가 아니라 닫기 아이콘이라 무관하다.

**Node 고정 실측**: yarn 4.5.0 + `nodeLinker: node-modules` 구성에서 `engines: {"node": "22.x"}`를 두고 Node v24.16.0으로 `yarn install`을 실행하면 경고 없이 exit 0으로 통과한다. Yarn은 `engines`를 강제하지 않는다.

**참조할 코드 위치**
- AI 어댑터의 capability 테이블과 유일한 public 메서드(`generateText`): `src/lib/adapters/ai/claude.ts`
- 클래스 병합 지점: `src/lib/utils.ts`의 `twMerge(clsx(...))`
- 내러티브 절단 로직: `src/modules/overview/narrative.ts`의 `serializeNarrativeInput`(비-export, 동기)

**외부 문서**
- [Next.js TypeScript 설정 (16.3.1)](https://nextjs.org/docs/app/api-reference/config/typescript) — TS 7은 프로젝트 로컬 `tsc` CLI로 동작하며 기본값이다.
- [recharts 3.0 마이그레이션 가이드](https://github.com/recharts/recharts/wiki/3.0-migration-guide)
- [Lucide Version 1 가이드](https://lucide.dev/guide/version-1) — 브랜드 아이콘 전면 삭제, `aria-hidden` 기본 true.

**선행 결정**
- `docs/brainstorms/2026-06-27-ci-smoke-testing-requirements.md` — 테스트 계층을 L1/L2/L4로 한정하고 UI 계층을 제외한 판단. U4의 파서 테스트가 L1에 해당하는 근거.
