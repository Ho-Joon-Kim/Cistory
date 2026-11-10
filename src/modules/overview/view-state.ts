import type { OverviewSnapshotResponse } from "./service";

export function shouldShowOverviewFailure(snapshot: OverviewSnapshotResponse): boolean {
  return (
    "domains" in snapshot &&
    (snapshot.status === "failed" ||
      Object.values(snapshot.domains).some((domain) => domain?.status === "failed"))
  );
}

/**
 * How long the hero waits for the period history (comparisons, headline, mini
 * charts) after the snapshot is ready. Both requests start together, so history
 * is normally already there; past this the hero renders without it and the
 * comparisons fill in, rather than holding the page on a secondary request.
 */
export const HISTORY_GRACE_MS = 1_200;

/**
 * Re-read the history when the viewed period's snapshot is published while the
 * page is open (it was pending/computing, then became ready): the first history
 * read could not include it. A snapshot that was already ready on load is
 * already in the first read — refetching then made history a second, serial
 * request that always landed after the hero and re-laid it out.
 */
export function historyRefreshToken(sawUnready: boolean, computedAt: string | null): string | null {
  return sawUnready ? computedAt : null;
}

/** Render the overview body (instead of the loading state) once this holds. */
export function overviewBodyReady(input: {
  snapshotReady: boolean;
  historySettled: boolean;
  graceElapsed: boolean;
}): boolean {
  return input.snapshotReady && (input.historySettled || input.graceElapsed);
}
