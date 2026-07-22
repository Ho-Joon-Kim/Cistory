const DAY_MS = 86_400_000;

export function dateKeyToUtcMillis(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(millis).toISOString().slice(0, 10) === dateKey ? millis : null;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function getKstDateWindow(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const endExclusiveDate = shiftDateKey(endDate, 1);
  const end = new Date(`${endExclusiveDate}T00:00:00+09:00`);
  const dayCount = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  return { start, end, endExclusiveDate, dayCount };
}
