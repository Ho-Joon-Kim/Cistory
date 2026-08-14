---
date: 2026-08-14
topic: dependency-upgrade
---

# 의존성 전면 업그레이드 — 요구사항

## Summary

Cistory의 의존성 43개를 한 번에 최신화하고, 새 버전이 여는 기능 중 이 앱에 실익이 있는 것까지 함께 도입한다. 배포는 검증 수단이 기계냐 사람이냐로 두 단계로 가른다.

---

## Problem Frame

`yarn npm audit`에 6개 패키지 57건의 권고가 걸려 있다. 대부분은 이 앱이 쓰지 않는 기능에 대한 것이라 코드에 하나씩 대조해 걸러냈다.

| 패키지 | 선언된 권고 | 실제 해당 | 걸러진 이유 |
|---|---|---|---|
| `next` | 31 | **7** | `middleware.ts` 없음, `'use server'` 0건, `next/image` 0건, rewrites·PPR 설정 없음, 커스텀 서버 아님 |
| `better-auth` | 10 | **1** | 플러그인 배열 자체가 없고 `emailAndPassword`가 비활성 — oidcProvider·mcp·organization 대상 권고가 전부 무관 |
| `undici` | 13 | 0 | SOCKS5·WebSocket·캐시 인터셉터 미사용 |
| `drizzle-orm` | 1 | 0 | 식별자가 전부 하드코딩 — 악용 경로 없음 |
| `fast-xml-parser` | 1 | 0 | 권고는 `XMLBuilder` 대상, 이 저장소는 `XMLParser`만 사용 |
| `recharts` | 1 | — | 정보성: v2 계열 지원 종료 |

남는 8건은 RSC DoS·캐시 오염 계열과 OAuth state 검증 약화다. OwnTracks·Toss 인제스천 엔드포인트가 외부에 열려 있어 DoS는 실질 위험이다.

버전 부채도 같이 쌓였다. `recharts`는 지원이 끊긴 2.x에 고정돼 있고, Node 메이저가 세 개(로컬 24, 배포 22, 타입 20) 돌아다니며 `engines` 선언이 없다. 최신 SDK가 여는 기능 중 셋(Message Batches, 프롬프트 캐싱, 토큰 계수)은 이 앱의 AI 호출 3종에 직접 적용될 수 있는데 하나도 쓰이지 않고 있다.

---

## Key Decisions

- **배포를 티어가 아니라 검증 주체로 가른다.** 긴급도 기준 분할은 "전부 한다"로 해소됐고, 남은 제약은 사람의 검수 대역폭이다. Tailwind와 Radix는 minor라 저위험이지만 조용한 시각 회귀를 낼 수 있어 사람 쪽에 둔다. 그래야 2단계에서 화면이 이상할 때 용의자가 렌더링 패키지 4종으로만 좁혀진다.

- **컴포넌트 테스트를 추가하지 않는다.** `docs/brainstorms/2026-06-27-ci-smoke-testing-requirements.md`가 "혼자 쓰는 서비스라 깊은 테스트는 과하다"는 전제로 테스트 계층을 L1/L2/L4만 깔고 UI 계층을 제외했다. 그 판단을 이번에도 유지한다. recharts 검증이 눈에 의존하는 것은 사고가 아니라 이전 결정의 결과다.

- **`@types/node`는 npm latest가 아니라 배포 런타임에 맞춘다.** 프로덕션이 `node:22-alpine`이므로 22 계열로 간다. 프로덕션에 없는 API를 타입체커가 통과시키지 않는 쪽이 "최신"보다 우선한다.

- **TypeScript 7은 속도가 아니라 도입 비용이 0에 가까워서 넣는다.** 실측으로 이 저장소의 타입체크는 4.91초다. 8~12배가 아끼는 건 약 4초다. 실제 근거는 `tsconfig.json`에 제거된 레거시 옵션(ES5·AMD·classic)이 하나도 없고 JSDoc을 쓰는 파일이 1개뿐이라는 점이다.

- **Message Batches를 크론 AI 2종에만 건다.** 내러티브는 5분 크론이 클라이언트의 10분 폴링 창 안에 결과를 떨어뜨려야 하므로 24시간 batch 창과 맞지 않는다. 지출 분류와 커밋 요약은 사용자를 기다리게 하지 않으므로 적합하다.

- **shadcn 차트 래퍼는 손으로 고치지 않고 재설치한다.** `src/components/ui/chart.tsx`는 recharts의 표면 API가 아니라 내부에 묶여 있다 — Legend `payload` 타입을 직접 참조하고 `.recharts-*` DOM 클래스로 테마를 입힌다. 업스트림 최신본을 받는 편이 수작업 패치보다 안전하다.

---

## Requirements

### 보안 해소

- R1. 실제 해당하는 권고 8건을 닫는다 — `next` RSC DoS·캐시 계열 7건과 `better-auth`의 OAuth state 검증 1건.
- R2. 해당 없음으로 판정된 패키지(`drizzle-orm`, `undici`, `fast-xml-parser`)도 같은 배치에서 함께 올린다. 전부 minor·patch 범위라 비용이 없다.
- R3. 작업 완료 시점 기준으로 `yarn npm audit`에 남는 권고가 없다.

### 버전 최신화

- R4. outdated 43개를 최신으로 올린다. major 4종(recharts 3, lucide 1.x, stream-json 3 / stream-chain 4, TypeScript 7)을 포함한다.
- R5. `@types/node`는 배포 런타임에 맞춘 22 계열로 올린다.
- R6. `package.json`에 `engines.node`를 선언해 개발·배포 Node 메이저 간극이 다시 벌어지지 않게 한다.
- R7. `react-is`를 직접 의존성으로 추가한다. recharts 3에서 peer dependency로 이동해 더 이상 자동으로 딸려오지 않는다.
- R8. recharts 3에서 확정된 두 지점을 고친다 — 다중 Y축 차트의 그리드 렌더 실패, 그리고 shadcn 차트 래퍼의 Legend 타입.
- R9. lucide 1.0에서 제거된 `Github` 아이콘을 두 곳(`src/app/(auth)/login/page.tsx`, `src/modules/settings/components/SettingsForm.tsx`)에서 대체한다. 상표 문제로 브랜드 아이콘이 전부 삭제됐으므로 lucide 안에 대체 이름이 없다.

### 신기능 도입

- R10. 지연에 무관한 크론 AI 작업(지출 분류, 커밋 요약)을 Message Batches로 옮긴다. 내러티브는 제외한다.
- R11. 프롬프트 캐싱은 각 워크로드의 안정 프리픽스가 해당 모델의 최소 캐시 길이를 넘길 때만 적용한다.
- R12. 내러티브 입력 절단을 문자 수가 아니라 토큰 수 기준으로 바꾼다.

### 배포와 검증

- R13. 배포를 두 단계로 나눈다.

  | | 1단계 — 기계가 검증 | 2단계 — 눈이 검증 |
  |---|---|---|
  | 내용 | 보안 배치, 비-UI major, minor 전체, Node 정합성, 신기능 3종 | recharts 3, lucide 1.x, tailwindcss, `@radix-ui/*` |
  | 검증 | `yarn build`, 951개 테스트, 통합 테스트, `/api/health` | 화면 검수 |

- R14. 1단계에서 기계가 못 잡는 두 경로는 수동으로 확인한다 — GitHub 로그인 왕복 1회, Google Takeout 임포트 1회. 전자는 `better-auth` 업그레이드가, 후자는 테스트가 없는 stream-json 파서가 대상이다.
- R15. 2단계는 차트 17개와 `Github` 아이콘을 교체한 두 화면을 눈으로 검수한다. 나머지 112개 아이콘은 1.31.0에 그대로 존재하는 것이 확인됐으므로 검수 대상이 아니다.
- R16. TypeScript 7은 1단계의 마지막 커밋으로 둔다. 타입 에러가 감당 안 되면 그 커밋만 빼고 나머지를 보낼 수 있어야 한다.

### 측정

- R17. 업그레이드 전후의 빌드·테스트·CI 시간을 같은 방법으로 재고 비교한다. 전 측정은 완료됐다(Sources 참조).

---

## Acceptance Examples

- AE1. **Covers R11.** 분류기의 시스템 프롬프트와 카테고리 목록을 합친 길이가 해당 모델의 최소 캐시 프리픽스에 못 미치면 캐싱을 적용하지 않는다. 최소치를 맞추려고 프롬프트를 인위적으로 늘리지 않는다. 측정 결과는 기록한다.
- AE2. **Covers R16.** TS 7 커밋에서 타입 에러가 나오고 원인이 TS 6를 건너뛴 누적 변경이면, 그 커밋을 빼고 1단계 나머지를 배포한다. TypeScript 7은 별도 작업으로 분리한다.
- AE3. **Covers R13, R15.** 2단계 배포 후 화면이 이상하면 용의자는 렌더링 패키지 4종뿐이다. 1단계 항목은 이미 배포되어 정상 동작이 확인된 상태다.
- AE4. **Covers R8.** shadcn 차트 래퍼 재설치 후에도 차트 테마(축 라벨 색, 그리드 선, 툴팁 커서)가 깨져 보이면, recharts 3가 DOM 클래스명을 바꿨다는 뜻이다. 이 경우 래퍼의 스타일 셀렉터를 새 클래스명에 맞춘다.

---

## Success Criteria

- 작업 완료 시점 `yarn npm audit`에 남는 권고가 없다.
- 두 단계가 모두 배포되고 `/api/health` 헬스체크를 통과한다.
- 2단계 검수에서 회귀가 없거나, 있으면 렌더링 패키지 4종 중 어느 것인지 특정된다.
- 업그레이드 후 측정이 전 측정과 같은 방법으로 기록되어 직접 비교 가능하다.
- AI 토큰 비용이 다음 정산 주기에 내려간다.

---

## Scope Boundaries

- **TanStack Charts** — pre-alpha이고 문서가 프로덕션 사용을 금지한다. 1.0 도달과 pie/arc mark 지원이 확인되면 재검토한다.
- **컴포넌트 테스트와 시각 회귀 도구** — 위 Key Decision의 결과. 이번 범위에서 도입하지 않는다.
- **크론 아키텍처의 그 외 변경** — Batches 도입에 필요한 만큼만 손댄다. 리스 큐 패턴 자체를 리팩터링하지 않는다.

---

## Dependencies / Assumptions

- TypeScript 7은 Next 16.3이 컴파일러 JS API 대신 프로젝트 로컬 `tsc` CLI를 호출하도록 바꾼 것에 의존한다. Next 16.3.1이 먼저 들어가야 한다.
- Message Batches의 제출→폴링 형태는 이 저장소가 이미 두 번 쓰는 리스·클레임 큐 패턴(`period_snapshots`, `period_narratives`)을 재사용할 수 있다고 가정한다.
- 프롬프트 캐싱의 실현 여부는 측정에 달렸다. 모델마다 최소 캐시 프리픽스가 다르다.
- recharts v3가 `.recharts-*` DOM 클래스명을 유지하는지는 마이그레이션 문서에 없다. 유지된다고 가정하지 않는다.
- 로컬 측정치는 Jenkins 에이전트와 하드웨어가 달라 절대 시간이 아니라 비율로만 유효하다.

---

## Outstanding Questions

계획을 막는 항목은 없다.

### Deferred to Planning

- `Github` 아이콘을 무엇으로 대체할지. 인라인 SVG로 마크를 넣을지, 일반 아이콘으로 바꿀지.
- recharts v3의 `.recharts-*` 클래스명 변경 여부. shadcn 래퍼 재설치로 대부분 해소될 가능성이 있다.
- TypeScript 7에서 Next의 TS 언어 서비스 플러그인이 에디터에서 동작하는지. 빌드와는 무관하다.
- Batches 도입 시 크론의 단일 실행 가드와 batch 완료 폴링 주기를 어떻게 맞출지.

---

## Sources / Research

**베이스라인 측정** (2026-08-14, Mac17,8 / 18 cores / 48GB / Node v24.16.0)

| 항목 | 시간 |
|---|---|
| `tsc --noEmit` (cold) | 4.91s |
| `tsc --noEmit` (warm, incremental) | 1.21s |
| `yarn lint` (Biome, 535 파일) | 1.22s |
| `yarn test` (106 파일 / 951 테스트) | 3.37s |
| `yarn build` (cold) | 13.32s |
| `yarn build` (warm) | 12.38s |
| `docker build --target tester` (레이어 캐시 warm) | 26.33s |

Docker 26.33초 중 16.7초가 이미지 export·unpack이다. CI 시간은 타입체크나 번들링이 아니라 Docker 레이어 처리와 헬스체크(최대 15회 × 5초)가 지배한다.

**업그레이드 후 측정** (2026-08-14, 같은 머신 / Node v22.23.2)

| 항목 | 전 | 후 | 변화 |
|---|---|---|---|
| `tsc --noEmit` (cold) | 4.91s | **1.11s** | −77% |
| `tsc --noEmit` (warm) | 1.21s | **0.43s** | −64% |
| `yarn lint` | 1.22s (535 파일) | **0.84s** (481 파일) | −31% |
| `yarn test` | 3.37s (106 파일 / 951) | **3.42s** (107 파일 / 990) | +1% |
| `yarn build` (cold) | 13.32s | **11.34s** | −15% |
| `yarn build` (warm) | 12.38s | **3.69s** | −70% |
| `docker build --target tester` | 26.33s | **21.58s** | −18% |

세 가지 단서를 붙여야 이 표가 정직하다.

**Node 메이저가 다르다.** 베이스라인은 v24.16.0에서, 이 측정은 v22.23.2에서 쟀다.
U3이 `.node-version`을 22로 고정해 배포 환경과 맞춘 결과다. Node 위에서 도는
도구(vitest, next)는 이 차이의 영향을 받고, Go로 빌드된 tsc 7과 Rust로 빌드된
Biome은 받지 않는다. 즉 타입체크 수치가 가장 깨끗한 비교다.

**lint 개선은 두 원인이 섞여 있다.** 검사 대상이 535 → 481 파일로 줄었는데, 이는
죽은 코드 56개 삭제 때문이지 Biome이 빨라져서가 아니다. 파일당으로 환산하면
2.28ms → 1.75ms로, 여전히 개선이지만 −31%보다는 작다.

**warm 빌드의 −70%는 Next 16.3의 turbopack 빌드 디스크 캐싱이다.** 16.3에서
기본 활성이며, cold 빌드가 −15%에 그친 것과 대비하면 이 항목이 어디서 왔는지
분명하다. CI는 매번 새 컨테이너라 cold에 가깝고, 따라서 이 −70%는 로컬 반복
빌드에서만 체감된다.

`yarn test`가 미미하게 느려진 것은 테스트가 951 → 990개로 39개 늘었기 때문이다
(U4의 Takeout 파서 특성화 26개, U8의 내러티브 예산 테스트 등). 테스트당 시간은
3.54ms → 3.45ms로 오히려 줄었다.

Docker는 소스 레이어를 실제로 무효화한 조건에서 쟀다. 완전 캐시 상태의 무변경
재빌드는 1.00초로 떨어지지만 CI에는 그런 빌드가 없으므로 비교 대상이 아니다
(`touch`만으로는 무효화되지 않는다 — Docker의 COPY 캐시 키는 mtime이 아니라
내용 해시다).

**감사 방법** — `yarn npm audit --severity low --json`으로 권고를 수집하고, 각 권고의 취약 조건을 `src/`, `next.config.ts`, `Dockerfile`, `src/lib/auth.ts`에 대조해 해당 여부를 판정했다.

**lucide 영향 범위 실측** — `src/`에서 `lucide-react` import를 파싱해 고유 아이콘 113개(95개 파일)를 뽑고, `lucide-react@1.31.0`을 임시로 설치해 실제 export와 대조했다. 1.31.0에 없는 것은 `Github` 하나다. `X`는 브랜드가 아니라 닫기 아이콘이라 영향이 없다. 이름 변경 목록을 읽고 추정한 게 아니라 설치본과 직접 비교한 결과다.

**외부 문서**

- [Next.js TypeScript 설정 (16.3.1)](https://nextjs.org/docs/app/api-reference/config/typescript) — TS 7은 프로젝트 로컬 `tsc` CLI로 동작하며 이것이 기본값이다.
- [recharts 3.0 마이그레이션 가이드](https://github.com/recharts/recharts/wiki/3.0-migration-guide)
- [recharts#7361](https://github.com/recharts/recharts/issues/7361) — v2 계열 지원 종료 공지.
- [TypeScript 7.0 발표](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Lucide Version 1 가이드](https://lucide.dev/guide/version-1) — 상표 문제로 브랜드 아이콘 전면 삭제, ESM·CJS만 지원, `aria-hidden` 기본값 true.

**저장소 내 선행 결정**

- `docs/brainstorms/2026-06-27-ci-smoke-testing-requirements.md` — 테스트 계층을 L1/L2/L4로 한정하고 UI 계층을 제외한 판단.
