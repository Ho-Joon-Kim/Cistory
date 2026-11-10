import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLegacyRecent, loadRecent, RECENT_KEY, saveRecent } from "./recent";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
}

describe("recent search terms", () => {
  let local: Storage;
  let session: Storage;
  beforeEach(() => {
    local = memoryStorage();
    session = memoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps terms in sessionStorage only, newest first, deduplicated and capped", () => {
    for (const t of ["a", "b", "c", "d", "e", "f", "g", "b"]) saveRecent(t);
    expect(loadRecent()).toEqual(["b", "g", "f", "e", "d", "c"]);
    expect(session.getItem(RECENT_KEY)).not.toBeNull();
    expect(local.getItem(RECENT_KEY)).toBeNull();
  });

  it("removes terms an earlier version left in localStorage", () => {
    local.setItem(RECENT_KEY, JSON.stringify(["병원"]));
    clearLegacyRecent();
    expect(local.getItem(RECENT_KEY)).toBeNull();
    expect(loadRecent()).toEqual([]);
  });

  it("degrades to no recent terms when storage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveRecent("x")).not.toThrow();
    expect(() => clearLegacyRecent()).not.toThrow();
    expect(loadRecent()).toEqual([]);
  });
});
