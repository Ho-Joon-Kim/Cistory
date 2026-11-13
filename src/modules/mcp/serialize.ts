/**
 * Allowlist output serializer for MCP tools.
 *
 * A tool declares, per output object, exactly which fields leave the server.
 * Anything not declared is dropped — a column added to a table later can't
 * leak through a tool that spreads a row. Fields may be marked sensitive:
 * without the `sensitive-read` scope they are masked (`"•••"`) or omitted,
 * optionally only for rows a predicate selects (U7 uses that for the
 * counterparty name of personal transfers). Dates are rendered as ISO 8601
 * with `+09:00`.
 *
 * Credentials (app keys, tokens) must simply never be declared: there is no
 * scope that reveals an undeclared field.
 */

import type { McpScope } from "@/db/schema";
import { toKstIso } from "./time";

export const MASK = "•••";

export type SensitiveMode = "mask" | "omit";

export interface FieldSpec<Row> {
  /** Source property on the row (defaults to the output key). */
  from?: keyof Row & string;
  /** Transform the value before the sensitive/Date handling. */
  map?: (value: unknown, row: Row) => unknown;
  /** Hidden unless the caller may read sensitive data. */
  sensitive?: SensitiveMode;
  /** Apply `sensitive` only to rows where this returns true (default: every row). */
  sensitiveWhen?: (row: Row) => boolean;
}

/** `true` = copy the same-named property as-is. */
export type FieldRule<Row> = true | FieldSpec<Row>;

export type Allowlist<Row> = Record<string, FieldRule<Row>>;

export interface SerializeAccess {
  /** The token holds `sensitive-read`. */
  sensitive: boolean;
}

export function accessFromScopes(scopes: readonly McpScope[]): SerializeAccess {
  return { sensitive: scopes.includes("sensitive-read") };
}

/** `"•••"` for any present value; null/undefined stay null (absence isn't a secret). */
export function mask(value: unknown): string | null {
  return value === null || value === undefined ? null : MASK;
}

/** Recursively render Dates as `+09:00` ISO strings and undefined as null. */
export function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toKstIso(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (inner !== undefined) out[key] = toJsonValue(inner);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function serializeRow<Row extends object>(
  row: Row,
  allowlist: Allowlist<Row>,
  access: SerializeAccess
): Record<string, unknown> {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(allowlist)) {
    const spec: FieldSpec<Row> = rule === true ? {} : rule;
    let value = source[spec.from ?? key];
    if (spec.map) value = spec.map(value, row);
    if (spec.sensitive && !access.sensitive && (spec.sensitiveWhen?.(row) ?? true)) {
      if (spec.sensitive === "omit") continue;
      out[key] = mask(value);
      continue;
    }
    out[key] = toJsonValue(value);
  }
  return out;
}

export function serializeRows<Row extends object>(
  rows: readonly Row[],
  allowlist: Allowlist<Row>,
  access: SerializeAccess
): Record<string, unknown>[] {
  return rows.map((row) => serializeRow(row, allowlist, access));
}

/** Every field an allowlist can ever emit (for snapshot/allowlist tests). */
export function allowlistFields<Row>(allowlist: Allowlist<Row>): string[] {
  return Object.keys(allowlist);
}

/** Fields that need `sensitive-read` (for tests and documentation). */
export function sensitiveFields<Row>(allowlist: Allowlist<Row>): string[] {
  return Object.entries(allowlist)
    .filter(([, rule]) => rule !== true && rule.sensitive)
    .map(([key]) => key);
}
