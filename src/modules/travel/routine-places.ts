/**
 * Saved places that are part of everyday life rather than a trip: home and the
 * office. The itinerary skips stays there (they become "집에서 출발" / "집 도착"
 * anchors) and the recurring-destination label never names them. Matching
 * follows trip detection's own home rule (`trip-home.ts`): an explicit
 * category, else the place name.
 */
const HOME_LABELS = new Set(["집", "home"]);
const WORK_LABELS = new Set(["회사", "직장", "사무실", "office", "work"]);

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

export function isHomePlace(name: string | null | undefined, category?: string | null): boolean {
  return HOME_LABELS.has(normalize(category)) || HOME_LABELS.has(normalize(name));
}

export function isWorkPlace(name: string | null | undefined, category?: string | null): boolean {
  return WORK_LABELS.has(normalize(category)) || WORK_LABELS.has(normalize(name));
}

/** Home or office — stays the itinerary folds away. */
export function isRoutinePlace(name: string | null | undefined, category?: string | null): boolean {
  return isHomePlace(name, category) || isWorkPlace(name, category);
}

/** Lower-cased labels for SQL `NOT IN` filters. */
export const ROUTINE_PLACE_LABELS = [...HOME_LABELS, ...WORK_LABELS];
