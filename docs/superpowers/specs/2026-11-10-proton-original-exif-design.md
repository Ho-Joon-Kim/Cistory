# Proton 원본 EXIF 보강과 썸네일 복구

선행 설계: `2026-11-10-proton-drive-photos-design.md`. 그 문서의 비목표였던 "원본 이미지 다운로드와 저장" 중 **다운로드만** 이번에 범위로 들어온다. 저장은 여전히 비목표다. 원본 바이트는 메모리에서만 다루고, 로그·DB·Sentry 어디에도 남기지 않는다.

## 1. 왜 필요한가 (2026-11-10 원본 17장 실측)

- Proton 확장 속성의 `Location`이 원본 EXIF에 GPS가 있어도 빠져 있는 경우가 많다. Galaxy S22(`SM-S908N`, HEIC)는 표본 4/4장이 EXIF GPS를 갖고 있었는데 Cistory에는 없다. 약 2,670장. S25 Ultra(HEIC)는 대체로 속성에도 있다. LG V50(JPEG) 1/3, Sony a5100은 GPS 없음, iPhone 14 Pro(JPEG) 3/3.
- `GPSImgDirection`(카메라 방향, Ref `T`=진북)은 iPhone 원본에만 있다. Samsung은 `OffsetTimeOriginal`("+09:00")을 쓴다.
- 원본 크기 0.5–9 MB.
- 2020-05..06의 약 350장은 Proton 썸네일이 아예 없어 `details_error` "썸네일을 받지 못했습니다"로 영구히 숨겨져 있었다.

## 2. 결정

- **위치 우선순위:** 원본 EXIF GPS(`exif_original`) > Proton 속성 GPS(`exif`) > OwnTracks 추정(`owntracks`). OwnTracks 보정은 `location_source`가 NULL이나 `owntracks`인 행만 다시 계산한다.
- **한 번만 읽는다:** `original_checked_at`이 표식이다. 인제스트(이벤트 `node_created`/`node_updated` 포함)의 통과 쓰기가 표식과 원본 필드를 지우므로, 새 리비전의 원본은 다음 tick에 다시 읽힌다. 실패는 `original_attempts`(3회), 형식·크기처럼 다시 해도 같은 실패는 바로 상한으로 간다.
- **적게 읽는다:** EXIF는 SDK의 seekable stream 위에서 exifr 청크 리더로 필요한 범위만 읽는다. Proton 블록은 4 MiB라 실제 전송은 블록 단위(사진당 1–2블록)다. claimed block size가 없는 옛 노드는 32 MiB 상한의 전체 다운로드로 대신한다.
- **썸네일 복구:** 썸네일 오류로 숨겨진 행은 `details_attempts`와 상관없이 대상이다(운영 SQL로 시도 횟수를 되돌릴 필요가 없다). 원본 전체를 서명 검증 다운로드로 받아 ≤512px JPEG(메타데이터 없음)를 만들고, 기존과 **같은** NSFW 판정을 거친다. 차단이면 행 삭제 + `photo_blocks`, 통과면 그 JPEG를 저장한다. 원본도 디코딩할 수 없으면 숨긴 채 고정 오류를 남긴다(fail-closed).
- **HEIC 디코더:** sharp의 prebuilt libvips에는 HEVC 디코더가 없어서 `heic-decode`(ISC) + `libheif-js`(LGPL-3.0, libheif/libde265를 wasm으로 빌드, 의존성으로만 참조하고 복사하지 않음)를 쓴다. 네이티브 바이너리가 없어 Alpine/musl에서 그대로 돈다. wasm 힙은 줄어들지 않으므로 16.8 MP를 넘는 HEIC는 거절한다.
- **틱 예산:** 이벤트와 세부 정보 단계 뒤에 돈다. 복구 10장, EXIF 60장, 다운로드당 60초 제한, 틱 시작 5분 뒤에는 새 원본을 시작하지 않는다. 근거는 `originals.ts`의 상수 주석.
- **표면:** 설정 카드와 `/data-status`는 "원본 메타데이터 확인 N/M" 개수만 보인다. 방향과 시간대는 새 수집 항목이라 `/privacy`에 적는다.

## 3. 알려진 한계

- 다운로드 시간은 실측하지 못했다(프로브 로그에 시간이 없다). 한도는 크기와 블록 구조로 정했고, 처리량이 예상보다 낮아도 마감 시각이 틱을 지킨다.
- exifr는 HEIF `iloc`의 base offset을 무시한다. 기기 HEIC는 extent offset을 써서 문제가 없지만, base offset을 쓰는 앱이 만든 HEIC는 EXIF를 못 읽고 "확인했지만 없음"으로 끝난다.
- seekable stream은 무결성 검증을 하지 않는다. EXIF 메타데이터에만 쓰고, 썸네일로 저장될 바이트는 검증 다운로드에서만 만든다.
