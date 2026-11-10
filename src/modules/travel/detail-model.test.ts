import { describe, expect, it } from "vitest";
import {
  buildItinerary,
  dateKeysBetween,
  healthTable,
  mapLabels,
  mergeTransfers,
  mergeVisits,
  pickHeroDay,
  railServiceOn,
  routeByDay,
  routineInsight,
  shortCity,
  spendingView,
  stationOf,
  transportInsight,
  tripWindow,
} from "./detail-model";
import type { TravelTripDetail, TravelTripVisit } from "./hooks";

// KST wall clock → ISO instant.
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00+09:00`).toISOString();

let n = 0;
function visit(
  day: string,
  from: string,
  to: string,
  name: string,
  extra: Partial<TravelTripVisit> = {},
  endDay = day
): TravelTripVisit {
  n += 1;
  const startTime = at(day, from);
  const endTime = at(endDay, to);
  return {
    id: `v${n}`,
    centerLat: 36.3,
    centerLon: 127.4,
    startTime,
    endTime,
    durationSeconds: (Date.parse(endTime) - Date.parse(startTime)) / 1000,
    placeName: name,
    address: null,
    category: null,
    city: "대전광역시",
    countryName: "대한민국",
    savedPlaceName: null,
    savedPlaceCategory: null,
    ...extra,
  };
}

function detail(visits: TravelTripVisit[], over: Partial<TravelTripDetail> = {}): TravelTripDetail {
  return {
    trip: {
      id: "trip",
      userId: "u",
      name: "대전 여행",
      startDate: "2026-09-23",
      endDate: "2026-09-25",
      totalDistanceMeters: 355_000,
      visitedCities: ["대전"],
      visitedCountries: [],
      isOverseas: false,
      autoDetected: true,
      notes: null,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    },
    visits,
    spending: { total: 0, dailyAverage: 0, categories: [], transactions: [] },
    transport: { totalDistanceMeters: 0, modes: [] },
    routine: { codingSeconds: 0, commitCount: 0, comparison: null },
    health: [],
    spendingSince: "2026-03-03",
    ...over,
  };
}

const home = { savedPlaceName: "집", city: "서울특별시" };
const office = { savedPlaceName: "회사", city: "서울특별시" };
const parents = { savedPlaceName: "본가", placeName: "대전 중구" };

function trailVisits(): TravelTripVisit[] {
  return [
    visit("2026-09-24", "10:34", "10:40", "제철파전", { address: "대전 동구 세천동 1" }),
    visit("2026-09-24", "10:43", "10:50", "뒤로가든", { address: "대전 동구 세천동 2" }),
    visit("2026-09-24", "10:52", "10:58", "무장애나눔길", { address: "대전 동구 세천동 3" }),
    visit("2026-09-24", "11:03", "11:08", "산 7-10", { address: "대전 동구 삼정동 4" }),
    visit("2026-09-24", "11:09", "11:15", "산 79-1", { address: "대전 동구 세천동 5" }),
    visit("2026-09-24", "13:12", "13:20", "투썸플레이스", { address: "대전 동구 세천동 6" }),
  ];
}

function fullTrip(): TravelTripVisit[] {
  return [
    visit("2026-09-23", "09:00", "18:20", "회사", office),
    visit("2026-09-23", "18:25", "18:41", "집", home),
    visit("2026-09-23", "19:02", "19:15", "동작역"),
    visit("2026-09-23", "19:34", "20:07", "위니비니 서울역사점"),
    visit("2026-09-23", "21:36", "10:10", "본가", parents, "2026-09-24"),
    ...trailVisits(),
    visit("2026-09-24", "13:44", "14:15", "본가", parents, "2026-09-25"),
    visit("2026-09-25", "14:25", "14:34", "만두 대전KTX점"),
    visit("2026-09-25", "16:18", "23:00", "집", home),
  ];
}

describe("trip window", () => {
  it("runs from leaving home to getting back home", () => {
    const w = tripWindow(fullTrip());
    expect(w.departFromHome).toBe(true);
    expect(w.departAt).toBe(at("2026-09-23", "18:41"));
    expect(w.arriveHome).toBe(true);
    expect(w.arriveAt).toBe(at("2026-09-25", "16:18"));
    expect(w.minutes).toBe(45 * 60 + 37);
  });

  it("falls back to the first and last stop when home was never recorded", () => {
    const w = tripWindow([
      visit("2026-09-23", "10:00", "11:00", "a"),
      visit("2026-09-24", "12:00", "13:00", "b"),
    ]);
    expect(w.departFromHome).toBe(false);
    expect(w.departAt).toBe(at("2026-09-23", "10:00"));
    expect(w.arriveAt).toBe(at("2026-09-24", "13:00"));
  });
});

describe("itinerary", () => {
  it("joins a stay cut at midnight and keeps far-apart transfer stops unfolded", () => {
    const merged = mergeVisits([
      visit("2026-09-23", "21:36", "23:59", "본가", parents),
      visit("2026-09-24", "00:00", "10:10", "본가", parents),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].durationSeconds).toBe((12 * 60 + 34) * 60);

    const transfers = ["10:00", "10:20", "10:40", "11:00", "11:20"].map((t, i) =>
      visit(
        "2026-09-23",
        t,
        t.replace(/:\d0$/, (m) => `${m.slice(0, 2)}5`),
        `역 ${i}`,
        {
          centerLat: 37.4 + i * 0.05,
        }
      )
    );
    expect(buildItinerary(detail(transfers)).runs).toHaveLength(0);
  });

  it("skips office/home stays, splits lodging into anchors and folds the dense trail", () => {
    const it = buildItinerary(
      detail(fullTrip(), {
        spending: {
          total: 8000,
          dailyAverage: 0,
          categories: [],
          transactions: [
            {
              id: "tx",
              amount: 8000,
              merchant: "코레일유통",
              accountName: "토스",
              category: "transport",
              transactedAt: at("2026-09-23", "19:40"),
            },
          ],
        },
      })
    );
    expect(it.skippedRoutine).toBe(1);
    const [d1, d2, d3] = it.days;
    expect(d1.sub).toBe("서울 → 대전");
    expect(
      d1.items.map((i) => (i.kind === "stop" ? i.name : i.kind === "anchor" ? i.label : "run"))
    ).toEqual(["집에서 출발", "동작역", "위니비니 서울역사점", "본가 도착"]);
    const shop = d1.items[2];
    expect(shop.kind === "stop" && shop.note).toBe("19:40 코레일유통 8,000원");
    const arrive = d1.items[3];
    expect(arrive.kind === "anchor" && arrive.note).toBe("대전 · 이튿날 10:10까지");

    expect(d2.sub).toBe("세천동 일대");
    expect(d2.items.map((i) => i.kind)).toEqual(["anchor", "run", "stop", "anchor"]);
    const run = d2.items[1];
    expect(run.kind === "run" && run.run.stops).toHaveLength(5);

    expect(d3.items.map((i) => (i.kind === "anchor" ? i.label : i.kind))).toEqual([
      "본가에서 출발",
      "stop",
      "집 도착",
    ]);
  });
});

describe("health, hero day and route", () => {
  const health: TravelTripDetail["health"] = [
    ["2026-09-23", "steps", 4044],
    ["2026-09-24", "steps", 11251],
    ["2026-09-25", "steps", 3509],
    ["2026-09-24", "active_zone_minutes", 207],
    ["2026-09-23", "resting_heart_rate", 59],
    ["2026-09-24", "heart_rate", 81],
  ].map(([day, metric, v]) => ({
    day: day as string,
    metric: metric as string,
    valueAvg: v as number,
    valueMin: metric === "heart_rate" ? 47 : null,
    valueMax: metric === "heart_rate" ? 176 : null,
    valueSum: metric === "steps" || metric === "active_zone_minutes" ? (v as number) : null,
    count: 1,
  }));

  it("keeps steps, active zone and resting heart rate up front and the rest behind a disclosure", () => {
    const table = healthTable(detail([], { health }));
    expect(table.days).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(table.primary.map((r) => r.label)).toEqual(["걸음", "활동 존", "안정 심박"]);
    expect(table.primary[0].cells.map((c) => c.text)).toEqual(["4,044", "11,251", "3,509"]);
    expect(table.primary[1].cells.map((c) => c.text)).toEqual(["–", "207", "–"]);
    expect(table.more.map((r) => r.key)).toEqual(["heart_rate"]);
    expect(table.more[0].cells[1].text).toBe("81");
    expect(table.more[0].cells[1].sub).toBe("47–176");
  });

  it("reads the VO₂max row from daily_vo2_max first, falling back to vo2_max per day", () => {
    const vo2 = (day: string, metric: string, v: number) => ({
      day,
      metric,
      valueAvg: v,
      valueMin: null,
      valueMax: null,
      valueSum: null,
      count: 1,
    });
    const table = healthTable(
      detail([], {
        health: [
          vo2("2026-09-23", "daily_vo2_max", 44.2),
          vo2("2026-09-23", "vo2_max", 40),
          vo2("2026-09-24", "vo2_max", 41.5),
        ],
      })
    );
    const row = table.more.find((r) => r.key === "vo2_max");
    expect(row?.cells.map((c) => c.text)).toEqual(["44.2", "41.5", "–"]);
  });

  it("picks the day with by far the most steps and ties it to that day's dense run", () => {
    const d = detail(fullTrip(), { health });
    const { runs } = buildItinerary(d);
    const hero = pickHeroDay(d, runs);
    expect(hero?.day).toBe("2026-09-24");
    expect(hero?.insight.trigger).toBe("3.0배");
    expect(hero?.insight.pre).toBe("다른 2일 평균 3,777걸음의 ");
    expect(hero?.insight.post).toContain(" — 10:34부터");
    expect(hero?.run?.stops).toHaveLength(5);
  });

  it("has no hero day when steps are flat", () => {
    const flat = health.map((h) => (h.metric === "steps" ? { ...h, valueSum: 5000 } : h));
    expect(pickHeroDay(detail([], { health: flat }), [])).toBeNull();
  });

  it("splits the route by KST day into out / middle / back", () => {
    const pts = [
      { lat: 1, lon: 1, accuracy: null, timestamp: at("2026-09-23", "20:00") },
      { lat: 1, lon: 1, accuracy: null, timestamp: at("2026-09-24", "00:30") },
      { lat: 1, lon: 1, accuracy: null, timestamp: at("2026-09-25", "15:00") },
    ];
    expect(routeByDay(pts, "2026-09-23", "2026-09-25").map((d) => [d.day, d.role])).toEqual([
      ["2026-09-23", "out"],
      ["2026-09-24", "middle"],
      ["2026-09-25", "back"],
    ]);
  });
});

describe("spending, transport and routine lines", () => {
  it("flags a single transaction that is most of the trip's spending", () => {
    const view = spendingView(
      detail([], {
        spending: {
          total: 265_790,
          dailyAverage: 0,
          categories: [
            { category: "gift", total: 200_000, count: 1 },
            { category: "food", total: 65_790, count: 3 },
          ],
          transactions: [
            {
              id: "a",
              amount: 200_000,
              merchant: "x",
              accountName: "y",
              category: "gift",
              transactedAt: at("2026-09-25", "11:52"),
            },
            {
              id: "b",
              amount: 65_790,
              merchant: "x",
              accountName: "y",
              category: "food",
              transactedAt: at("2026-09-25", "17:59"),
            },
          ],
        },
      })
    );
    expect(view.top).toEqual({ label: "경조·선물", total: 200_000, share: 200_000 / 265_790 });
    expect(view.rest).toBe(65_790);
    expect(view.oneOff?.id).toBe("a");
  });

  it("warns when much of the classified distance has no mode, and compares commits", () => {
    const d = detail([], {
      transport: {
        totalDistanceMeters: 304_000,
        modes: [
          { mode: "driving", distanceMeters: 138_921, durationSeconds: 1, segmentCount: 1 },
          { mode: "unknown", distanceMeters: 77_519, durationSeconds: 1, segmentCount: 1 },
        ],
      },
      routine: {
        codingSeconds: 3600,
        commitCount: 472,
        comparison: {
          codingSeconds: 7200,
          commitCount: 526,
          codingPercentChange: -50,
          commitPercentChange: -10,
        },
      },
    });
    expect(transportInsight(d)?.trigger).toBe("25%");
    const routine = routineInsight(d);
    expect(`${routine?.pre}${routine?.trigger}${routine?.post}`).toBe(
      "여행 중 커밋 472건 — 직전 3일 526건보다 10% 적었어요."
    );
  });

  it("formats small helpers", () => {
    expect(dateKeysBetween("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(shortCity("제주특별자치도")).toBe("제주");
    expect(shortCity("Kowloon")).toBe("Kowloon");
  });
});

describe("transfers and map labels", () => {
  it("merges a same-station line change into one row", () => {
    const items = mergeTransfers([
      {
        kind: "stop",
        key: "a",
        at: at("2026-09-23", "18:00"),
        endAt: at("2026-09-23", "18:06"),
        name: "동작역 9호선",
        minutes: 6,
      },
      {
        kind: "stop",
        key: "b",
        at: at("2026-09-23", "18:09"),
        endAt: at("2026-09-23", "18:13"),
        name: "동작역 4호선",
        minutes: 4,
      },
      {
        kind: "stop",
        key: "c",
        at: at("2026-09-23", "19:00"),
        endAt: at("2026-09-23", "19:10"),
        name: "서울역",
        minutes: 10,
      },
    ]);
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first.kind === "stop" && [first.name, first.minutes, first.note]).toEqual([
      "동작역",
      13,
      "9호선 → 4호선 환승",
    ]);
  });

  it("keeps two visits to one line, or two stations, apart", () => {
    const items = mergeTransfers([
      {
        kind: "stop",
        key: "a",
        at: at("2026-09-23", "18:00"),
        endAt: at("2026-09-23", "18:06"),
        name: "동작역 9호선",
        minutes: 6,
      },
      {
        kind: "stop",
        key: "b",
        at: at("2026-09-23", "18:09"),
        endAt: at("2026-09-23", "18:13"),
        name: "동작역 9호선",
        minutes: 4,
      },
      {
        kind: "stop",
        key: "c",
        at: at("2026-09-23", "18:20"),
        endAt: at("2026-09-23", "18:23"),
        name: "사당역 4호선",
        minutes: 3,
      },
    ]);
    expect(items).toHaveLength(3);
  });

  it("labels saved places and stations, never shop names", () => {
    const labels = mapLabels(
      detail([
        visit("2026-09-23", "18:00", "18:10", "서울역 경부선", { centerLat: 37.55 }),
        visit("2026-09-23", "18:12", "18:40", "위니비니 서울역사점", { centerLat: 37.0 }),
        visit("2026-09-23", "21:00", "23:00", "본가", { savedPlaceName: "본가", centerLat: 36.3 }),
      ])
    );
    expect(labels.map((l) => [l.text, l.kind])).toEqual([
      ["본가", "anchor"],
      ["서울역", "station"],
    ]);
  });

  it("names the shared home/office marker 집 when the trip leaves from home", () => {
    const labels = mapLabels(
      detail([
        visit("2026-09-23", "09:00", "18:00", "회사", { savedPlaceName: "회사", centerLat: 37.5 }),
        visit("2026-09-23", "18:30", "18:40", "집", { savedPlaceName: "집", centerLat: 37.51 }),
        visit("2026-09-23", "21:00", "23:00", "본가", { savedPlaceName: "본가", centerLat: 36.3 }),
      ])
    );
    expect(labels[0].text).toBe("집");
  });

  it("names the rail service from the day's stations", () => {
    const d = detail([
      visit("2026-09-23", "18:00", "18:10", "서울역 경부선"),
      visit("2026-09-24", "15:00", "15:20", "공차 SRT수서역점"),
    ]);
    d.transport.modes = [
      { mode: "train", distanceMeters: 300000, durationSeconds: 7200, segmentCount: 2 },
    ];
    expect(railServiceOn(d, "2026-09-23")).toBe("KTX");
    expect(railServiceOn(d, "2026-09-24")).toBe("SRT");
    d.transport.modes = [];
    expect(railServiceOn(d, "2026-09-23")).toBeNull();
  });

  it("names a walk after the landmark it was on", () => {
    const trail = trailVisits().map((v) =>
      v.placeName === "무장애나눔길"
        ? { ...v, placeName: "식장산 무장애나눔길", category: "관광명소" }
        : v
    );
    expect(buildItinerary(detail(trail)).runs[0].label).toBe("식장산 산행");
  });

  it("reads stations off station concessions", () => {
    expect(stationOf("위니비니 서울역사점")).toBe("서울역");
    expect(stationOf("공차 SRT수서역점")).toBe("수서역");
    expect(stationOf("엔제리너스 광명KTX점")).toBe("광명역");
    expect(stationOf("육거리소문만두 대전ktx점")).toBe("대전역");
    expect(stationOf("롯데리아 천안아산역사점")).toBe("천안아산역");
    expect(stationOf("바나프레소 선정릉점")).toBeNull();
    expect(stationOf("하이테이블 차병원사거리점")).toBeNull();
  });
});
