# 지오코딩 구조화 필드로 행정구역 정규화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지오코딩 제공자가 이미 응답에 실어 보내는 구조화된 행정구역 필드를 그대로 사용해, 표시용 주소 문자열을 토큰 분리해 도시·국가를 추정하던 로직을 없앤다.

**Architecture:** `GeocodingResult`에 `region`/`country`를 추가하고 세 어댑터가 각자의 응답에서 채운다. `place_cache`에 같은 두 컬럼을 추가해 캐시 히트 시에도 복원되게 한다. `visit-persister`의 `extractCityCountry`를 삭제하고 이 값을 그대로 `visits.city`/`countryName`에 쓴다. 추가 API 호출은 없다.

**Tech Stack:** TypeScript 5 (strict), Drizzle ORM + PostgreSQL, Vitest (콜로케이트 `*.test.ts`), Biome.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-06-geocoding-region-fields-design.md`
- **추가 API 호출을 만들지 않는다.** 세 어댑터 모두 이미 받고 있는 응답에서 필드를 읽을 뿐이다.
- 마이그레이션 번호는 **0040**이다 (`drizzle/0039_location_processing_point_count.sql`이 이미 존재). 스펙 본문의 "0039"는 오기다.
- 마이그레이션은 `yarn db:generate`로 생성한다. SQL을 손으로 쓰지 않는다. 생성된 SQL을 커밋 전에 반드시 읽는다.
- 어댑터는 필드가 없으면 `null`을 넣는다. **문자열을 파싱해 추측하지 않는다** — 그것이 이번에 제거하는 결함이다.
- 테스트 파일 첫 줄은 `process.env.TZ = "Asia/Seoul";` — 저장소 규약.
- Biome을 저장소 전체로 돌리지 않는다(무관한 파일 ~20개에 import 정렬 드리프트가 있어 전체 실행 시 전부 재작성된다). 자기 파일만: `npx biome check --write <files>`. 이후 `git status --short`에 자기 파일만 있는지 확인하고, 다른 파일은 `git restore`.
- 커밋 제목은 Conventional Commit.
- DB 쓰기가 필요한 스크립트 실행은 사람이 한다. 구현자는 `--dry-run`만 실행한다.

---

### Task 1: 스키마 · 마이그레이션 · 인터페이스

**Files:**
- Modify: `src/db/schema.ts` (`placeCache` 정의, 170행 부근)
- Modify: `src/lib/adapters/geocoding/interface.ts`
- Create: `drizzle/0040_*.sql` (`yarn db:generate`가 생성)

**Interfaces:**
- Produces:
  - `placeCache`에 `region: text("region")`, `country: text("country")` (둘 다 nullable)
  - `GeocodingResult`에 `region: string | null`, `country: string | null` (**필수 필드** — 옵셔널로 두면 어댑터가 빠뜨려도 컴파일러가 못 잡는다)

- [ ] **Step 1: 스키마에 컬럼 추가**

`src/db/schema.ts`의 `placeCache`에서 `provider`와 `resolvedAt` 사이에 두 줄을 넣는다:

```ts
    provider: text("provider").notNull(), // 'kakao' | 'mapbox' | 'google'
    /** 시/도 또는 administrative_area_level_1. visits.city로 복사된다. */
    region: text("region"),
    /** 국가명. visits.country_name으로 복사된다. */
    country: text("country"),
    resolvedAt: timestamp("resolved_at").notNull(),
```

- [ ] **Step 2: 마이그레이션 생성 및 확인**

Run: `yarn db:generate`
Expected: `drizzle/0040_*.sql` 생성. 파일을 열어 `ALTER TABLE "place_cache" ADD COLUMN "region" text;` / `... "country" text;` **두 줄만** 있는지 확인한다. 다른 테이블 변경이나 DROP이 섞여 있으면 멈추고 보고한다 — 그건 스키마 드리프트를 의미한다.

- [ ] **Step 3: 인터페이스 확장**

`src/lib/adapters/geocoding/interface.ts`의 `GeocodingResult`에 추가:

```ts
export interface GeocodingResult {
  /** 장소명 (e.g. "스타벅스 강남R점" or "123 Main St") */
  placeName: string;
  /** 주소 (e.g. "서울 강남구 역삼동" or "San Francisco, CA") */
  address: string;
  /** 카테고리 (e.g. "카페", "음식점") */
  category?: string;
  /** 제공자 */
  provider: "kakao" | "mapbox" | "google";
  /**
   * 시/도 또는 administrative_area_level_1. `visits.city` 컬럼으로 매핑된다.
   * 컬럼명이 "city"지만 실제로 담기는 값은 시/도 단위다.
   * 응답에 없으면 null — 주소 문자열에서 추측하지 않는다.
   */
  region: string | null;
  /** 국가명. `visits.countryName`으로 매핑된다. 응답에 없으면 null. */
  country: string | null;
}
```

- [ ] **Step 4: 타입 오류로 미구현 어댑터가 드러나는지 확인**

Run: `npx tsc --noEmit`
Expected: FAIL — `kakao.ts`, `google.ts`, `mapbox.ts` 세 곳에서 `region`/`country` 누락 오류. **이 오류 목록이 Task 2·3의 작업 목록이다.** 세 곳 모두에서 오류가 나지 않으면 인터페이스 수정이 반영되지 않은 것이니 멈추고 확인한다.

- [ ] **Step 5: 세 어댑터에 스텁을 넣어 트리를 다시 컴파일 가능하게 만든다**

각 어댑터의 **모든** `return` 문(`kakao.ts`는 2개, `google.ts`는 2개, `mapbox.ts`는 1개)에 아래 두 줄을 그대로 추가한다. 값을 채우는 것은 Task 2·3의 일이다:

```ts
      // TODO(task-2/3): fill from the provider response.
      region: null,
      country: null,
```

**응답에서 값을 읽으려 시도하지 않는다.** 이 스텁의 목적은 오직 트리가 컴파일되게 하는 것이고, 실제 추출은 Task 2·3에서 테스트가 이끌어낸다. 여기서 미리 구현하면 그 테스트들이 처음부터 통과해 버려 TDD가 무력화된다.

- [ ] **Step 6: 컴파일과 기존 테스트 확인**

Run: `npx tsc --noEmit && yarn test`
Expected: 둘 다 통과. 커밋되는 트리는 항상 컴파일 가능해야 한다.

- [ ] **Step 7: 커밋**

```bash
npx biome check --write src/db/schema.ts src/lib/adapters/geocoding/interface.ts src/lib/adapters/geocoding/kakao.ts src/lib/adapters/geocoding/google.ts src/lib/adapters/geocoding/mapbox.ts
git add src/db/schema.ts src/lib/adapters/geocoding/ drizzle/
git commit -m "feat(geocoding): add region/country to GeocodingResult and place_cache"
```

---

### Task 2: Kakao · Mapbox 어댑터

**Files:**
- Modify: `src/lib/adapters/geocoding/kakao.ts`
- Modify: `src/lib/adapters/geocoding/mapbox.ts`
- Test: `src/lib/adapters/geocoding/kakao.test.ts` (신규), `src/lib/adapters/geocoding/mapbox.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `GeocodingResult.region` / `.country`
- Produces: 두 어댑터가 `region`/`country`를 채운 `GeocodingResult`를 반환

두 어댑터를 한 태스크로 묶은 이유: 둘 다 **이미 파싱된 응답 객체에서 필드를 하나 더 읽는** 동일한 형태의 변경이다. `mapbox.ts:57`은 이미 `context.region.name`과 `context.country.name`을 읽어 주소 문자열로 join하고 있어, 사실상 join하지 말고 그대로 실어보내면 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/adapters/geocoding/kakao.test.ts`:

```ts
// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KAKAO_REST_API_KEY = "test-key";

import { KakaoGeocodingAdapter } from "./kakao";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload } as unknown as Response;
}

/** coord2address 응답 1건 + 카테고리 검색 6건(모두 빈 결과)을 순서대로 준다. */
function mockKakao(addressPayload: unknown) {
  fetchMock.mockResolvedValueOnce(jsonResponse(addressPayload));
  for (let i = 0; i < 6; i++) fetchMock.mockResolvedValueOnce(jsonResponse({ documents: [] }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KakaoGeocodingAdapter region/country", () => {
  it("reads region_1depth_name from the address object", async () => {
    mockKakao({
      documents: [
        {
          address: {
            address_name: "서울 강남구 역삼동 123",
            region_1depth_name: "서울",
            region_2depth_name: "강남구",
            region_3depth_name: "역삼동",
          },
          road_address: { address_name: "서울 강남구 테헤란로 1", building_name: "테스트빌딩" },
        },
      ],
    });

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.5, 127.0);

    expect(result?.region).toBe("서울");
    expect(result?.country).toBe("대한민국");
  });

  it("falls back to road_address's region when address has none", async () => {
    mockKakao({
      documents: [
        {
          road_address: { address_name: "경기 성남시 분당구 판교로 1", region_1depth_name: "경기" },
        },
      ],
    });

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.4, 127.1);

    expect(result?.region).toBe("경기");
  });

  it("returns null region when the response carries none — never guesses from the address string", async () => {
    mockKakao({ documents: [{ address: { address_name: "서울 강남구 역삼동 123" } }] });

    const result = await new KakaoGeocodingAdapter().reverseGeocode(37.5, 127.0);

    expect(result?.region).toBeNull();
    expect(result?.country).toBe("대한민국");
  });
});
```

`src/lib/adapters/geocoding/mapbox.test.ts`:

```ts
// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.MAPBOX_ACCESS_TOKEN = "test-token";

import { MapboxGeocodingAdapter } from "./mapbox";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapboxGeocodingAdapter region/country", () => {
  it("lifts region and country out of context instead of only joining them into the address", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        features: [
          {
            properties: {
              name: "Central",
              full_address: "Central, Hong Kong Island, Hong Kong",
              feature_type: "poi",
              context: {
                place: { name: "Hong Kong Island" },
                region: { name: "Hong Kong Island" },
                country: { name: "Hong Kong" },
              },
            },
          },
        ],
      })
    );

    const result = await new MapboxGeocodingAdapter().reverseGeocode(22.28, 114.15);

    expect(result?.region).toBe("Hong Kong Island");
    expect(result?.country).toBe("Hong Kong");
  });

  it("returns null region/country when context is absent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ features: [{ properties: { name: "Somewhere", full_address: "Somewhere" } }] })
    );

    const result = await new MapboxGeocodingAdapter().reverseGeocode(0, 0);

    expect(result?.region).toBeNull();
    expect(result?.country).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `yarn test src/lib/adapters/geocoding/`
Expected: FAIL — `region`/`country`가 `undefined`. (Task 1 이후 타입 오류도 남아 있다.)

- [ ] **Step 3: Kakao 구현**

`kakao.ts`의 `KakaoAddressDoc`을 확장한다:

```ts
interface KakaoRegion {
  address_name: string;
  region_1depth_name?: string;
  region_2depth_name?: string;
  region_3depth_name?: string;
}

interface KakaoAddressDoc {
  address?: KakaoRegion;
  road_address?: KakaoRegion & { building_name?: string };
}
```

`reverseGeocode` 안에서 `address` 상수를 만든 직후에 추가한다:

```ts
    // Kakao already returns the administrative region in this same response —
    // read it instead of splitting the display address on whitespace.
    const region =
      addressDoc?.address?.region_1depth_name ??
      addressDoc?.road_address?.region_1depth_name ??
      null;
```

그리고 이 함수의 **두 return 문 모두**에 `region,` 과 `country: "대한민국",` 을 넣는다 (Kakao 어댑터는 국내 좌표에만 선택되므로 국가는 고정이다). 두 번째 return은 POI가 없을 때의 경로다.

- [ ] **Step 4: Mapbox 구현**

`mapbox.ts`의 return 문에 두 줄을 추가한다. `props.context`는 이미 54-59행에서 읽고 있다:

```ts
    return {
      placeName,
      address,
      category: props.feature_type === "poi" ? "POI" : undefined,
      provider: "mapbox",
      region: props.context?.region?.name ?? null,
      country: props.context?.country?.name ?? null,
    };
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `yarn test src/lib/adapters/geocoding/`
Expected: PASS (5 tests)

- [ ] **Step 6: 커밋**

```bash
npx biome check --write src/lib/adapters/geocoding/kakao.ts src/lib/adapters/geocoding/mapbox.ts src/lib/adapters/geocoding/kakao.test.ts src/lib/adapters/geocoding/mapbox.test.ts
git add src/lib/adapters/geocoding/
git commit -m "feat(geocoding): read region/country from Kakao and Mapbox responses"
```

---

### Task 3: Google 어댑터

**Files:**
- Modify: `src/lib/adapters/geocoding/google.ts`
- Test: `src/lib/adapters/geocoding/google.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `GeocodingResult.region` / `.country`
- Produces: `region`/`country`를 채운 `GeocodingResult`

Google만 별도 태스크인 이유: 다른 둘과 달리 **응답에서 새로 파싱해야 한다.** `getAddress()`가 legacy Geocoding API 응답에서 `formatted_address`만 꺼내고 `address_components`를 버리고 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/adapters/geocoding/google.test.ts`:

```ts
// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.GOOGLE_MAPS_API_KEY = "test-key";

import { GooglePlacesAdapter } from "./google";

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => payload } as unknown as Response;
}

/**
 * reverseGeocode fires searchNearbyPoi (POST places:searchNearby) and
 * getAddress (GET maps/api/geocode/json) via Promise.all, so resolve by URL
 * rather than by call order — Promise.all does not guarantee which runs first.
 */
function mockGoogle(poiPayload: unknown, geocodePayload: unknown) {
  fetchMock.mockImplementation(async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    return url.includes("maps/api/geocode")
      ? jsonResponse(geocodePayload)
      : jsonResponse(poiPayload);
  });
}

const HONG_KONG_GEOCODE = {
  results: [
    {
      formatted_address: "1號1樓, 139號The L. Place F, Queen's Road Central, Hong Kong",
      address_components: [
        { long_name: "Queen's Road Central", short_name: "Queen's Rd C", types: ["route"] },
        { long_name: "Central", short_name: "Central", types: ["neighborhood", "political"] },
        {
          long_name: "Hong Kong Island",
          short_name: "Hong Kong Island",
          types: ["administrative_area_level_1", "political"],
        },
        { long_name: "Hong Kong", short_name: "HK", types: ["country", "political"] },
      ],
    },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GooglePlacesAdapter region/country", () => {
  it("reads country from address_components instead of the last comma-separated token", async () => {
    // The old string parser took the last ", "-separated token of
    // formatted_address, which is why "1號1樓" and "139號The L. Place F" ended
    // up stored as country names.
    mockGoogle({ places: [] }, HONG_KONG_GEOCODE);

    const result = await new GooglePlacesAdapter().reverseGeocode(22.28, 114.15);

    expect(result?.country).toBe("Hong Kong");
    expect(result?.region).toBe("Hong Kong Island");
  });

  it("carries region/country through the POI branch too", async () => {
    mockGoogle(
      {
        places: [
          {
            displayName: { text: "Some Cafe" },
            formattedAddress: "Some Cafe, Central, Hong Kong",
            primaryTypeDisplayName: { text: "Cafe" },
          },
        ],
      },
      HONG_KONG_GEOCODE
    );

    const result = await new GooglePlacesAdapter().reverseGeocode(22.28, 114.15);

    expect(result?.placeName).toBe("Some Cafe");
    expect(result?.country).toBe("Hong Kong");
    expect(result?.region).toBe("Hong Kong Island");
  });

  it("returns null region/country when the geocode response is empty", async () => {
    mockGoogle(
      {
        places: [
          { displayName: { text: "Lone POI" }, formattedAddress: "Lone POI" },
        ],
      },
      { results: [] }
    );

    const result = await new GooglePlacesAdapter().reverseGeocode(1, 1);

    expect(result?.region).toBeNull();
    expect(result?.country).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `yarn test src/lib/adapters/geocoding/google.test.ts`
Expected: FAIL — `region`/`country`가 `undefined`

- [ ] **Step 3: 구현**

`google.ts`에 컴포넌트 타입과 추출 헬퍼를 추가한다:

```ts
interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodingResult {
  formatted_address: string;
  address_components?: GoogleAddressComponent[];
}

/** Google returns the admin hierarchy as typed components — pick by type, never by position. */
function pickComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string
): string | null {
  if (!components) return null;
  return components.find((c) => c.types.includes(type))?.long_name ?? null;
}
```

`getAddress`의 반환 타입을 넓힌다:

```ts
  private async getAddress(
    lat: number,
    lon: number
  ): Promise<{ address: string | null; region: string | null; country: string | null }> {
    const empty = { address: null, region: null, country: null };
    try {
      const url = `${GEOCODING_API_BASE}?latlng=${lat},${lon}&key=${this.apiKey}&result_type=street_address|premise&language=en`;
      const res = await fetch(url);

      if (!res.ok) return empty;

      const data = await res.json();
      const result: GoogleGeocodingResult | undefined = data.results?.[0];
      if (!result) return empty;

      return {
        address: result.formatted_address ?? null,
        region: pickComponent(result.address_components, "administrative_area_level_1"),
        country: pickComponent(result.address_components, "country"),
      };
    } catch {
      return empty;
    }
  }
```

`reverseGeocode`를 새 반환 형태에 맞춘다. `address`를 쓰던 자리는 `geo.address`가 된다:

```ts
  async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
    const [poi, geo] = await Promise.all([
      this.searchNearbyPoi(lat, lon),
      this.getAddress(lat, lon),
    ]);

    if (poi) {
      return {
        placeName: poi.displayName?.text || geo.address || "",
        address: poi.formattedAddress || geo.address || "",
        category: poi.primaryTypeDisplayName?.text || undefined,
        provider: "google",
        region: geo.region,
        country: geo.country,
      };
    }

    if (geo.address) {
      return {
        placeName: geo.address,
        address: geo.address,
        provider: "google",
        region: geo.region,
        country: geo.country,
      };
    }

    return null;
  }
```

`result_type=street_address|premise` 제한은 **이번 태스크에서 바꾸지 않는다.** 스펙 7절대로 Task 5의 비교 스크립트가 이 제한의 영향을 측정한 뒤 판단한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `yarn test src/lib/adapters/geocoding/`
Expected: PASS (8 tests — Task 2의 5개 + 이번 3개)

- [ ] **Step 5: 스텁이 모두 제거되었는지 확인**

Run: `npx tsc --noEmit && grep -rn "TODO(task-2/3)" src/lib/adapters/geocoding/`
Expected: `tsc`는 통과하고 `grep`은 **아무것도 찾지 못해야 한다**(종료 코드 1). Task 1이 넣은 `region: null, country: null` 스텁이 세 어댑터에서 모두 실제 추출로 대체되었다는 뜻이다. grep이 무언가 출력하면 그 어댑터가 아직 스텁 상태다.

- [ ] **Step 6: 커밋**

```bash
npx biome check --write src/lib/adapters/geocoding/google.ts src/lib/adapters/geocoding/google.test.ts
git add src/lib/adapters/geocoding/
git commit -m "feat(geocoding): read region/country from Google address_components"
```

---

### Task 4: `visit-persister` 연결

**Files:**
- Modify: `src/modules/location/services/visit-persister.ts`
- Test: `src/modules/location/services/visit-persister.test.ts` — 없으면 생성. `persister-idempotency.test.ts`가 같은 디렉터리에 있으니 그 파일의 DB 처리 방식을 먼저 읽고 맞춘다.

**Interfaces:**
- Consumes: Task 1의 `placeCache.region` / `.country`, Task 2·3의 `GeocodingResult.region` / `.country`
- Produces: `visits.city` = `region`, `visits.countryName` = `country`

- [ ] **Step 1: 구조 파악**

`visit-persister.ts`를 처음부터 끝까지 읽는다. 이번에 바꿀 지점은 네 곳이다:

1. `extractCityCountry` 함수 (36-60행 부근) — **삭제**
2. `visitEnrichments` 맵의 값 타입 — `region`/`country` 추가
3. 캐시 히트 경로 (171-176행 부근)와 지오코딩 경로 (206-221행 부근) — 두 곳 모두 새 필드를 채운다
4. `staleKeys` 판정 (170행 부근)과 최종 `visitRows` 구성 (244행 부근)

- [ ] **Step 2: 실패하는 테스트 작성**

`extractCityCountry`가 사라지므로 순수 함수 단위 테스트를 걸 대상이 없다. 대신 **캐시 히트 시 region이 복원되는지**와 **region이 비어 있는 옛 캐시가 stale로 판정되는지**를 검증한다. `persister-idempotency.test.ts`가 쓰는 DB 접근 방식을 그대로 따라 다음을 확인하는 테스트를 작성한다:

- `place_cache`에 `region: "서울"`, `country: "대한민국"`인 행이 있고 그 좌표에 방문이 생기면, 저장된 `visits.city`가 `"서울"`이고 `countryName`이 `"대한민국"`이다 (지오코딩 API를 타지 않는다)
- `place_cache`에 `region: null`인 행이 있으면 stale로 판정되어 재지오코딩 경로로 간다

기존 테스트가 어댑터를 어떻게 대체하는지(모킹인지 주입인지) 먼저 확인하고 같은 방식을 쓴다. 기존 파일에 그런 장치가 전혀 없다면, 이 태스크의 테스트는 stale 판정 함수를 순수 함수로 추출해 그것만 검증하는 선으로 좁힌다 — DB·네트워크 통합 테스트를 새로 만들지 않는다.

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `yarn test src/modules/location/services/`
Expected: FAIL

- [ ] **Step 4: 구현**

`extractCityCountry` 함수 전체를 삭제한다. `visitEnrichments`의 값 타입에 두 필드를 추가한다:

```ts
  const visitEnrichments = new Map<
    number,
    {
      placeName: string | null;
      address: string | null;
      category: string | null;
      region: string | null;
      country: string | null;
    }
  >();
```

(선언부의 실제 형태를 먼저 확인하고 그에 맞춘다.)

stale 판정에 조건을 추가한다:

```ts
    // A cache row written before region/country existed carries no admin region;
    // treat it as stale so it refills on next touch instead of yielding a null city.
    const isStale =
      (cached && cached.placeName === cached.address && !cached.category) ||
      (cached && cached.region === null);
```

캐시 히트 경로:

```ts
      visitEnrichments.set(v.idx, {
        placeName: cached.placeName,
        address: cached.address,
        category: cached.category,
        region: cached.region,
        country: cached.country,
      });
```

지오코딩 경로 — `visitEnrichments.set`과 `geocodeRows.push` **양쪽 모두**에 넣는다:

```ts
            visitEnrichments.set(idx, {
              placeName: result.placeName,
              address: result.address,
              category: result.category ?? null,
              region: result.region,
              country: result.country,
            });
            geocodeRows.push({
              latKey,
              lonKey,
              placeName: result.placeName,
              address: result.address,
              category: result.category ?? null,
              provider: result.provider,
              region: result.region,
              country: result.country,
              resolvedAt: now,
            });
```

마지막으로 `extractCityCountry` 호출부를 제거하고 enrichment 값을 그대로 쓴다:

```ts
    const city = e.region;
    const countryName = e.country;
```

`e`가 기본값으로 대체되는 경로(enrichment가 없는 방문)에도 `region: null`, `country: null`이 들어가야 한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `yarn test src/modules/location/services/`
Expected: PASS

- [ ] **Step 6: 전체 테스트와 타입 확인**

Run: `yarn test && npx tsc --noEmit`
Expected: 둘 다 통과. `isInKorea` import가 쓰이지 않게 되었다면 제거한다 (Biome이 unused import를 error로 잡는다).

- [ ] **Step 7: 커밋**

```bash
npx biome check --write src/modules/location/services/visit-persister.ts
git add src/modules/location/services/
git commit -m "fix(location): use structured region/country instead of parsing address strings"
```

---

### Task 5: 비교 스크립트

**Files:**
- Create: `scripts/compare-region-extraction.ts`

**Interfaces:**
- Consumes: Task 2·3의 어댑터, `place_cache`, `visits`
- Produces: 실행 가능한 스크립트만. 애플리케이션 코드가 import하지 않는다. **쓰기 없음.**

- [ ] **Step 1: 스크립트 작성**

`scripts/calibrate-track-splitting.ts`와 `scripts/backfill-tracks.ts`의 관례를 따른다: 상대 경로 import(`@/` 별칭 금지), `loadEnv({ path: ".env.local" })`, 성공·실패 양쪽 경로에서 `getPool().end()`, 그리고 `scripts/lib/backfill-args.ts`의 인자 파싱 재사용.

스크립트 동작:

1. `place_cache`에서 N개(기본 100) 표본을 뽑는다. provider 비율을 유지하도록 provider별로 비례 배분한다
2. 각 좌표를 `getGeocodingAdapter(lat, lon)`으로 재지오코딩한다. 동시성 5
3. 각 좌표에 대해 **현재 `visits`에 저장된 `city`/`country_name`** (해당 좌표를 `roundCoord`로 조인)과 **새로 얻은 `region`/`country`** 를 한 줄씩 출력한다
4. 아래 규칙으로 분류해 집계한다:

```ts
/** 판정용 시/도 목록. trip-naming.ts의 DOMESTIC_REGION_ALIASES는 Task 7에서 삭제되므로 참조하지 않는다. */
const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

/** 값이 행정구역으로 보이지 않으면 true. */
function looksBroken(value: string | null, inKorea: boolean): boolean {
  if (!value) return true;
  const v = value.trim().replace(/,$/, "");
  if (/^\d+$/.test(v)) return true; // 우편번호
  if (inKorea) return !SIDO.some((s) => v.startsWith(s));
  return false; // 해외 region은 자동 판정하지 않는다 — country 쪽으로 판정한다
}
```

- **개선** — 현재 값이 `looksBroken`이고 새 값은 아님
- **동일** — 정규화 후(양끝 공백·후행 쉼표 제거, `특별시`/`광역시`/`특별자치시`/`도` 접미사 제거) 같음
- **악화** — 현재 값은 정상인데 새 값이 `null`이거나 `looksBroken`
- **판정 불가** — 양쪽 다 `null`

해외 좌표는 `country`를 ISO 국가명 목록과 대조해 같은 4분류를 적용한다. 목록은 스크립트가 자체적으로 갖되, 전 세계를 다 넣을 필요는 없다 — `place_cache`에 실제로 등장하는 국가(대한민국, Hong Kong, Vietnam, Japan)에 더해 흔한 국가 20여 개면 충분하다.

5. Google 좌표에 한해, `result_type=street_address|premise` 제한을 **뺀** 요청도 함께 보내 `results`가 비었던 비율과 그때 얻어지는 `country`를 별도 집계한다. 이것이 스펙 7절의 판단 근거다

- [ ] **Step 2: 실행 확인**

이 스크립트는 DB를 읽고 지오코딩 API를 호출하지만 **아무것도 쓰지 않는다.** 실행은 사람이 한다. 구현자는 인자 파싱만 확인한다:

Run: `npx tsx scripts/compare-region-extraction.ts`
Expected: 인자 없이 usage 출력 후 종료 코드 1. DB 풀을 만들지 않는다.

- [ ] **Step 3: 커밋**

```bash
npx biome check --write scripts/compare-region-extraction.ts
git add scripts/compare-region-extraction.ts
git commit -m "test(geocoding): add region extraction comparison script"
```

---

### Task 6: 백필 스크립트

**Files:**
- Create: `scripts/backfill-visit-regions.ts`

**Interfaces:**
- Consumes: Task 2·3의 어댑터, `scripts/lib/backfill-args.ts`의 `parseArgs`/`resolveDateRange`
- Produces: 실행 가능한 스크립트. `--dry-run` 지원.

**이 스크립트의 실제 실행은 Task 5의 비교 결과가 좋을 때만 한다** (개선 ≫ 악화, 악화가 0에 가까움). 구현자는 `--dry-run`만 실행한다.

- [ ] **Step 1: 스크립트 작성**

`scripts/backfill-tracks.ts`를 먼저 읽고 구조를 그대로 따른다. `scripts/lib/backfill-args.ts`의 인자 파싱을 재사용하되, 이 스크립트는 날짜 범위가 아니라 userId만 받는다 — `parseArgs`가 날짜 3개 위치 인자를 요구한다면 그 시그니처에 맞추거나, 이 스크립트용으로 위치 인자 1개를 받는 변형을 같은 모듈에 추가한다. **오타난 `--dry-run`이 조용히 실전 실행이 되지 않도록** 하는 성질은 반드시 유지한다.

동작:

1. `place_cache`에서 `region IS NULL`인 행을 조회한다
2. 각 행의 `(lat_key, lon_key)`를 재지오코딩해 `region`/`country`를 UPDATE한다. 동시성 5 (`visit-persister`와 동일)
3. `visits`를 `place_cache`에 조인해 `city`/`country_name`을 갱신한다. 조인 키는 `visit-persister`가 캐시를 조회할 때와 같은 `roundCoord(center_lat)` / `roundCoord(center_lon)`이다 — `roundCoord`는 `@/lib/geo`에 있고 스크립트에서는 `../src/lib/geo`로 import한다
4. 캐시에 대응 행이 없는 방문은 건드리지 않는다
5. `--dry-run`은 1·2·3의 대상 건수와 바뀔 값 표본 20건을 출력하고 아무것도 쓰지 않는다
6. 하루가 아니라 행 단위이므로, 개별 행 실패는 로그만 남기고 계속 진행한 뒤 마지막에 실패 건수를 보고하고 0이 아니면 종료 코드 1

**`visits` 재검출은 하지 않는다.** 행정구역 컬럼만 UPDATE하므로 방문 경계·장소명은 그대로다.

- [ ] **Step 2: 인자 안전성 테스트**

`scripts/backfill-tracks.test.ts`와 같은 형태로 `scripts/backfill-visit-regions.test.ts`를 만든다. 최소 범위: 정상 dry-run, 정상 실전, `--dryrun`/`-dry-run`/`--Dry-Run`/앞 공백 붙은 `" --dry-run"` 네 변형이 **에러**를 반환할 것, 알 수 없는 플래그, 위치 인자 부족. `dryRun`이 false인지가 아니라 **에러 결과인지**를 단언한다.

`vitest.config.mts`는 이미 `scripts/**/*.{test,spec}.ts`를 포함한다.

- [ ] **Step 3: 테스트와 dry-run 확인**

Run: `yarn test scripts/`
Expected: PASS

Run: `npx tsx scripts/backfill-visit-regions.ts`
Expected: usage 출력 후 종료 코드 1, DB 풀 미생성

- [ ] **Step 4: 커밋**

```bash
npx biome check --write scripts/backfill-visit-regions.ts scripts/backfill-visit-regions.test.ts
git add scripts/
git commit -m "feat(location): add visit region backfill script"
```

---

### Task 7: `trip-naming` 별칭 테이블 제거

**Files:**
- Modify: `src/modules/location/services/trip-naming.ts`
- Test: `src/modules/location/services/trip-naming.test.ts` (기존 파일)

**Interfaces:**
- Consumes: 백필 완료 후의 `visits.city` (시/도 형태로 정규화된 값)

**이 태스크는 Task 6의 백필을 실제로 돌린 뒤에 한다.** 백필 전에는 기존 방문에 `"서울특별시"` 같은 값이 남아 있어, 별칭 테이블을 먼저 없애면 여행 이름이 오히려 깨진다.

- [ ] **Step 1: 기존 테스트 확인**

`trip-naming.test.ts`를 읽는다. `DOMESTIC_REGION_ALIASES`에 의존하는 케이스(예: `"서울특별시"`를 입력해 `"서울 여행"`을 기대)가 있으면, 백필 후 실제 데이터는 `"서울"`이므로 입력을 그에 맞게 바꾼다.

- [ ] **Step 2: 테스트 수정 후 실패 확인**

`city`가 `"서울"`로 들어오는 케이스를 추가한다.

Run: `yarn test src/modules/location/services/trip-naming.test.ts`
Expected: 새 케이스는 현재 코드로도 통과할 수 있다(별칭 테이블에 `"서울"`이 있으므로). 그렇다면 이 태스크는 리팩터링이며, 기존 테스트가 전부 통과하는 것이 성공 기준이다.

- [ ] **Step 3: 구현**

`DOMESTIC_REGION_ALIASES` 상수와 `normalizeDomesticRegion` 함수를 삭제하고, 호출부를 `visit.city` 직접 사용으로 바꾼다:

```ts
  const domesticRegions = domesticVisits
    .map((visit) => visit.city)
    .filter((region): region is string => region !== null && region.length > 0);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `yarn test src/modules/location/services/`
Expected: PASS

- [ ] **Step 5: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write src/modules/location/services/trip-naming.ts src/modules/location/services/trip-naming.test.ts
git add src/modules/location/services/
git commit -m "refactor(location): drop hardcoded region alias table"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| 1. `place_cache` 컬럼 추가 | Task 1 |
| 2. `GeocodingResult` 확장 | Task 1 |
| 3. 어댑터 3곳 | Task 2 (Kakao, Mapbox), Task 3 (Google) |
| 4. `extractCityCountry` 삭제 | Task 4 |
| 5. 캐시 자가 치유 | Task 4 (stale 판정에 `region === null` 추가) |
| 6. `DOMESTIC_REGION_ALIASES` 제거 | Task 7 (백필 이후로 순서 조정 — 사유는 태스크 본문에) |
| 7. `result_type` 재검토 | Task 5 (비교 스크립트가 제한 유무를 함께 측정) |
| 8. 비교 스크립트 | Task 5 |
| 9. 전체 백필 | Task 6 |
| 테스트 | Task 2·3(어댑터), Task 4(캐시 경로), Task 7(trip-naming) |

**스펙과의 차이 2건** — 둘 다 의도적이며 사유를 해당 태스크에 적었다.
- 마이그레이션 번호: 스펙의 0039는 오기, 실제로는 0040
- 6절 순서: 백필 이후로 이동

**타입 일관성** — `GeocodingResult.region`/`.country`는 Task 1에서 `string | null` 필수 필드로 정의되고 Task 2·3·4에서 같은 이름·타입으로 쓰인다. `placeCache.region`/`.country`도 같은 이름이라 Task 4의 캐시 히트 경로에서 그대로 매핑된다. `pickComponent`는 Task 3 안에서만 쓰인다.

**플레이스홀더** — Task 4 Step 2는 기존 테스트 인프라를 먼저 확인하도록 지시하고 인프라가 없을 때의 대안(순수 함수 추출)까지 명시했다. Task 6 Step 1의 인자 파싱 시그니처도 두 경로를 다 적었다. 그 외 미확정 항목은 없다.
