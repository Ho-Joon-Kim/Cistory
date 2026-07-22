import { describe, expect, it } from "vitest";
import {
  buildStationLineIndex,
  resolveStationLines,
  type StationLine,
} from "@/modules/subway/station-lines";

function line(partial: Partial<StationLine> & Pick<StationLine, "id">): StationLine {
  return {
    systemId: "seoul",
    name: null,
    ref: null,
    color: "#000000",
    ...partial,
  };
}

const SEOUL_1 = line({ id: "l1", ref: "1", name: "수도권 전철 1호선", color: "#0d3692" });
const SEOUL_2 = line({ id: "l2", ref: "2", name: "서울 지하철 2호선", color: "#33a23d" });
const SEOUL_10 = line({ id: "l10", ref: "10", name: "가상 10호선", color: "#ff0000" });
const REFLESS = line({ id: "lx", ref: null, name: "신분당선", color: "#d4003b" });
const BUSAN_1 = line({
  id: "b1",
  systemId: "busan",
  ref: "1",
  name: "부산 1호선",
  color: "#f06a00",
});

describe("resolveStationLines", () => {
  const index = buildStationLineIndex([SEOUL_1, SEOUL_2, SEOUL_10, REFLESS, BUSAN_1]);

  it("resolves a single-line station to its line colour", () => {
    expect(resolveStationLines(index, "seoul", ["2"])).toEqual([SEOUL_2]);
  });

  it("orders transfer stations numerically so line 1 wins over line 10", () => {
    // line_refs are stored lexicographically, which would put "10" first.
    expect(resolveStationLines(index, "seoul", ["10", "1"]).map((l) => l.id)).toEqual([
      "l1",
      "l10",
    ]);
  });

  it("matches refless lines by name", () => {
    expect(resolveStationLines(index, "seoul", ["신분당선"])).toEqual([REFLESS]);
  });

  it("scopes refs per system so cities with the same ref never cross over", () => {
    expect(resolveStationLines(index, "busan", ["1"])).toEqual([BUSAN_1]);
    expect(resolveStationLines(index, "daegu", ["1"])).toEqual([]);
  });

  it("drops refs with no matching line row", () => {
    expect(resolveStationLines(index, "seoul", ["없는노선", "2"])).toEqual([SEOUL_2]);
  });

  it("returns no lines when the station has no refs", () => {
    expect(resolveStationLines(index, "seoul", [])).toEqual([]);
  });

  it("dedupes a line reachable by both its ref and its name", () => {
    expect(resolveStationLines(index, "seoul", ["1", "수도권 전철 1호선"])).toEqual([SEOUL_1]);
  });
});

describe("buildStationLineIndex", () => {
  it("keeps a line's own ref when another line shares that string as its name", () => {
    const impostor = line({ id: "imp", ref: "9", name: "2" });
    // Order-independent: the ref pass always runs before the name pass.
    expect(buildStationLineIndex([SEOUL_2, impostor]).get("seoul:2")).toBe(SEOUL_2);
    expect(buildStationLineIndex([impostor, SEOUL_2]).get("seoul:2")).toBe(SEOUL_2);
  });
});
