import type { OverviewSnapshotResponse } from "./service";

export function shouldShowOverviewFailure(snapshot: OverviewSnapshotResponse): boolean {
  return (
    "domains" in snapshot &&
    // A stale snapshot is already being recomputed; its old failures are moot.
    !("stale" in snapshot) &&
    (snapshot.status === "failed" ||
      Object.values(snapshot.domains).some((domain) => domain?.status === "failed"))
  );
}
