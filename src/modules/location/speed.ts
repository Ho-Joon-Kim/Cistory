/** Convert parser-provided meters per second to the canonical stored km/h unit. */
export function metersPerSecondToKmh(metersPerSecond: number): number {
  return metersPerSecond * 3.6;
}
