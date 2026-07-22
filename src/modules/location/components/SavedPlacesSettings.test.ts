import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks")>();
  return {
    ...actual,
    useSavedPlaces: () => ({
      places: [
        {
          id: "place-1",
          name: "본가",
          lat: 36.35,
          lon: 127.38,
          radiusM: 100,
          category: null,
          address: "대전광역시",
          excludeFromTrips: true,
          tripExclusionRadiusM: 10_000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      isLoading: false,
      isSaving: false,
      createPlace: vi.fn(),
      updatePlace: vi.fn(),
      deletePlace: vi.fn(),
    }),
  };
});

import { SavedPlacesSettings } from "./SavedPlacesSettings";

describe("SavedPlacesSettings", () => {
  it("장소별 여행 제외 토글과 생활권 반경을 보여준다", () => {
    const markup = renderToStaticMarkup(createElement(SavedPlacesSettings));

    expect(markup).toContain("여행 감지에서 제외");
    expect(markup).toContain("여행 제외 10km");
    expect(markup).toContain('data-state="checked"');
  });
});
