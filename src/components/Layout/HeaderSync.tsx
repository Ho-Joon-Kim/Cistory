"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { SyncButton } from "@/modules/sync/components/SyncButton";
import { SyncStatusProvider, useOptionalSyncStatus, useSyncStatus } from "@/modules/sync/hooks";

/** Re-renders every 30s so "35분 전" keeps up without a new status event. */
function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function SyncText({ short = false }: { short?: boolean }) {
  const { status } = useSyncStatus();
  const now = useNow();
  if (!status || !now) return null;

  if (status.hasActiveSync) {
    const progress = status.activeJobs[0]?.progress ?? 0;
    return (
      <span className="mr-1.5 text-[0.8125rem] text-ink-3" aria-live={short ? undefined : "polite"}>
        동기화 중{progress > 0 ? <span className="num"> {progress}%</span> : null}
      </span>
    );
  }
  if (!status.lastSyncTime) return null;
  const last = new Date(status.lastSyncTime);
  return (
    <span
      className="mr-1.5 inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-3"
      title={formatDateTime(last, { now })}
    >
      {/* The phone bar shows just the time, as in the mobile mocks. */}
      {short ? null : <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />}
      {formatRelative(last, now)}
      {short ? null : " 동기화"}
    </span>
  );
}

function SyncCluster({ onSyncStarted, compact }: { onSyncStarted?: () => void; compact: boolean }) {
  return (
    <>
      {!compact && (
        <>
          {/* Phones (≥380px, where the row has room): just "34분 전". */}
          <span className="hidden min-[380px]:inline-flex lg:hidden">
            <SyncText short />
          </span>
          <span className="hidden xl:inline-flex">
            <SyncText />
          </span>
        </>
      )}
      <SyncButton size="icon" variant="ghost" onSyncStarted={onSyncStarted} />
    </>
  );
}

/**
 * Sync status (relative time) + refresh. Works on every page: when the page
 * hasn't mounted a SyncStatusProvider, the app bar brings its own.
 */
export function HeaderSync({
  onSyncStarted,
  compact = false,
}: {
  onSyncStarted?: () => void;
  compact?: boolean;
}) {
  const context = useOptionalSyncStatus();
  if (context) return <SyncCluster onSyncStarted={onSyncStarted} compact={compact} />;
  return (
    <SyncStatusProvider>
      <SyncCluster onSyncStarted={onSyncStarted} compact={compact} />
    </SyncStatusProvider>
  );
}
