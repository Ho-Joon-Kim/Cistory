/**
 * Loading vs. empty for the /dashboard day view.
 *
 * Every source on the page is its own request, and a slow one used to read as
 * "nothing happened that day": the list said "이날 남은 기록이 없어요" and the map
 * "이날 위치 기록이 없어요" until the data arrived and replaced them. A section
 * may only claim emptiness once every request that could fill it has settled
 * (with data or with an error — a failure has its own message).
 */
export interface DayPending {
  locations: boolean;
  stayPoints: boolean;
  tracks: boolean;
  commits: boolean;
  transactions: boolean;
  /** /api/fitbit/summary: sleep rows, workouts, steps. */
  health: boolean;
  distances: boolean;
}

export type DayListState = "loading" | "rows" | "empty";

export interface DaySections {
  /** The timeline list: skeleton, rows, or the empty line. */
  list: DayListState;
  /** The map may not show its "no location records" pill yet. */
  mapLoading: boolean;
  /**
   * The summary line, AI fact and body row are complete. They are held back
   * until then so they appear once instead of assembling item by item (and so
   * their count-ups run once, from the settled values).
   */
  summaryReady: boolean;
}

export function daySections(pending: DayPending, rowCount: number): DaySections {
  // Places, rides, commits and payments are the list's backbone; sleep (health)
  // only adds rows under them, so a slow health request alone doesn't hold
  // back rows that are already there — but it does hold back "empty".
  const coreLoading =
    pending.stayPoints || pending.tracks || pending.commits || pending.transactions;
  const list: DayListState = coreLoading
    ? "loading"
    : rowCount > 0
      ? "rows"
      : pending.health
        ? "loading"
        : "empty";
  return {
    list,
    mapLoading: pending.locations || pending.stayPoints,
    summaryReady: !coreLoading && !pending.health && !pending.distances && !pending.locations,
  };
}
