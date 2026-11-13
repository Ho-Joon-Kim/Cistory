import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDb: vi.fn(),
  nearestKoreanAddresses: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/modules/location/services/saved-place-address", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/location/services/saved-place-address")>()),
  nearestKoreanAddresses: mocks.nearestKoreanAddresses,
}));

import { GET, POST } from "./route";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

describe("GET /api/saved-places", () => {
  it("adds displayAddress, preferring a cached Korean address for romanized ones", async () => {
    const fake = createMockDb([
      [
        { id: "a", name: "집", address: "서울 강남구" },
        { id: "b", name: "회사", address: "Nonhyeon-dong, Gangnam-gu" },
        { id: "c", name: "기타", address: null },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    mocks.nearestKoreanAddresses.mockResolvedValue(new Map([["b", "서울 강남구 논현동"]]));

    const body = await (await GET(new NextRequest("http://localhost/api/saved-places"))).json();

    expect(body).toEqual({
      places: [
        { id: "a", name: "집", address: "서울 강남구", displayAddress: "서울 강남구" },
        {
          id: "b",
          name: "회사",
          address: "Nonhyeon-dong, Gangnam-gu",
          displayAddress: "서울 강남구 논현동",
        },
        { id: "c", name: "기타", address: null, displayAddress: null },
      ],
    });
    expect(mocks.nearestKoreanAddresses).toHaveBeenCalledWith(fake.db, "user-1", ["b", "c"]);
    expect(fake.whereParams()[0]).toEqual(["user-1"]);
  });
});

describe("POST /api/saved-places", () => {
  function post(body: unknown) {
    return POST(
      new NextRequest("http://localhost/api/saved-places", {
        method: "POST",
        body: JSON.stringify(body),
      })
    );
  }

  it("clamps the radius, trims the name and returns 201", async () => {
    const fake = createMockDb([[{ id: "new", name: "카페" }]]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await post({ name: " 카페 ", lat: 37.5, lon: 127, radiusM: 9999, category: "" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ place: { id: "new", name: "카페" } });
    expect(fake.writes("values")[0]).toMatchObject({
      userId: "user-1",
      name: "카페",
      lat: 37.5,
      lon: 127,
      radiusM: 500,
      category: null,
      address: null,
    });
  });

  it("validates name and coordinates", async () => {
    mocks.getDb.mockReturnValue(createMockDb().db);
    expect((await post({ name: "", lat: 1, lon: 1 })).status).toBe(400);
    expect((await post({ name: "x", lat: "1", lon: 1 })).status).toBe(400);
  });
});
