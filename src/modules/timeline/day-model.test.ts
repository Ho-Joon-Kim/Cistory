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
    // Newest first inside the expander, the type split from the title.
    expect(rows[0].commits[0]).toMatchObject({
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
