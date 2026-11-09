import { describe, expect, it } from "vitest";
import { isThemePreference, themeToApplyFromServer } from "./theme-sync";

describe("themeToApplyFromServer", () => {
  it("seeds a device that has never chosen a theme", () => {
    expect(themeToApplyFromServer("dark", null)).toBe("dark");
    expect(themeToApplyFromServer("system", null)).toBe("system");
  });

  it("never overrides an explicit choice stored on this device", () => {
    // Regression: the header toggle wrote "dark", then /dashboard's settings
    // fetch re-applied the server's "system" and the click appeared to do nothing.
    expect(themeToApplyFromServer("system", "dark")).toBeNull();
    expect(themeToApplyFromServer("light", "dark")).toBeNull();
    expect(themeToApplyFromServer("dark", "system")).toBeNull();
    expect(themeToApplyFromServer("dark", "dark")).toBeNull();
  });

  it("ignores a missing or malformed server value", () => {
    expect(themeToApplyFromServer(undefined, null)).toBeNull();
    expect(themeToApplyFromServer(null, null)).toBeNull();
    expect(themeToApplyFromServer("sepia" as never, null)).toBeNull();
  });

  it("treats garbage in storage as no choice", () => {
    expect(themeToApplyFromServer("dark", "")).toBe("dark");
    expect(themeToApplyFromServer("dark", "purple")).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("accepts the three preferences only", () => {
    expect(["light", "dark", "system"].every(isThemePreference)).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});
