/**
 * Shared CLI argument parsing for the `backfill-*.ts` operational scripts
 * (backfill-tracks.ts, backfill-subway-matches.ts, backfill-visit-regions.ts).
 * The first two take `<userId> <fromDate> <toDate> [--dry-run]`;
 * backfill-visit-regions.ts operates over all of a user's data rather than a
 * date range, so it takes just `<userId> [--dry-run]`. All three regenerate
 * real data for real users, so the strict argument safety — reject anything
 * starting with "-" that isn't exactly "--dry-run", reject a leftover/missing
 * positional — lives here once instead of being duplicated (and potentially
 * drifting) per script.
 */

import { parseDateLocal } from "../../src/lib/utils";

export interface ParsedArgs {
  userId: string;
  fromDate: string;
  toDate: string;
  dryRun: boolean;
}

export interface ParsedUserIdArgs {
  userId: string;
  dryRun: boolean;
}

export interface ParseError {
  error: string;
}

/**
 * Splits raw argv into positionals and unknown flags, and detects the single
 * supported flag `--dry-run`. Shared by `parseArgs` (3 positionals) and
 * `parseUserIdArgs` (1 positional) so the "reject anything that isn't
 * exactly `--dry-run`" behaviour can't drift between the two shapes.
 *
 * This is deliberately strict: these scripts are about to regenerate real
 * data, so a typo'd `--dry-run` (e.g. `--dryrun`, `-dry-run`, `--Dry-Run`, or
 * a stray-whitespace `" --dry-run"`) must be a loud parse error, never a
 * silent live run. Any token starting with "-" that isn't exactly
 * "--dry-run" is rejected as an unknown flag.
 */
function splitFlagsAndPositionals(rawArgv: string[]): {
  positionals: string[];
  unknownFlags: string[];
  dryRun: boolean;
} {
  const positionals: string[] = [];
  const unknownFlags: string[] = [];
  let dryRun = false;

  for (const arg of rawArgv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("-")) {
      unknownFlags.push(arg);
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, unknownFlags, dryRun };
}

function unknownFlagsError(unknownFlags: string[]): ParseError {
  return {
    error: `Unrecognised argument(s): ${unknownFlags.map((a) => JSON.stringify(a)).join(", ")}. The only supported flag is exactly "--dry-run".`,
  };
}

/**
 * Parses raw CLI argv (already sliced past `node script.js`) into the three
 * positionals plus the --dry-run flag, or an error. Anything left over after
 * removing "--dry-run" — including a mistyped flag that didn't start with
 * "-" — must leave exactly 3 positionals or this fails too. See
 * `splitFlagsAndPositionals` for the shared flag-safety rules.
 */
export function parseArgs(rawArgv: string[]): ParsedArgs | ParseError {
  const { positionals, unknownFlags, dryRun } = splitFlagsAndPositionals(rawArgv);

  if (unknownFlags.length > 0) {
    return unknownFlagsError(unknownFlags);
  }

  if (positionals.length !== 3) {
    return {
      error: `Expected exactly 3 positional arguments (userId, fromDate, toDate), got ${positionals.length}: [${positionals.map((a) => JSON.stringify(a)).join(", ")}].`,
    };
  }

  const [userId, fromDate, toDate] = positionals;
  return { userId, fromDate, toDate, dryRun };
}

/**
 * Same shape and safety rules as `parseArgs`, but for scripts that take a
 * single `<userId>` positional instead of a `userId, fromDate, toDate`
 * triple — e.g. backfill-visit-regions.ts, which repairs all of a user's
 * `place_cache`/`visits` rows rather than a specific date range.
 */
export function parseUserIdArgs(rawArgv: string[]): ParsedUserIdArgs | ParseError {
  const { positionals, unknownFlags, dryRun } = splitFlagsAndPositionals(rawArgv);

  if (unknownFlags.length > 0) {
    return unknownFlagsError(unknownFlags);
  }

  if (positionals.length !== 1) {
    return {
      error: `Expected exactly 1 positional argument (userId), got ${positionals.length}: [${positionals.map((a) => JSON.stringify(a)).join(", ")}].`,
    };
  }

  const [userId] = positionals;
  return { userId, dryRun };
}

/**
 * Validates fromDate/toDate parse to real dates and produce a non-empty
 * range, returning the day list or an error. A reversed range (fromDate
 * after toDate) makes dateRange() return [], which otherwise reads as "zero
 * days needed backfilling" instead of "you swapped the arguments" — so an
 * empty result here is always an error, never a quiet success.
 */
export function resolveDateRange(fromDate: string, toDate: string): string[] | ParseError {
  if (!parseDateLocal(fromDate)) {
    return {
      error: `Invalid fromDate "${fromDate}" — could not parse as a date (expected YYYY-MM-DD).`,
    };
  }
  if (!parseDateLocal(toDate)) {
    return {
      error: `Invalid toDate "${toDate}" — could not parse as a date (expected YYYY-MM-DD).`,
    };
  }

  const dates = dateRange(fromDate, toDate);
  if (dates.length === 0) {
    return {
      error: `Date range fromDate="${fromDate}" toDate="${toDate}" produced 0 day(s). This usually means the arguments are reversed (fromDate is after toDate) — check the order.`,
    };
  }
  return dates;
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
        cursor.getDate()
      ).padStart(2, "0")}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
