/**
 * Brings the *installed* PostGIS extensions up to the version the running
 * image's binaries provide. Called by scripts/migrate.ts on every run.
 *
 * Why this is not a Drizzle migration: pulling a newer postgis/postgis image
 * onto the existing `cistory_postgres_data` volume swaps the shared library
 * (`postgis-3.so`) but leaves each database's catalog at the old extension
 * version until `ALTER EXTENSION ... UPDATE` runs. Jenkins' deploy path
 * (`docker start cistory-db || docker compose up -d postgres`) never recreates
 * an existing container, so the image swap is a manual operator step that can
 * land before OR after the deploy that ships the new tag. A one-shot
 * migration that ran against the old image would be a recorded no-op in
 * `__drizzle_migrations` and never run again. This check is instead
 * idempotent and runs every time: it does nothing until `default_version`
 * (what the binaries ship) differs from `installed_version`, and then
 * upgrades exactly once.
 *
 * `postgis` goes first because the others depend on it. Extensions installed
 * in the database but no longer shipped by the image (PostGIS 3.7 removed
 * `postgis_tiger_geocoder` and `address_standardizer`; the docker-postgis
 * initdb script installed the tiger geocoder into POSTGRES_DB on < 3.7
 * images) can't be upgraded and are only reported — dropping them is left to
 * a human, since DROP EXTENSION takes its schema's objects with it.
 */

/** PostGIS-family extensions upgraded in lockstep with the `postgis` library. */
export const POSTGIS_EXTENSIONS = [
  "postgis",
  "postgis_raster",
  "postgis_topology",
  "postgis_sfcgal",
] as const;

/** Extensions PostGIS 3.7 stopped shipping; reported if left installed. */
export const ORPHANABLE_EXTENSIONS = [
  "postgis_tiger_geocoder",
  "address_standardizer",
  "address_standardizer_data_us",
] as const;

export interface ExtensionRow {
  name: string;
  installed_version: string;
  /** NULL when the image no longer ships a control file for this extension. */
  default_version: string | null;
}

export interface QueryClient {
  query<R>(sql: string): Promise<{ rows: R[] }>;
}

export interface UpgradeResult {
  upgraded: { name: string; from: string; to: string }[];
  orphaned: { name: string; installedVersion: string }[];
}

type Logger = Pick<Console, "log" | "warn">;

const TRACKED = [...POSTGIS_EXTENSIONS, ...ORPHANABLE_EXTENSIONS];

export const INSTALLED_EXTENSIONS_SQL = `
  SELECT e.extname AS name,
         e.extversion AS installed_version,
         a.default_version
  FROM pg_extension e
  LEFT JOIN pg_available_extensions a ON a.name = e.extname
  WHERE e.extname IN (${TRACKED.map((n) => `'${n}'`).join(", ")})
`;

export async function upgradePostgisExtensions(
  client: QueryClient,
  logger: Logger = console
): Promise<UpgradeResult> {
  const { rows } = await client.query<ExtensionRow>(INSTALLED_EXTENSIONS_SQL);
  const result: UpgradeResult = { upgraded: [], orphaned: [] };

  const order = (name: string) => {
    const i = (POSTGIS_EXTENSIONS as readonly string[]).indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sorted = [...rows].sort((a, b) => order(a.name) - order(b.name));

  for (const row of sorted) {
    if (row.default_version === null) {
      result.orphaned.push({ name: row.name, installedVersion: row.installed_version });
      logger.warn(
        `[postgis] extension "${row.name}" ${row.installed_version} is installed but this ` +
          "image no longer ships it — not upgraded (unused by the app; drop it manually if desired)"
      );
      continue;
    }
    if (!(POSTGIS_EXTENSIONS as readonly string[]).includes(row.name)) continue;
    if (row.default_version === row.installed_version) continue;

    logger.log(
      `[postgis] ALTER EXTENSION ${row.name} UPDATE: ${row.installed_version} -> ${row.default_version}`
    );
    // Name comes from the fixed allowlist above, never from input.
    await client.query(`ALTER EXTENSION ${row.name} UPDATE`);
    result.upgraded.push({
      name: row.name,
      from: row.installed_version,
      to: row.default_version,
    });
  }

  if (result.upgraded.length === 0) {
    logger.log("[postgis] extensions already at the image's default versions");
  }
  return result;
}
