export function resultRows(result: unknown): Record<string, unknown>[] {
  const value = result as { rows?: unknown[] } | null;
  return Array.isArray(value?.rows) ? (value.rows as Record<string, unknown>[]) : [];
}

export function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
