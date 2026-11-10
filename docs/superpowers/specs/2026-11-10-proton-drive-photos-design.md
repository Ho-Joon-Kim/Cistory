# Proton Drive 사진 연동 (수집 계층) 설계

작성일 2026-11-10. 대상은 Cistory 운영 환경으로, 소유자 1인이 쓰는 서비스다.

## 1. 의도와 범위

폰 사진은 Proton Drive Photos에 자동으로 백업된다. 이 사진을 Cistory 데이터와 같은 시간축에 올리는 것이 최종 목표다.
대시보드 타임라인과 `/travel` 상세가 그 대상이다.

**이번 범위는 수집 계층만이다.**
- 연결(로그인)
- 동기화(초기 백필과 이벤트 증분)
- 저장(메타데이터와 위치)
- 썸네일을 꺼내는 API
- 운영에 필요한 부속: 연결 상태, 해제, 계정 삭제, 개인정보 처리

**비목표:**
- 대시보드·여행 화면에 사진을 표시하는 UI. 디자인은 아직 정하지 않았고, 다음 단계에서 이 테이블 위에 만든다.
- 원본 이미지 다운로드와 저장.
- 검색(`/search`) 통합과 `/overview` 집계.
- 앨범과 공유 기능.
- 사진 업로드와 수정, 그 밖의 Proton 쪽 쓰기 작업.

**반목표** (기술적으로 돌아가더라도 이렇게 되면 실패다):
- 계정 비밀번호가 Cistory 서버를 거치거나 저장된다.
- 주기적으로 전체 목록을 다시 훑는다. Proton 정책 위반이다.
- 촬영 시각을 KST로 재해석해서 9시간 어긋난다.
- OwnTracks로 추정한 위치가 사진에 원래 있던 GPS처럼 보인다.
- NSFW 사진의 썸네일이나 메타데이터가 Cistory DB나 API에 남는다.

## 2. 이미 정해진 것 (소유자 결정과 실험 결과)

**소유자 결정 (2026-11-10)**
- 서버가 Proton 세션을 직접 보관한다(B안).
- 해당 Proton 계정은 Mail과 사진 백업에만 쓴다. 세션이 Mail까지 복호화할 수 있다는 점은 감수한다.
- 이벤트 기반 동기화를 선호한다.
- **NSFW는 수집 단계에서 미리 차단한다.** 화면 단계로 미루지 않는다(소유자 결정, 2026-11-10).
  - 분류는 서버 안의 로컬 모델로 한다. 사진을 외부 API로 보내지 않는다.
  - NSFW로 판정된 사진은 아예 저장하지 않는다. 사진 행과 썸네일을 남기지 않고, 다시 들어오지 않도록 `node_uid`만 기억한다.

**실험에서 확인한 사실** (`@protontech/drive-sdk` 0.23.0, SDK 저장소 `05c9115`, Node 24)
- **로그인:**
  - 세션 포크 방식으로 로그인에 성공했다.
    - `authClientId: "external-drive"`
    - `x-pm-appversion: external-drive-cistory@<semver>-stable`
  - 비밀번호, 2FA, CAPTCHA는 모두 Proton 페이지에서 처리된다.
  - 포크 상태 조회는 준비되기 전에는 422를 돌려준다.
  - 포크 응답은 `UID`, `AccessToken`, `RefreshToken`, 그리고 AES-GCM으로 암호화된 `keyPassword` payload다. 복호화 키는 sign-in URL fragment에 넣은 키이고, AAD는 `"fork"`다.
- **Node에서 돌리기:** Bun을 쓰는 공식 CLI와 달리 Node에서는 두 가지가 필요하다.
  - Proton이 SDK 저장소에 둔 `@protontech/crypto@2.2.0` 패치(`openpgp/lightweight` → `openpgp`).
  - `core-js/proposals/array-buffer-base64` 폴리필. 없으면 `Uint8Array.prototype.toHex`가 없어서 사용자 키 복호화에 실패한다.
- **사진 규모:** 8,491장(2019-01 ~ 2026-11). `iterateTimeline()` 전체 조회에 19초가 걸렸다. `iterateNodes` 50장은 약 4초다.
- **`photo.captureTime`은 정확한 UTC 시각이다.**
  - 해외 4개 여행에서 사진 GPS와 같은 시각 OwnTracks 위치의 거리 중간값이 0~20m였다.
  - 시각을 몇 시간 밀면 오히려 어긋났다.
  - `Camera.CaptureTime`은 `...Z` 형식이고 서버 값과 같다.
- **GPS 보유율:**
  - 일반 샘플은 49장 중 18장이었다.
  - 대만(2025-04)과 베트남(2025-07) 여행은 0장이다.
  - 일본(2025-11)과 홍콩(2026-03) 여행은 S25 Ultra 사진 거의 전부에 GPS가 있다.
  - GPS가 없는 사진은 약 70%가 ±15분 안에 OwnTracks 기록이 있다.
- **태그:** `tags` 값 8(SDK enum으로는 Panoramas)이 3,108장에 붙어 있다. 폰 앱과 SDK의 enum이 서로 다른 것으로 보이므로 태그는 해석하지 않고 원본 값만 저장한다.
- **썸네일:** `iterateThumbnails`로 받은 썸네일은 장당 약 50KB다.
- **이벤트:** `iterateEvents(scopeId)`를 커서 없이 부르면 `fast_forward` 이벤트 하나와 함께 기준 커서를 준다.
  - scope id는 사진 노드의 `treeEventScopeId`(= photos volume id)다.

## 3. 구성

### 3.1 의존성과 어댑터 (`src/lib/adapters/proton/`)

**런타임 의존성**
- `@protontech/drive-sdk@0.23.0`: 정확한 버전으로 고정한다. README에 따르면 2026년 말~2027년 초에 호환되지 않는 암호 모델 변경이 예고돼 있다.
- `@protontech/crypto@2.2.0`
  - Yarn `patch:` 프로토콜로 Proton이 제공한 패치를 적용한다.
  - **GPL-3.0**이다. 저장소는 공개 상태지만, 이 코드를 소스에 복사하지 않고 의존성으로 참조만 한다. 서버에서 실행만 하므로 배포 의무는 생기지 않는다고 판단한다(AGPL이 아님).
- `core-js`: array-buffer-base64 proposal만 불러온다.
  - 어댑터 진입 모듈 맨 위에서 import한다. `@protontech/crypto` 코드보다 먼저 로드돼야 하므로, 이 어댑터를 통하지 않고 crypto를 import하는 일이 없게 한다.
- **Dockerfile:** `deps`와 `browser-tester` 단계에서 `yarn install --immutable`을 실행하기 전에 `COPY .yarn/patches ./.yarn/patches`를 추가한다. 이 줄이 없으면 patch 의존성을 풀지 못해서 모든 CI 빌드가 실패한다.

**계정 모듈**
- `incubating/account/js/src`(MIT)를 `src/lib/adapters/proton/account/`로 복사해 온다.
- 파일 상단에 출처 커밋과 라이선스를 적는다.
- 수정은 최소한으로 한다. 바꾸는 곳은 두 군데다.
  1. 세션 포크를 "시작"과 "한 번 조회"로 나눈다(3.3).
  2. `ApiClient.performTokenRefresh`와, 거기서 4xx를 받으면 `signOut`하는 분기를 주입받은 refresher로 넘긴다(3.4 토큰 갱신).
     - refresher는 사용자별 `pg_advisory_xact_lock('proton-token:<userId>')` 안에서 갱신 POST 자체를 실행한다.
     - 원본 모듈은 메모리의 refresh token으로 바로 POST한 다음 직접 `signOut`한다. 그래서 `setSessionInfo` 쪽에서 잠금을 걸어서는 동시 갱신을 막을 수 없다.

**`@protontech/crypto`의 패키징 주의점**
- 이 패키지는 TS 소스를 그대로 배포한다. Next 번들과 standalone 출력, 그리고 cron 컨테이너에서 로드돼야 한다.
- **`transpilePackages`로 정한다.** Node 24는 node_modules 아래의 TS에 type stripping을 하지 않는다(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). 그래서 `serverExternalPackages`로 두면 런타임에서 로드에 실패한다.
- Vitest도 `server.deps.inline`에 넣는다. 그래야 `_routes-import.test.ts`가 새 라우트를 import할 수 있다.
- `yarn typecheck`가 이 패키지의 `.ts` 소스까지 따라 들어가 오류를 내면, tsconfig `paths`나 별도 d.ts shim으로 막는다.
- 검증은 `yarn build`, standalone 부팅, `yarn test`로 한다.
- crypto worker pool은 쓰지 않는다. SDK CLI처럼 같은 스레드의 `CryptoApi` 엔드포인트를 쓴다.

**`createProtonPhotosClient(connection)`**
- `ApiClient`, `SessionCredentials`, `Addresses`, `ProtonDrivePhotosClient`를 조립한다.
- 캐시는 요청 단위 `MemoryCache`를 쓴다.
- 엔티티와 암호 캐시는 DB에 저장하지 않는다. 키를 디스크에 남기지 않기 위해서다.

### 3.2 스키마 (마이그레이션 1개)

**`proton_connections`** (사용자당 1행, `users` 삭제 시 cascade)
- `uid_enc`, `access_token_enc`, `refresh_token_enc`, `key_password_enc`: `src/lib/crypto.ts`로 AES-256-GCM 암호화한다.
- `status`: `pending` | `active` | `needs_reauth`
- `pending_fork_selector`, `pending_fork_key_enc`, `pending_fork_expires_at`: 로그인 진행 중에만 채운다.
  - `status = pending`은 처음 연결하는 중일 때만 쓴다. 이미 `active`나 `needs_reauth`인 연결은 재연결하는 동안에도 상태를 바꾸지 않는다.
  - 포크가 만료되면(`pending_fork_expires_at` 경과) 다음 상태 조회나 cron에서 `pending_*`를 비운다.
  - 처음 연결하다가 만료된 행은 삭제한다.
- `volume_id`: 사진 scope id.
- `event_cursor`: 마지막으로 반영한 event id.
- `timeline_listed_at`: 전체 목록 읽기(백필 2단계)를 끝낸 시각. 이 값이 null일 때만 목록을 읽는다.
- `backfill_completed_at`
- `last_synced_at`, `last_error`. `last_error`에는 Proton이 돌려준 내용을 그대로 넣지 않고 고정된 한국어 문구만 넣는다.

**`photos`** (`users` 삭제 시 cascade, unique `(user_id, node_uid)`)
- **식별:** `node_uid`, `main_photo_node_uid`(nullable), `content_hash`
- **시각과 형식:** `captured_at` timestamp(UTC wall time, Drizzle 규약), `media_type`, `width`, `height`, `duration_sec`
- **위치:**
  - `lat`, `lon`: double, nullable.
  - `location_source`: `exif` | `owntracks` | null
  - `location_gap_sec`: OwnTracks로 추정한 경우 기준 시각과의 차이.
- **원본 정보:** `device`, `tags` int[](원본 값 그대로), `claimed_metadata` jsonb(검증된 Location/Camera/Media 원본)
- **상태:** `trashed_at`, `deleted_at`(soft delete. `node_deleted` 이벤트 또는 전체 목록 재대조에서 사라진 것을 반영), `details_synced_at`(null이면 목록에서만 확인한 행), `location_checked_at`
- **시도 기록:** `details_attempts`, `details_error`(고정 문구), `thumbnail_attempts`
- **값 출처:** `trashed_at`은 노드의 `trashTime`, `content_hash`는 `photo.contentHash`, `main_photo_node_uid`는 `photo.mainPhotoNodeUid`에서 세부 정보를 채울 때 함께 쓴다.
- **인덱스:** `(user_id, captured_at)`

**`photo_blocks`** (`users` 삭제 시 cascade, unique `(user_id, node_uid)`)
- `node_uid`, `blocked_at`, `model_version`.
- 시각, 위치, 점수, 이미지는 저장하지 않는다. 이 테이블은 "이 노드는 다시 가져오지 말 것"이라는 표시일 뿐이다.

**`photo_thumbnails`** (`photo_id` FK cascade)
- `bytes` bytea, `fetched_at`
- **cron이 미리 받아 둔다.** 세부 정보를 채우는 단계(백필 3단계와 증분 upsert)에서 같은 배치의 썸네일을 `iterateThumbnails`로 함께 받는다. 8.5k장이면 약 420MB다.
  - web 컨테이너는 Proton을 호출하지 않는다. 썸네일 요청마다 키 체인을 복호화하는 CPU 작업이 web 이벤트 루프를 막을 수 있기 때문이다. cron 컨테이너를 따로 둔 이유와 같다.
- 썸네일만 실패한 경우는 사진 행 자체를 실패로 보지 않는다. `thumbnail_attempts`만 올리고 다음 tick에 다시 시도한다(최대 3회).

### 3.3 연결 흐름 (설정 > 연동 카드)

1. **연결 시작:** `POST /api/proton/connect` (세션 인증 + same-origin 검사)
   - 서버는 `sessionForksInit`을 호출하고 sign-in URL과 AES 키를 만든다.
   - selector와 키를 암호화해 `pending`으로 저장한 뒤 `{ signInUrl, expiresAt }`를 돌려준다(10분).
2. **링크 표시:** 카드에 링크와 다음 안내 문구를 보여준다.
   - "Cistory는 Proton의 공식 앱이 아닌 개인 서드파티 앱입니다. 로그인은 Proton 페이지에서 진행되며 비밀번호는 Cistory로 전달되지 않습니다."
3. **완료 확인:** `GET /api/proton/connect/status` (세션 인증)
   - 클라이언트가 5초 간격으로 호출하고, 서버는 호출마다 `sessionForksStatus`를 한 번만 조회한다. 서버 쪽에 긴 대기 루프를 두지 않는다.
   - 422면 `pending`을 돌려준다.
   - 성공하면 payload를 복호화해 `active`로 바꾸고 `volume_id`를 찾아 둔다. 백필은 cron이 시작한다.
- **재연결:** `active`나 `needs_reauth` 상태에서 연결을 시작해도 포크 정보는 `pending_*` 컬럼에만 쓴다. 기존 토큰은 로그인이 성공할 때까지 유지한다.
  - 성공하면 `volume_id`를 비교한다.
  - 같으면 사진 행은 유지하고, 새 커서를 받은 뒤 `tree_refresh`와 같은 재대조를 한 번 돌려 그사이 변경을 메운다.
  - 다르면 다른 계정이므로 이전 세션을 revoke한다. 그다음 기존 사진과 썸네일을 지우고 처음부터 백필한다.
  - 어느 쪽이든 `timeline_listed_at`과 `backfill_completed_at`을 null로 돌린다.
4. **해제:** `DELETE /api/proton` (세션 인증 + same-origin 검사)
   - Proton 세션을 로그아웃(revoke)하는 것은 최선 노력으로 하고, 실패해도 계속한다.
   - revoke가 실패하면 응답에 고정 안내를 담는다. "Proton 계정 설정의 세션 목록에서 Cistory 세션을 직접 삭제해 주세요." 세션이 Mail까지 복호화할 수 있어서 남겨 두면 안 되기 때문이다.
   - 연결 행, `photos`, `photo_thumbnails`를 삭제한다.

카드는 기존 연동 카드 패턴을 그대로 따른다(WakaTime 카드와 같은 모양). 연결됨 상태에서는 사진 수, 마지막 동기화 시각, 백필 진행 여부만 보여준다. 이 카드는 디자인 대상이 아니라 운영 UI다.

### 3.4 동기화 (cron 컨테이너)

**스케줄:** `*/10 * * * *` `syncProtonPhotos`, `timezone: "Asia/Seoul"`
- 사용자별 `pg_try_advisory_lock`으로 한 번에 하나만 돌게 한다. SDK가 "이벤트 구독은 인스턴스 하나만"을 요구하기 때문이다.
  - 세션 단위 잠금이라 pool에서 전용 client를 하나 빌려 잡고, `finally`에서 같은 client로 unlock한 뒤 반납한다.
  - 잠금을 못 잡으면 그 tick은 건너뛴다.
- **한 tick의 순서:** 증분 이벤트 처리 → (백필 중이면) 백필 단계 → 위치 보정.
  - 기준 커서는 백필을 시작할 때 이미 받아 두므로, 이벤트는 백필 중에도 매 tick 처리한다. 백필 도중 생긴 삭제와 새 사진도 바로 반영된다.

**초기 백필** (`backfill_completed_at IS NULL`. 2단계는 `timeline_listed_at IS NULL`일 때만 실행)
1. 먼저 `iterateEvents(volumeId)`로 기준 커서를 받아 저장한다. 백필하는 동안 생긴 변경을 놓치지 않기 위해서다.
2. **전체 목록은 백필 한 번에 한 번만 읽는다.** `iterateTimeline()` 결과(`nodeUid`, `captureTime`, `tags`)를 `photos`에 바로 upsert하고, `details_synced_at`은 null로 둔다. 촬영 시각은 이 시점에 확정된다.
   - 이번 목록에 없는 기존 행은 `deleted_at`으로 표시한다. 단 `main_photo_node_uid`가 있는 연관 사진(Live Photo 등)은 목록에 나오지 않을 수 있으므로 여기서 지우지 않는다. 연관 사진은 원본 사진이 삭제될 때 함께 표시한다. `tree_refresh` 뒤의 재대조도 같은 절차다.
   - 끝나면 `timeline_listed_at`을 기록한다.
3. 그다음 tick부터 `details_synced_at IS NULL`이고 `details_attempts < 3`인 행을 최대 500개씩 `iterateNodes`로 읽어 세부 정보를 채운다. 한 tick에 500장으로 제한하는 건 cron 이벤트 루프를 오래 붙잡지 않기 위해서다. 8.5k장이면 3시간 안에 끝난다.
   - 복호화하거나 파싱하지 못한 노드는 `details_attempts`를 올리고 `details_error`를 남긴다. 3회 실패한 행은 이후 선택에서 빠진다. 그래서 행 하나가 백필 전체를 막지 못한다. 실패 건수는 연결 카드와 `/data-status`에 보인다.
4. 세부 정보가 비어 있고 시도가 3회 미만인 행이 남지 않으면 `backfill_completed_at`을 기록한다.
5. 그래서 목록 전체를 다시 읽는 일은 처음 연결할 때, `tree_refresh`를 받았을 때, 재연결할 때만 생긴다.

**증분 동기화**
- `iterateEvents(volumeId, cursor)`를 끝까지 읽는다.
  - `node_created` / `node_updated`: `iterateNodes([uid])` 후 upsert한다. 사진이 아닌 노드는 건너뛴다.
  - `node_deleted`: `deleted_at`을 기록한다.
  - `fast_forward`: 커서만 앞으로 옮긴다.
  - `tree_refresh`: `timeline_listed_at`과 `backfill_completed_at`을 null로 돌린다. 다음 tick이 전체 목록을 다시 대조하고, 없어진 사진은 `deleted_at`으로 표시한다.
  - `tree_remove`: `needs_reauth`로 바꾸고 고정 오류 문구를 남긴다.
  - **커서 거부:** events 엔드포인트가 저장된 커서를 거부하는 경우다. 인증 오류(401/403)와는 따로 처리하며, 404·422 등 커서 관련 4xx가 여기에 해당한다. 이때는 `tree_refresh`와 같이 처리한다. 새 기준 커서를 받고 전체 재대조를 한 번 돌린다.
- 커서는 그 이벤트 묶음을 DB에 반영한 **같은 트랜잭션 안에서** 저장한다.
- 429를 받으면 그 tick을 건너뛴다. 다음 tick이 자연스러운 백오프가 된다.

**토큰 갱신**
- `ApiClient`가 401을 받으면 갱신한다.
- 갱신 구간만 사용자별 `pg_advisory_xact_lock`으로 직렬화한다. 잠근 범위 안에서 갱신 POST 자체를 실행한다(3.1의 계정 모듈 수정 2).
  - lock을 잡은 뒤 DB에서 토큰을 다시 읽는다. 요청에 쓴 토큰과 다르면 다른 프로세스가 이미 갱신한 것이므로 POST를 건너뛰고 그 토큰을 쓴다.
  - 기존 `withings-token`·`kis-token` 패턴과 같다.
- web은 Proton을 호출하지 않으므로(3.5), 실제로 갱신하는 곳은 cron과 연결 API뿐이다.
- 갱신된 토큰은 `SessionCredentials.setSessionInfo`에서 암호화해 저장한다. 갱신 토큰이 응답에서 빠지면 기존 값을 유지한다.
- 갱신 시 429 외의 4xx가 오면 `needs_reauth`로 바꾼다. 단, lock 안에서 다시 읽은 토큰이 요청에 쓴 토큰과 같을 때만 그렇게 한다. 다르면 새 토큰으로 다시 시도한다. 일시적인 네트워크 오류나 5xx로는 `needs_reauth`로 바꾸지 않는다(기존 규약).

**위치 보정** (같은 cron, upsert 후)
- **대상은 `details_synced_at IS NOT NULL`인 행뿐이다.** 세부 정보를 읽기 전에는 EXIF GPS가 있는지 알 수 없다. 그 상태에서 OwnTracks 위치를 채우고 확정해 버리면, 원래 GPS가 있던 사진이 추정 위치로 굳는다.
- `exif` 좌표가 없는 사진은 `location_points`(`anomaly IS NOT TRUE`)에서 `captured_at` ±15분 안의 가장 가까운 점을 찾아 `owntracks`로 채운다.
- **촬영일(KST)이 정착했으면 확정한다.** 다음 중 하나면 결과를 확정하고 `location_checked_at`을 기록한다.
  - (a) 그 날짜의 `location_processing_days` 행이 `completed`이고, `point_count`가 현재 그 날짜의 점 개수와 같다. `candidateDates()`가 쓰는 정착 판정과 같은 기준이다.
  - (b) 그 날짜가 위치 파이프라인의 후보 창(45일)보다 오래됐다. 처리 기록이 없는 날이 여기에 해당한다. OwnTracks를 쓰기 전인 2019년 같은 날짜나 점이 0개인 날이다. 파이프라인이 이런 날을 다시 처리하는 일은 없다.
  - 확정 전에는 `owntracks`로 채운 행과 null 행을 매 tick 다시 계산한다. 늦게 도착한 점, 그리고 01:00 파이프라인이 나중에 anomaly로 표시한 점까지 반영하기 위해서다.
- 그래서 백필한 과거 사진은 (a)나 (b)로 한 번에 확정된다. 매 tick 다시 계산하는 대상은 최근 45일 안에서 아직 정착하지 않은 날짜뿐이다.
- 나중에 파일 가져오기로 과거 위치가 추가되는 경우는 이번에 다루지 않는다. 필요하면 `location_checked_at`을 null로 되돌리는 스크립트로 해결한다.
- 보정 SQL은 `captured_at`과 `location_points.timestamp`가 둘 다 UTC wall time이라는 전제로 짠다. 이 전제는 통합 테스트로 고정한다.

### 3.4a NSFW 차단 (cron, 세부 정보 단계)

**모델**
- NSFWJS(MIT)를 순수 JS/wasm 백엔드로 실행한다. 컨테이너가 Alpine(musl)이라 glibc 전용 네이티브 바이너리(tfjs-node, onnxruntime-node 기본 빌드)는 쓰지 않는다.
- 모델 가중치는 이미지에 포함한다. 런타임에 다운로드하지 않는다.
- `model_version`을 코드 상수로 둔다.
- 모델은 cron 프로세스에서만 로드한다. web은 로드하지 않는다.

**판정 흐름** (세부 정보를 채우는 모든 경로. 백필 3단계와 증분 `node_created`/`node_updated`)
1. `iterateThumbnails`로 받은 썸네일을 메모리에서 분류한다. 동영상은 썸네일 프레임으로 판정한다.
2. 차단 기준은 클래스 점수 `porn + hentai ≥ 0.5` 또는 `sexy ≥ 0.8`이다.
   - 놓치는 것보다 과하게 차단하는 쪽을 택한다. 값은 상수로 두고, 실측해서 조정해도 된다(빌더 재량).
3. 차단이면 한 트랜잭션에서 다음을 처리한다.
   - 해당 `photos` 행을 삭제한다. 목록 단계에서 만든 행도 포함한다.
   - `photo_blocks`에 `node_uid`를 기록한다.
   - 썸네일 바이트는 버리고 어디에도 쓰지 않는다. 로그와 Sentry에도 남기지 않는다.
4. 통과면 그때 비로소 썸네일과 세부 정보를 저장한다.

**실패하면 막는다**
- 분류에 실패하면(모델 로드 실패, 디코딩 실패, 썸네일 없음) 썸네일을 저장하지 않는다. 세부 정보도 확정하지 않는다(`details_attempts` 증가).
- 3회 실패하면 행은 남기되 썸네일 없이 `details_error`로 표시한다. 판정되지 않은 이미지가 저장되는 경로는 없다.
- 목록 단계에서만 만든 행(시각, 태그)은 판정 전까지 어떤 API에도 노출하지 않는다. 노출은 `details_synced_at IS NOT NULL`인 행으로 한정한다.

**재수집 방지**
- 백필 목록 단계, 이벤트 `node_created`/`node_updated`, 재대조 모두 `photo_blocks`에 있는 `node_uid`는 건너뛴다.
- 연관 사진(`main_photo_node_uid`)은 따로 판정한다. 원본 사진이 차단되면 연관 사진도 차단한다.

**모델 교체**
- `model_version`이 바뀌어도 기존 통과 사진을 자동으로 재판정하지 않는다.
- 필요하면 저장된 썸네일로 재판정하는 스크립트를 둔다. 재판정에서 차단되면 같은 3단계 처리를 한다.

### 3.5 썸네일 API

`GET /api/photos/[photoId]/thumbnail` (세션 인증, 소유자 확인)
- `photo_thumbnails`에 있으면 돌려준다.
- 없으면 404를 돌려준다. web은 Proton을 호출하지 않으며, cron이 채운다.
- 응답 헤더: `Cache-Control: private, max-age=86400`, `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`
- 사진 목록 API는 UI 단계에서 만든다. 이번에는 썸네일 경로만 있으면 된다.

### 3.6 부속 연동

- **`account-deletion.ts`:** 새 테이블은 모두 cascade로 지운다. Proton 세션 revoke는 최선 노력으로 한다. 실패하면 해제와 같은 고정 안내를 남긴다.
- **`/data-status`:** 새 소스 `proton`을 추가한다.
  - `needs_reauth`이면 재연결 필요로 표시한다. 백필 중이면 연결됨으로 표시한다.
  - 오류 없이 끝난 tick은 이벤트가 0건이어도 성공으로 기록한다(`trackSourceSync`). 그래서 사진을 찍지 않는 기간에도 `stale`이 되지 않는다.
  - 사진이 없는 날은 기존 모델대로 `unknown`이다. 사진은 매일 생기는 데이터가 아니므로 의미가 맞다.
  - 날짜별 개수는 `photos.captured_at`의 KST 날짜(`localDaySql`)로 센다.
  - 복구 대상은 아니다. 대신 "이벤트 동기화가 다시 대조합니다"라는 안내를 둔다.
  - `trackSourceSync` 원격 측정을 붙인다.
  - 세부 정보 시도가 3회 넘게 실패한 사진 수를 보조 정보로 보여준다.
  - 차단 건수는 숫자로만 보여준다(연결 카드도 같다). 어떤 사진이 차단됐는지는 보여주지 않는다.
- **`data-usage`:** `photos`와 `photo_thumbnails`를 추가한다.
- **Sentry:**
  - 위도·경도, `claimed_metadata`, 썸네일 경로의 응답 본문을 `sentry-scrub.ts` denylist에 넣는다.
  - Proton 토큰 헤더(`x-pm-uid`, `Authorization`)는 이미 auth 헤더 규칙으로 걸러지는지 테스트로 확인한다.
- **`/privacy`:** 선택 수집 항목에 "Proton Drive 사진 메타데이터와 썸네일"을 추가한다. 민감 이미지는 서버 안에서 자동으로 걸러 저장하지 않는다는 점도 함께 적는다.
- **문서:** CLAUDE.md의 스키마, cron 표, API 목록, 어댑터 설명을 갱신한다.
- **환경 변수:** 새로 추가하는 것은 없다. `KIS_ENCRYPTION_KEY`를 그대로 쓴다.
  - `PROTON_APP_VERSION`은 코드 상수로 둔다(`external-drive-cistory@1.0.0-stable`).

## 4. 빌더 재량

- 테이블과 컬럼의 세부 이름, 인덱스 추가 여부.
- 계정 모듈을 복사할 때의 파일 구성.
- 연결 카드의 세부 문구.
- 백필 tick당 개수(500)와 위치 보정 창(±15분). 실측해 보고 조정해도 된다.

## 5. 검증

**단위 테스트**
- 포크 payload 복호화.
- 이벤트 처리 상태 기계(created/updated/deleted/fast_forward/tree_refresh/tree_remove/커서 거부).
- 백필 단계 전환(`timeline_listed_at`, 시도 3회 제외, 연관 사진 재대조 예외).
- 갱신 refresher: 이미 갱신된 토큰이면 POST를 건너뛰는지, 같은 토큰이 4xx를 받을 때만 `needs_reauth`로 바꾸는지.
- 커서 저장 순서.
- 위치 보정 선택 규칙.
- `needs_reauth` 전환 조건.
- 메타데이터를 행으로 바꾸는 변환(형식이 이상한 GPS 거부, 태그 원본 보존).
- NSFW 차단: 차단되면 행과 썸네일이 남지 않고 `photo_blocks`만 남는지.
  - 분류에 실패하면 썸네일이 저장되지 않는지(fail-closed).
  - 차단된 `node_uid`가 이벤트, 재대조, 백필에서 다시 들어오지 않는지.
  - 원본 사진이 차단되면 연관 사진도 차단되는지.
  - 테스트는 분류기를 주입한 대역으로 한다.

**통합 테스트 (`*.integration.test.ts`)**
- 위치 보정 SQL의 UTC 전제와 사용자 격리, 그리고 정착 판정 (a)와 (b).
- cascade 삭제.

**운영 확인**
1. 배포 후 연결한다.
2. 백필이 끝나면 사진 수가 약 8.5k인지, 그리고 위치 출처(exif/owntracks/null)의 분포를 확인한다.
   - 차단 건수와, 무작위 통과 샘플의 오탐과 미탐도 소유자가 직접 확인한다. 미탐이 보이면 임계값을 낮추고 재판정 스크립트를 돌린다.
3. 폰으로 새 사진을 찍은 뒤 10분 안에 들어오는지 확인한다.
4. 토큰 갱신이 한 번 이상 일어난 뒤에도 연결이 `active`로 유지되는지 확인한다.

## 6. 미확인 사항 (운영하면서 확인)

- 액세스 토큰과 갱신 토큰의 수명, 그리고 갱신 토큰이 바뀌는지 여부. 갱신 토큰이 응답에 오면 교체하고 빠지면 유지하므로 어느 쪽이든 동작한다.
- 새로 업로드한 사진의 이벤트가 오기까지의 지연.
- 서버 IP에서 장기간 API를 호출할 때 CAPTCHA가 뜨는지. 뜨면 `needs_reauth`로 바꾸고 재연결을 안내한다.
- Live Photo와 연관 사진(`relatedPhotoNodeUids`)을 타임라인에서 어떻게 보일지. 이건 UI 단계에서 정한다. 이번에는 `main_photo_node_uid`만 저장한다.
- **NSFW 모델 정확도:** 한국 사진 데이터와 Galaxy 썸네일 해상도에서 NSFWJS의 오탐과 미탐 비율은 아직 모른다. 백필 뒤에 운영 확인 2단계에서 소유자가 직접 점검한다.
- **2026년 말 암호 모델 변경:** Proton이 바꾸면 복호화와 갱신이 실패한다. 이걸 `needs_reauth`로 잘못 분류하면 재연결로는 해결되지 않는다. SDK 업그레이드가 필요하다는 신호(`x-pm-drive-requirements` 헤더)를 로그로 남겨 구분한다.
