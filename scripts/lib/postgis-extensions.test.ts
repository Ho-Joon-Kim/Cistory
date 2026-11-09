import { describe, expect, it, vi } from "vitest";
import {
  type ExtensionRow,
  INSTALLED_EXTENSIONS_SQL,
  upgradePostgisExtensions,
} from "./postgis-extensions";

function fakeClient(rows: ExtensionRow[]) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rows: sql === INSTALLED_EXTENSIONS_SQL ? rows : [] };
    }),
  };
  return { client, statements };
}

const quiet = { log: vi.fn(), warn: vi.fn() };

describe("upgradePostgisExtensions", () => {
  it("does nothing when installed versions already match the image", async () => {
    const { client, statements } = fakeClient([
      { name: "postgis", installed_version: "3.7.0", default_version: "3.7.0" },
      { name: "postgis_topology", installed_version: "3.7.0", default_version: "3.7.0" },
    ]);
    const result = await upgradePostgisExtensions(client, quiet);
    expect(result.upgraded).toEqual([]);
    expect(statements).toEqual([INSTALLED_EXTENSIONS_SQL]);
  });

  it("upgrades postgis before its dependents, whatever order the catalog returns", async () => {
    const { client, statements } = fakeClient([
      { name: "postgis_topology", installed_version: "3.5.3", default_version: "3.7.0" },
      { name: "postgis", installed_version: "3.5.3", default_version: "3.7.0" },
    ]);
    const result = await upgradePostgisExtensions(client, quiet);
    expect(statements.slice(1)).toEqual([
      "ALTER EXTENSION postgis UPDATE",
      "ALTER EXTENSION postgis_topology UPDATE",
    ]);
    expect(result.upgraded).toEqual([
      { name: "postgis", from: "3.5.3", to: "3.7.0" },
      { name: "postgis_topology", from: "3.5.3", to: "3.7.0" },
    ]);
  });

  it("reports extensions the image no longer ships instead of touching them", async () => {
    const warn = vi.fn();
    const { client, statements } = fakeClient([
      { name: "postgis", installed_version: "3.7.0", default_version: "3.7.0" },
      { name: "postgis_tiger_geocoder", installed_version: "3.5.3", default_version: null },
    ]);
    const result = await upgradePostgisExtensions(client, { log: vi.fn(), warn });
    expect(result.orphaned).toEqual([
      { name: "postgis_tiger_geocoder", installedVersion: "3.5.3" },
    ]);
    expect(statements).toEqual([INSTALLED_EXTENSIONS_SQL]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("never upgrades a still-shipped extension outside the PostGIS allowlist", async () => {
    const { client, statements } = fakeClient([
      { name: "address_standardizer", installed_version: "3.5.3", default_version: "3.6.0" },
    ]);
    await upgradePostgisExtensions(client, quiet);
    expect(statements).toEqual([INSTALLED_EXTENSIONS_SQL]);
  });
});
