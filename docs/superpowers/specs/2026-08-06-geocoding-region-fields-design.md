# 행정구역 정규화 — 지오코딩 응답의 구조화 필드 사용

날짜: 2026-08-06
대상: `src/lib/adapters/geocoding/*`, `src/modules/location/services/visit-persister.ts`,
`src/modules/location/services/trip-naming.ts`, `place_cache` 스키마

## 문제

`visits.city`와 `visits.countryName`에 행정구역이 아닌 값이 들어간다.

국내 — `city` 상위 값:

```
city              | count
Nonhyeon-dong,    | 135     ← 영문 동 이름 + 쉼표
서울               | 99
06628,            | 85      ← 우편번호
서울특별시          | 47      ← "서울"과 중복
목척7길            | 2       ← 길 이름
```

해외 — `country_name` 분포:

```
country_name              | count
대한민국                   | 2036
Hong Kong                 | 102
Vietnam                   | 13
139號The L. Place F        | 9      ← 건물 주소 조각
Japan                     | 7
赤鱲角國際機場1號客運大樓    | 6      ← 공항 터미널 이름
1號1樓                     | 4      ← 층수
```

### 원인

`visit-persister.ts`의 `extractCityCountry`가 **표시용 주소 문자열을 토큰으로 쪼개** 행정구역을
추정한다.

```ts
if (isInKorea(lat, lon)) {
  const parts = address.split(" ");
  return { city: parts[0] || null, countryName: "대한민국" };
}
const parts = address.split(", ");
if (parts.length >= 2) {
  return { city: parts[parts.length - 2] || null, countryName: parts[parts.length - 1] || null };
}
```

국내는 첫 토큰, 해외는 쉼표 분리 마지막 토큰을 쓴다. 주소가 그 형태가 아니면 우편번호·길
이름·건물명·층수가 그대로 들어간다. 홍콩·중화권 주소가 특히 그 형태가 아니다.

**세 제공자 모두 필요한 값을 이미 구조화된 필드로 응답에 실어 보내는데, `GeocodingResult`가
그것을 버리고 표시용 문자열만 남긴다.** 그리고 우리가 그 문자열에서 다시 파싱해내려 한다.

| 제공자 | 이미 받고 있는 필드 | 현재 코드가 읽는 것 |
|---|---|---|
| Kakao | `coord2address` → `documents[].address.region_1depth_name` (시도) / `region_2depth_name` (구) / `region_3depth_name` (동) | `address_name`만 (`kakao.ts:55-57`) |
| Google | legacy Geocoding → `results[].address_components[]` (타입 `country`, `administrative_area_level_1`, `locality`) | `formatted_address`만 (`google.ts:109-110`) |
| Mapbox | Geocoding v6 → `context` (country / region / place) | `properties`만 |

추가 API 호출은 필요 없다. 이미 받아서 버리고 있는 데이터다.

### 영향 범위

`visits.city` / `countryName`의 소비처:

- `subway-discovery.ts` — `slugifyCityKey(city, countryName)`로 키를 만들어 Overpass에 지하철
  시스템을 질의한다. 쓰레기 도시명이 그대로 키가 된다
- `trip-naming.ts` — `normalizeDomesticRegion(city)`. 시/도 17개를 하드코딩한
  `DOMESTIC_REGION_ALIASES` 별칭 테이블을 거치고, 없으면 `null`을 반환해 여행 이름이
  "서울 여행" 대신 "국내 여행"으로 떨어진다. **이 테이블 자체가 본 결함을 덮으려는 우회다**
- `first-visits.ts` — "처음 방문한 도시 / 나라"를 `city`, `countryName`으로 GROUP BY 한다.
  "1號1樓"이 나라로 집계된다
- `trip-detector.ts` — 방문 도시 목록
- `backfill-orchestrator.ts` — `location_points.city` 보강

## 설계

### 1. `place_cache`에 컬럼 2개 추가 (마이그레이션 0040)

`region` (text, nullable), `country` (text, nullable). 기존 컬럼은 건드리지 않는다.

**이 변경은 선택이 아니라 필수다.** `visit-persister.ts:171-176`은 캐시 히트 시
`{placeName, address, category}`만 복원한다. 캐시에 행정구역이 없으면, 문자열 파싱을 제거하는
순간 캐시 히트한 방문의 `city`가 전부 null이 된다 — 지금보다 나쁘다. 현재 `place_cache` 521행이
방문 2,215건을 커버하므로(집·회사 반복) 캐시 히트가 다수다.

### 2. `GeocodingResult` 확장

```ts
export interface GeocodingResult {
  placeName: string;
  address: string;
  category?: string;
  provider: "kakao" | "mapbox" | "google";
  /** 시/도 또는 administrative_area_level_1. visits.city 컬럼으로 매핑된다. */
  region: string | null;
  /** 국가명. visits.countryName 컬럼으로 매핑된다. */
  country: string | null;
}
```

`visits.city` 컬럼은 실제로 시/도를 담아 이름이 오해를 부르지만, 컬럼명 변경은 마이그레이션과
소비처 수정을 함께 부르므로 하지 않는다. 인터페이스 쪽 이름에 의미를 담고 매핑 관계를 주석으로
고정한다.

### 3. 어댑터 3곳이 구조화 필드를 채운다

- **Kakao** — `address.region_1depth_name` → `region`. Kakao는 국내 전용이므로
  `country`는 `"대한민국"` 고정
- **Google** — `address_components`에서 `types`에 `administrative_area_level_1`을 포함하는
  항목의 `long_name` → `region`, `country`를 포함하는 항목의 `long_name` → `country`
- **Mapbox** — v6 응답의 `context`에서 region / country. **실사용 0건**이므로(캐시 provider
  분포: kakao 411 / google 110 / mapbox 0) 응답 형태를 구현 시점에 문서로 확인해 채운다

세 어댑터 모두 해당 필드가 없으면 `null`을 넣는다. 추측해서 문자열을 파싱하지 않는다.

### 4. `extractCityCountry` 삭제

`visit-persister`가 `result.region` / `result.country`를 그대로 쓴다.

### 5. 캐시 자가 치유

기존 staleness 판정에 조건을 추가한다.

```ts
const isStale =
  (cached.placeName === cached.address && !cached.category) ||
  (cached.region === null && cached.country === null);
```

**두 컬럼이 모두 null일 때만** stale로 본다. `region === null` 하나만 보면 두 상황을 구분하지
못한다 — 컬럼이 생기기 전에 쓰인 행과, 제공자가 그 좌표에 대해 정상 응답했지만 region이 없는
경우다. 후자는 실재한다(`mapbox.ts`의 `props.context?.region?.name ?? null`,
`google.ts`의 `administrative_area_level_1` 컴포넌트 부재). 그 좌표는 매번 stale → 삭제 →
재지오코딩 → 다시 null로 기록을 무한 반복해 캐시가 무력화되고 API 쿼터를 계속 쓴다.

Kakao는 `country`를 `"대한민국"`으로 항상 채우고 Google·Mapbox도 region이 없어도 country는
대개 해결하므로, **둘 다 null = 컬럼 생기기 전 행**이라는 판별이 성립한다. 옛 캐시 521행은 모두
두 컬럼이 null이라 자가 치유 의도는 유지된다.

옛 캐시는 접근될 때 자동으로 재지오코딩되어 채워진다. 별도 백필 스크립트가 필요 없다.

### 6. `DOMESTIC_REGION_ALIASES` 제거

`region_1depth_name`은 이미 "서울", "경기" 형태로 정규화되어 온다. 17개 하드코딩 별칭 테이블과
`normalizeDomesticRegion`은 불필요해진다. `trip-naming.ts`에서 제거하고 `city`를 직접 쓴다.

### 7. `google.ts`의 `result_type` 제한 재검토

```ts
`${GEOCODING_API_BASE}?latlng=${lat},${lon}&key=...&result_type=street_address|premise&language=en`
```

해당 타입 결과가 없으면 `results`가 비어 주소도 행정구역도 얻지 못한다. 홍콩 주소가 깨진 원인일
수 있다. 구현 시 제한을 푼 응답과 비교해 판단한다 — 제한을 풀면 결과 타입이 넓어져 `placeName`이
달라질 수 있으므로, 8절의 비교 스크립트로 영향을 확인한 뒤 결정한다.

### 8. 단계적 적용 — 비교 스크립트 먼저

`scripts/compare-region-extraction.ts` (쓰기 없음):

- `place_cache`에서 N개 좌표를 표본으로 뽑는다 (기본 100, provider 비율 유지)
- 각 좌표를 새 어댑터로 재지오코딩한다
- **현재 저장된 `city` / `countryName`** 과 **새 방식이 만들 `region` / `country`** 를 나란히
  출력한다
- 각 좌표를 네 갈래로 분류해 건수를 집계한다:
  - **개선** — 현재 값이 아래 중 하나에 해당하고 새 값은 해당하지 않는 경우
    - 숫자로만 이루어짐 (우편번호: `06628,`)
    - 국내 좌표인데 17개 시/도 어느 것과도 매칭되지 않음 (`Nonhyeon-dong,`, `목척7길`).
      판정용 시/도 목록은 스크립트가 자체적으로 갖는다 — `trip-naming.ts`의
      `DOMESTIC_REGION_ALIASES`는 6절에서 삭제되므로 참조하지 않는다
    - 해외 좌표인데 `country`가 ISO 국가명 목록에 없음 (`1號1樓`, `139號The L. Place F`)
  - **동일** — 정규화 후 두 값이 같음 (`서울특별시` → `서울`은 동일로 센다)
  - **악화** — 현재 값은 위 판정을 통과하는데 새 값이 `null`이거나 판정에 걸림
  - **판정 불가** — 양쪽 다 `null`

전체 백필은 **개선 ≫ 악화이고 악화가 0에 가까울 때만** 진행한다. 악화가 나오면 그 좌표들을
먼저 조사한다.

이 결과를 보고 전체 백필 여부를 판단한다. 백필을 방문 재처리로 하지 않고 비교 스크립트로 먼저
하는 이유는, 방문을 다시 쓰면 별도로 확인된 방문 검출기 결함(움직이는 중심점이 느린 도보를 체류로
오인)의 영향이 섞여 무엇이 결과를 바꿨는지 분리할 수 없기 때문이다.

### 9. 전체 백필 (비교 결과가 좋을 때만)

`scripts/backfill-visit-regions.ts` (`scripts/lib/backfill-args.ts`의 인자 파싱을 재사용,
`--dry-run` 지원):

1. `place_cache`에서 `region IS NULL`인 행을 재지오코딩해 `region` / `country`를 채운다
   (521행, 동시성 5 — `visit-persister`와 같은 상한)
2. `visits`를 `place_cache`에 조인해 `city` / `countryName`을 갱신한다. 조인 키는
   `visit-persister`가 캐시를 조회할 때와 같은 `roundCoord(centerLat)` / `roundCoord(centerLon)`이다
3. 캐시에 대응 행이 없는 방문은 건드리지 않는다 (`savedPlaces`로 이름이 붙은 방문은 애초에
   캐시를 타지 않는다)

**방문 검출은 다시 돌리지 않는다.** 행정구역 컬럼만 UPDATE하므로 방문 경계·장소명은 그대로이고,
따라서 방문 검출기 결함과 무관하다.

## 테스트

- 어댑터 3곳: 실제 응답 형태를 고정한 픽스처로 `region` / `country` 추출을 검증. 필드가 없는
  응답에서 `null`이 나오는지 포함
- `visit-persister`: 캐시 히트 경로가 `region`을 복원하는지, `region IS NULL`인 옛 캐시가 stale로
  판정되는지
- `trip-naming`: 별칭 테이블 제거 후에도 여행 이름이 시/도로 만들어지는지

## 범위 밖

- `visits.city` 컬럼명 변경 (마이그레이션 + 소비처 수정을 부른다)
- 구/동 단위(`region_2depth_name` / `region_3depth_name`) 저장 — 현재 소비처가 없다. 필요해지면
  그때 추가한다
- 방문 검출기의 움직이는 중심점 결함 (별도 작업)
- Google Places 캐시 약관 검토 — `place_cache`의 google 110행이 Google 약관의 캐시 제한에
  걸리는지는 별도로 확인해야 한다
