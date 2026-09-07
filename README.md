# Cistory

GitHub 커밋, 코딩 시간, 위치, 소비, 자산과 건강 기록을 모아 개인의 하루와 기간별 회고를 보여주는 서비스입니다. Next.js App Router, PostgreSQL/PostGIS, Drizzle, Better Auth를 사용합니다.

## 로컬 개발

Node **24.20.0** (`.node-version`)과 Yarn **4.5.0**을 사용합니다. Docker와 Jenkins 이미지도 같은 Node 버전으로 고정합니다.

```sh
corepack enable
corepack prepare yarn@4.5.0 --activate
yarn install --immutable
cp .env.example .env.local
# .env.local의 DB, GitHub OAuth, Better Auth 설정을 입력
yarn dev
```

http://localhost:3000 에서 실행됩니다. GitHub OAuth 콜백은 `/api/auth/callback/github`입니다. PostgreSQL에 PostGIS가 필요합니다. 새 DB는 Drizzle 마이그레이션과 별도로 Better Auth의 `user`, `account`, `session`, `verification` 테이블도 현재 인증 설정에 맞게 준비해야 합니다. 기존 운영 DB에는 이 인증 테이블이 이미 있습니다.

`ANTHROPIC_API_KEY`는 AI 요약에 사용합니다. 개인 기록 일부가 Anthropic에 전달되는 범위는 `/privacy`에 설명되어 있습니다. Withings·Google Health·KIS 등 선택적 연결은 설정 화면에서 관리합니다. 비밀 값은 저장소에 넣지 않습니다.

## 검증

```sh
yarn typecheck
yarn lint
yarn test
yarn build
# Docker PostgreSQL 시작 + 마이그레이션 + 실제 SQL 회귀 검증
yarn test:integration
yarn db:test:down
# 최초 1회 Chromium 설치
yarn exec playwright install chromium
BROWSER_TEST_PRODUCTION=true yarn test:browser
```

통합 테스트는 `TEST_DATABASE_URL` 또는 기본 로컬 테스트 DB(5433)를 사용합니다. 반드시 폐기 가능한 DB만 지정하세요. 브라우저 테스트는 `.env`를 제외한 임시 앱과 가짜 API를 사용하며 실제 계정이나 외부 수집 API를 호출하지 않습니다. 기본 포트는 3210이며 테스트가 띄운 서버만 종료합니다.

## 배포와 마이그레이션

배포는 **Jenkinsfile**이 담당합니다. 단위·브라우저·DB 통합 검증 뒤 이미지를 빌드하고, main에서 마이그레이션 → 웹·cron 컨테이너 교체 → HTTP 및 cron 준비 상태 확인 순서로 진행합니다. `Dockerfile`의 standalone instrumentation 보정 스크립트를 제거하지 마세요. Next의 서버 추적 결과에 누락될 수 있는 cron 코드와 의존성을 포함합니다.

웹 컨테이너는 `DISABLE_CRON=true`, cron 컨테이너는 이 변수를 설정하지 않습니다. 같은 이미지를 사용하지만 작업을 분리합니다. 기존 Jenkins의 환경 파일·자격 증명과 컨테이너 이름은 그대로 사용합니다. 공개 환경 변수는 빌드 인자로 전달하고, 비밀 값은 런타임에 전달합니다.

스키마 변경은 `yarn db:generate` 후 SQL을 검토합니다. Jenkins는 migrator 이미지에 포함된 실행기를 통해 `scripts/migrate.ts`를 실행합니다. 이번 `0042_data_recovery.sql`은 사용자별 수집 상태와 재수집 큐 두 테이블을 추가합니다. 앱을 시작하기 전에 적용해야 합니다. 기존 기록을 수정하거나 삭제하지 않습니다.

## 백업과 복구

운영 DB는 배포 전 별도 보관 장소에 `pg_dump --format=custom`으로 백업하고, 암호화 키와 런타임 환경 파일도 접근을 제한해 별도 보관합니다. DB 백업만으로 암호화된 연동 자격 증명을 복원할 수는 없습니다. 환경 파일과 백업을 Git에 넣지 마세요.

```sh
# BACKUP_DATABASE_URL에는 백업 대상, RESTORE_DATABASE_URL에는 새 복구용 DB를 지정
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --file=cistory.dump
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --exit-on-error cistory.dump
```

복구는 PostGIS가 준비된 별도 빈 DB에서 먼저 검증하고, 인증·기록 조회·마이그레이션 버전을 확인한 뒤 웹과 cron이 같은 복구 DB를 보도록 전환합니다. 기존 운영 DB에 `--clean`을 실행하는 방식으로 시험하지 않습니다. 이 작업에서는 실제 운영 백업·복구·배포를 실행하지 않았습니다.

## 수집 상태와 기간 재수집

**설정 → 수집 상태** (`/data-status`)에서 소스별 연결, 최근 동기화 성공, 선택 기간의 마지막 기록, 날짜별 기록을 확인합니다. 조회·재수집 기간은 한국 시간으로 오늘까지 최대 31일입니다. 기록 없는 날은 활동 자체가 없었을 수도 있으므로 미확인으로 표시합니다.

- WakaTime: 일별 세션·합계 재조회. 제공자의 기록 보관 기간과 요금제 제한을 따릅니다.
- Withings: 해당 날짜의 체성분 측정 재조회.
- Google Health: 수치 지표 재조회. 수면·운동 세션과 휴대폰에만 있는 Health Connect 기록은 기존 동기화·휴대폰 재전송을 사용합니다.
- GitHub·위치·토스·KIS: 각 소스의 기존 동기화, 파일 가져오기, 기기 재전송 등 가능한 복구 경로를 안내합니다. 과거 자산 스냅샷이나 수신하지 않은 알림을 만들어 내지 않습니다.

재수집은 cron에서 분 단위로 최대 3일씩 처리합니다. 큐·날짜별 진행 위치와 작업 임대를 PostgreSQL에 저장하므로 페이지를 닫거나 배포로 재시작되어도 이어집니다. 같은 사용자·소스는 한 작업만 진행하며 만료된 작업은 최대 3번 다시 인계합니다. API 실패는 실패 날짜를 표시하므로 연결 상태를 확인해 다시 요청할 수 있습니다. 완료·부분 실패 때 해당 기간의 회고 캐시를 갱신 대상으로 돌립니다.

## 코드 위치

`src/app`: 화면·API / `src/modules`: 기능별 서비스·UI / `src/db`: 스키마·DB / `src/lib`: 공통 통합 / `drizzle`: 마이그레이션 / `scripts`: 운영·검증 스크립트 / `docs`: 진단 및 검증 기록.
