import { describe, expect, it } from "vitest";
import type { HealthSleepSession } from "@/modules/health/types";
import type { LocationData, StayPointData, TrackData } from "@/modules/location/hooks";
import type { TransactionItem } from "@/modules/spending/hooks";
import {
  buildDayModel,
  clusterCommits,
  formatDurationSeconds,
  formatMeters,
  minuteOfDay,
  placeChain,
  ridesFromGaps,
  shortArea,
  sleepForDay,
} from "./day-model";
import type { TimelineCommit } from "./hooks";

const DATE = "2026-11-09";
/** KST wall time on DATE → ISO instant. */
const at = (hhmm: string, date = DATE) => new Date(`${date}T${hhmm}:00+09:00`).toISOString();

function commit(id: string, hhmm: string, opts: Partial<TimelineCommit> = {}): TimelineCommit {
  return {
    id,
    sha: `${id}0000000`,
    message: `perf(api): 커밋 ${id}`,
    authorName: "me",
    authorAvatarUrl: null,
    committedAt: at(hhmm),
    additions: 10,
    deletions: 2,
    changedFilesCount: 1,
    isMergeCommit: false,
    repository: { fullName: "org/core", id: 1, isPrivate: true },
    summary: null,
    ...opts,
  };
}

function stay(
  name: string,
  from: string,
  to: string,
  extra: Partial<StayPointData> = {}
): StayPointData {
  return {
    lat: 37.5,
    lon: 127.03,
    placeName: name,
    address: "서울 강남구 논현동 123",
    category: null,
    startTime: at(from),
    endTime: at(to),
    durationMinutes: 0,
    ...extra,
  };
}

function track(id: string, from: string, to: string, extra: Partial<TrackData> = {}): TrackData {
  return {
    id,
    startTime: at(from),
    endTime: at(to),
    distanceMeters: 2733,
    durationSeconds: 891,
    pointCount: 20,
    startPlaceName: "집",
    endPlaceName: "회사",
    dominantMode: "cycling",
    elevationGain: 61,
    elevationLoss: 74,
    segments: [],
    ...extra,
  };
}

function tx(
  id: string,
  hhmm: string,
  amount: number,
  extra: Partial<TransactionItem> = {}
): TransactionItem {
  return {
    id,
    type: "withdrawal",
    amount,
    merchant: `가게${id}`,
    accountName: "통장",
    rawTitle: "",
    rawText: "",
    transactedAt: at(hhmm),
    bucket: "spending",
    spendingOverride: null,
    overrideNote: null,
    category: "food",
    categorySource: "ai",
    categoryConfidence: 0.9,
    ...extra,
  };
}

describe("time and format helpers", () => {
  it("measures minutes from KST midnight regardless of the runtime zone", () => {
    expect(minuteOfDay(at("00:00"), DATE)).toBe(0);
    expect(minuteOfDay(at("08:43"), DATE)).toBe(523);
    expect(minuteOfDay(at("23:30", "2026-11-08"), DATE)).toBe(-30);
  });

  it("formats durations and distances like the design", () => {
    expect(formatDurationSeconds(891)).toBe("14분 51초");
    expect(formatDurationSeconds(45)).toBe("45초");
    expect(formatDurationSeconds(7380)).toBe("2시간 3분");
    expect(formatMeters(184)).toBe("184m");
    expect(formatMeters(2733)).toBe("2.7km");
  });

  it("keeps the 구 and 동 of a Korean address", () => {
    expect(shortArea("서울 강남구 논현동 123-4")).toBe("강남구 논현동");
    expect(shortArea("Nonhyeon-dong, 06112, Gangnam-gu, Seoul")).toBe("Nonhyeon-dong, Gangnam-gu");
    expect(shortArea(null)).toBe("");
    // Inside Korea a romanized fallback address is hidden, not shown in English.
    expect(shortArea("Nonhyeon-dong, 06112, Gangnam-gu, Seoul", { korean: true })).toBe("");
    expect(shortArea("서울 강남구 논현동 123-4", { korean: true })).toBe("강남구 논현동");
  });
});

describe("clusterCommits", () => {
  it("groups same-repo commits within 30 minutes and picks a specific AI summary", () => {
    const rows = clusterCommits(
      [
        commit("a", "01:02", {
          summary: { status: "completed", summary: "내부 개선 (사용자 영향 없음)" },
          additions: 500,
        }),
        commit("b", "01:05", {
          summary: { status: "completed", summary: "검색이 더 빨라졌습니다." },
          additions: 50,
        }),
        commit("c", "01:20"),
        commit("d", "03:00"),
        commit("e", "01:10", { repository: { fullName: "org/web", id: 2, isPrivate: false } }),
      ],
      DATE
    );
    expect(rows.map((r) => [r.range, r.count, r.repo])).toEqual([
      ["01:02–01:20", 3, "core"],
      ["01:10", 1, "web"],
      ["03:00", 1, "core"],
    ]);
    expect(rows[0].summary).toBe("검색이 더 빨라졌습니다.");
    expect(rows[0].summarized).toBe(2);
    // Oldest first inside the expander (it hangs under an ascending rail), the
    // type split from the title.
    expect(rows[0].commits.map((c) => c.time)).toEqual(["01:02", "01:05", "01:20"]);
    expect(rows[0].commits[2]).toMatchObject({
      time: "01:20",
      hasSummary: false,
      meta: "perf(api) · c000000",
    });
    expect(rows[1].summary).toBeNull();
    expect(rows[1].plain).toBe("커밋 e");
  });
});

describe("sleepForDay", () => {
  const night = (start: string, minutes: number, nap = false): HealthSleepSession => ({
    start,
    minutes,
    nap,
    stages: { deep: 40, light: 200, rem: 40, awake: 60 },
    segments: null,
  });

  it("takes the main night that ends on the day, never a nap", () => {
    const last = night(at("23:40", "2026-11-08"), 420);
    const nap = night(at("14:00"), 40, true);
    const next = night(at("23:50"), 400);
    expect(sleepForDay([next, nap, last], DATE)).toBe(last);
    expect(sleepForDay([nap], DATE)).toBeNull();
  });
});

describe("ridesFromGaps", () => {
  it("turns movement between stays into rides and drops GPS drift", () => {
    const pts = (hhmm: string, lat: number): LocationData => ({
      lat,
      lon: 127.03,
      accuracy: 10,
      altitude: null,
      velocity: null,
      battery: null,
      timestamp: at(hhmm),
    });
    const stays = [stay("집", "00:00", "08:40"), stay("회사", "09:00", "18:00")];
    const locations = [
      pts("08:41", 37.5),
      pts("08:50", 37.51),
      pts("08:59", 37.52),
      pts("18:30", 37.52),
      pts("18:40", 37.5201),
    ];
    const rides = ridesFromGaps(locations, stays, DATE);
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({ from: "집", to: "회사", time: "08:41", distance: "2.2km" });
  });
});

describe("buildDayModel", () => {
  const model = buildDayModel({
    date: DATE,
    stayPoints: [
      stay("집", "00:00", "08:43"),
      stay("회사", "08:58", "21:04", { address: "서울 서초구 서초동 1" }),
      stay("집", "21:20", "23:53"),
    ],
    tracks: [track("t1", "08:43", "08:58")],
    locations: [],
    commits: [commit("a", "00:05"), commit("b", "11:37"), commit("c", "22:39")],
    transactions: [
      tx("1", "09:55", 7890, { category: "subscription", categoryConfidence: 0.95 }),
      tx("2", "21:28", 16400),
      tx("3", "12:00", 3000, { bucket: "income", type: "deposit", accountName: "급여통장" }),
      tx("4", "12:30", 2000, { bucket: "ignore", type: "cancel" }),
    ],
    sleep: null,
    recentSleeps: [],
    workouts: [{ start: at("08:45"), minutes: 14, name: "전기 자전거", type: "BIKING" }],
  });

  it("hangs commits, payments and income under the stay they happened at", () => {
    expect(model.rows.map((r) => `${r.kind}:${r.time}`)).toEqual([
      "stay:00:00",
      "commits:00:05",
      "ride:08:43",
      "stay:08:58",
      "tx:09:55",
      "commits:11:37",
      "income:12:00",
      "stay:21:20",
      "tx:21:28",
      "commits:22:39",
    ]);
    const kid = model.rows.find((r) => r.kind === "tx" && r.time === "09:55");
    expect(kid?.mapId).toBe("s1");
  });

  it("counts spending only and flags a subscription", () => {
    expect(model.spendTotal).toBe(24290);
    expect(model.spendCount).toBe(2);
    const sub = model.rows.find((r) => r.kind === "tx" && r.time === "09:55");
    expect(sub?.flag?.label).toBe("정기 결제");
    expect(sub?.flag?.reason).toContain("95%");
  });

  it("names a ride after a matching workout and says why", () => {
    const ride = model.rides[0];
    expect(ride.mode).toBe("전기자전거");
    expect(ride.flag?.label).toBe("건강 기록과 일치");
    expect(ride).toMatchObject({
      distance: "2.7km",
      duration: "14분 51초",
      from: "집",
      to: "회사",
    });
  });

  it("builds the place chain with only the longest stay's duration", () => {
    expect(model.chain).toEqual([
      { name: "집", duration: null },
      { name: "회사", duration: "12시간 6분" },
      { name: "집", duration: null },
    ]);
    expect(placeChain([])).toEqual([]);
  });
});

describe("buildDayModel — QA fixes", () => {
  const base = {
    date: DATE,
    locations: [],
    commits: [],
    transactions: [],
    sleep: null,
    recentSleeps: [],
    workouts: [],
  };

  it("keeps the rail monotonic when a ride leaves during a stay", () => {
    const model = buildDayModel({
      ...base,
      stayPoints: [stay("광주송정역", "19:30", "20:10"), stay("집", "22:00", "23:50")],
      tracks: [track("t1", "20:06", "21:50", { startPlaceName: null, endPlaceName: null })],
      transactions: [tx("1", "20:08", 3000)],
    });
    const times = model.rows.map((r) => r.start);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(model.rows.map((r) => `${r.kind}:${r.time}`)).toEqual([
      "stay:19:30",
      "ride:20:06",
      "tx:20:08",
      "stay:22:00",
    ]);
    // The payment still lights the stay it happened at on the map.
    expect(model.rows.find((r) => r.kind === "tx")?.mapId).toBe("s0");
    // Unnamed endpoints take the neighbouring stays' names.
    expect(model.rides[0]).toMatchObject({ from: "광주송정역", to: "집" });
  });

  it("flags a mode whose speed is implausible instead of advertising it", () => {
    const seg = (max: number) => ({
      mode: "cycling",
      startTime: at("10:00"),
      endTime: at("10:30"),
      distanceMeters: 7200,
      durationSeconds: 1800,
      avgSpeedKmh: 14,
      maxSpeedKmh: max,
      subwayLegs: [],
    });
    const model = buildDayModel({
      ...base,
      stayPoints: [],
      tracks: [
        track("t1", "10:00", "10:30", {
          distanceMeters: 7200,
          durationSeconds: 1800,
          segments: [seg(155.8)] as unknown as TrackData["segments"],
        }),
      ],
    });
    expect(model.rides[0].flag?.label).toBe("수단 확인 필요");
    expect(model.rides[0].flag?.label).not.toContain("km/h");
  });

  it("does not vouch for a workout match on an implausibly fast track", () => {
    const model = buildDayModel({
      ...base,
      stayPoints: [],
      workouts: [{ start: at("12:40"), minutes: 37, name: "걷기", type: "WALKING" }],
      tracks: [
        track("t1", "12:40", "13:18", {
          dominantMode: "walking",
          distanceMeters: 9916,
          durationSeconds: 2241,
          segments: [
            {
              mode: "walking",
              startTime: at("12:40"),
              endTime: at("13:02"),
              distanceMeters: 3911,
              durationSeconds: 1294,
              avgSpeedKmh: 10.9,
              maxSpeedKmh: 246.6,
              subwayLegs: [],
            },
          ] as unknown as TrackData["segments"],
        }),
      ],
    });
    expect(model.rides[0].flag?.label).toBe("수단 확인 필요");
    expect(model.rides[0].flag?.reason).toContain("걷기");
  });

  it("nests stays a track passes through and names its ends after the shown stays", () => {
    const model = buildDayModel({
      ...base,
      stayPoints: [
        stay("집", "08:00", "12:40"),
        stay("커피빈", "12:44", "12:49"),
        stay("수서역", "13:13", "13:16"),
        stay("공차", "13:19", "14:12"),
      ],
      tracks: [track("t1", "12:40", "13:18", { endPlaceName: "라온&제면명가" })],
    });
    expect(model.rides[0]).toMatchObject({ from: "집", to: "공차", stops: ["커피빈", "수서역"] });
    expect(model.stays.filter((s) => s.via).map((s) => s.name)).toEqual(["커피빈", "수서역"]);
    expect(model.stays.find((s) => s.name === "공차")?.via).toBeUndefined();
  });

  it("merges back-to-back visits to one place and splits distant deposits", () => {
    const model = buildDayModel({
      ...base,
      stayPoints: [stay("카페다온", "10:00", "10:10"), stay("카페다온", "10:15", "11:37")],
      tracks: [],
      transactions: [
        tx("a", "00:26", 1000, { bucket: "income", type: "deposit" }),
        tx("b", "00:26", 2000, { bucket: "income", type: "deposit" }),
        tx("c", "13:09", 3000, { bucket: "income", type: "deposit" }),
      ],
    });
    expect(model.stays).toHaveLength(1);
    expect(model.stays[0].range).toBe("10:00–11:37");
    const income = model.rows.filter((r) => r.kind === "income");
    expect(income.map((r) => r.time)).toEqual(["00:26", "13:09"]);
    expect(income.map((r) => (r.kind === "income" ? r.note : ""))).toEqual(["", "입금"]);
  });
});
