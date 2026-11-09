import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts";
import type { HealthSleepSession } from "@/modules/health/types";
import type { StayPointData } from "@/modules/location/hooks";
import { pickDayFact } from "./day-facts";
import { buildDayModel, sleepForDay } from "./day-model";
import type { TimelineCommit } from "./hooks";

const DATE = "2026-11-09";
const at = (hhmm: string, date = DATE) => new Date(`${date}T${hhmm}:00+09:00`).toISOString();

const night = (date: string, minutes: number): HealthSleepSession => ({
  start: at("01:00", date),
  minutes,
  nap: false,
  stages: { deep: 40, light: 200, rem: 40, awake: 20 },
  segments: null,
});

function stay(name: string, from: string, to: string): StayPointData {
  return {
    lat: 37.5,
    lon: 127,
    placeName: name,
    address: null,
    category: null,
    startTime: at(from),
    endTime: at(to),
    durationMinutes: 0,
  };
}

function commit(i: number, hhmm: string): TimelineCommit {
  return {
    id: String(i),
    sha: `${i}`.padStart(7, "0"),
    message: "fix: x",
    authorName: "me",
    authorAvatarUrl: null,
    committedAt: at(hhmm),
    additions: 1,
    deletions: 1,
    changedFilesCount: 1,
    isMergeCommit: false,
    repository: { fullName: "o/r", id: 1, isPrivate: false },
    summary: null,
  };
}

function model(opts: {
  sleeps?: HealthSleepSession[];
  commits?: TimelineCommit[];
  stays?: StayPointData[];
}) {
  const sleeps = opts.sleeps ?? [];
  return buildDayModel({
    date: DATE,
    stayPoints: opts.stays ?? [],
    tracks: [],
    locations: [],
    commits: opts.commits ?? [],
    transactions: [],
    sleep: sleepForDay(sleeps, DATE),
    recentSleeps: sleeps,
    workouts: [],
  });
}

describe("pickDayFact", () => {
  it("calls out the shortest night of the recent ones", () => {
    const sleeps = [
      night(DATE, 300),
      night("2026-11-08", 400),
      night("2026-11-07", 420),
      night("2026-11-06", 410),
      night("2026-11-05", 390),
      night("2026-11-04", 430),
    ];
    const m = model({ sleeps });
    const picked = pickDayFact({
      date: DATE,
      model: m,
      recentSleeps: sleeps,
      priorCommitCounts: null,
      isToday: false,
    });
    expect(picked?.fact.id).toBe("day.sleep.low");
    expect(renderTemplate(picked!.fact).text).toBe("최근 6밤 중 가장 짧은 4시간 40분을 잤어요.");
    expect(picked?.fact.evidence).toEqual({ kind: "keys", keys: ["sleep"] });
  });

  it("calls out a commit burst against the last seven days", () => {
    const commits = Array.from({ length: 30 }, (_, i) => commit(i, `1${i % 10}:0${i % 6}`));
    const m = model({ commits });
    const picked = pickDayFact({
      date: DATE,
      model: m,
      recentSleeps: [],
      priorCommitCounts: [5, 5, 5, 5, 5, 5, 5],
      isToday: false,
    });
    expect(picked?.fact.id).toBe("day.commits.delta");
    expect(renderTemplate(picked!.fact).text).toBe("커밋 30건 — 최근 7일 평균 5건의 6배예요.");
  });

  it("mentions a long stay away from home", () => {
    const m = model({
      stays: [
        stay("집", "00:00", "08:00"),
        stay("회사", "08:30", "21:00"),
        stay("집", "21:30", "23:59"),
      ],
    });
    const picked = pickDayFact({
      date: DATE,
      model: m,
      recentSleeps: [],
      priorCommitCounts: null,
      isToday: false,
    });
    expect(renderTemplate(picked!.fact).text).toBe("회사에서 12시간 30분 머물렀어요.");
  });

  it("stays silent on an ordinary day", () => {
    const m = model({ commits: [commit(1, "10:00")], stays: [stay("집", "00:00", "23:59")] });
    expect(
      pickDayFact({
        date: DATE,
        model: m,
        recentSleeps: [],
        priorCommitCounts: [2, 1, 0, 3, 1, 2, 1],
        isToday: false,
      })
    ).toBeNull();
  });
});
