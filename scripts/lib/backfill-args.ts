/**
 * Shared CLI argument parsing for the `backfill-*.ts` operational scripts
 * (backfill-tracks.ts, backfill-subway-matches.ts). Both take the exact same
 * `<userId> <fromDate> <toDate> [--dry-run]` shape and both regenerate real
 * data for real users, so the strict argument safety lives here once instead
 * of being duplicated (and potentially drifting) per script.
 */

import { parseDateLocal } from "../../src/lib/utils";

export interface ParsedArgs {
  userId: string;
  fromDate: string;
  toDate: string;
  dryRun: boolean;
}

export interface ParseError {
  error: string;
}

/**
 * Parses raw CLI argv (already sliced past `node script.js`) into the three
 * positionals plus the --dry-run flag, or an error.
 *
 * This is deliberately strict: these scripts are about to regenerate real
 * data, so a typo'd `--dry-run` (e.g. `--dryrun`, `-dry-run`, `--Dry-Run`, or
 * a stray-whitespace `" --dry-run"`) must be a loud parse error, never a
 * silent live run. Any token starting with "-" that isn't exactly
 * "--dry-run" is rejected, and anything left over — including a mistyped
 * flag that didn't start with "-" — must leave exactly 3 positionals or this
 * fails too.
 */
export function parseArgs(rawArgv: string[]): ParsedArgs | ParseError {
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

  if (unknownFlags.length > 0) {
    return {
      error: `Unrecognised argument(s): ${unknownFlags.map((a) => JSON.stringify(a)).join(", ")}. The only supported flag is exactly "--dry-run".`,
    };
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
