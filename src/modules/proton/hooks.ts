"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "@/lib/auth-client";
import type { ConnectStatus } from "./connection";
import type { ProtonSummary } from "./summary";
import { PROTON_ERRORS } from "./types";

export type { ConnectStatus, ProtonSummary };

export const PROTON_STATUS_POLL_MS = 5000;

/** Poll only while the Proton fork is pending; every other state is terminal. */
export function nextPollDelay(status: ConnectStatus | undefined): number | false {
  return status?.status === "pending" ? PROTON_STATUS_POLL_MS : false;
}

/**
 * Whether a sign-in fork is open: started on this page load, a first connect
 * (`pending` row), or a reconnect from `active`/`needs_reauth` that only the
 * summary's `forkPending` reveals after a reload.
 */
export function isForkPending(
  fork: StartConnectResult | null,
  summary: Pick<ProtonSummary, "status" | "forkPending"> | null | undefined
): boolean {
  return fork !== null || summary?.status === "pending" || summary?.forkPending === true;
}

async function requestJson<T>(url: string, init: RequestInit, failure: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : failure);
  }
  return response.json() as Promise<T>;
}

export interface StartConnectResult {
  signInUrl: string;
  expiresAt: string;
}

export function useProtonConnection() {
  const { data: session } = useSession();
  const client = useQueryClient();
  const sessionId = session?.session.id;
  const enabled = !!session?.user.id;
  const summaryKey = ["proton", sessionId, "summary"] as const;
  const [fork, setFork] = useState<StartConnectResult | null>(null);

  const summaryQuery = useQuery({
    queryKey: summaryKey,
    enabled,
    queryFn: ({ signal }) =>
      requestJson<ProtonSummary>("/api/proton", { signal }, PROTON_ERRORS.summaryFailed),
    staleTime: 30_000,
  });

  // A reload while the user is still on Proton's page must keep polling.
  const forkPending = isForkPending(fork, summaryQuery.data);

  const pollStatus = useQuery({
    queryKey: ["proton", sessionId, "connect-status"] as const,
    enabled: enabled && forkPending,
    queryFn: async ({ signal }) => {
      const status = await requestJson<ConnectStatus>(
        "/api/proton/connect/status",
        { signal, cache: "no-store" },
        PROTON_ERRORS.connectFailed
      );
      if (status.status !== "pending") {
        setFork(null);
        await client.invalidateQueries({ queryKey: summaryKey });
      }
      return status;
    },
    refetchInterval: (query) => nextPollDelay(query.state.data),
    staleTime: 0,
    gcTime: 0,
  });

  const startMutation = useMutation({
    mutationFn: () =>
      requestJson<StartConnectResult>(
        "/api/proton/connect",
        { method: "POST" },
        PROTON_ERRORS.connectFailed
      ),
    onSuccess: (result) => {
      setFork(result);
      void client.invalidateQueries({ queryKey: ["proton", sessionId, "connect-status"] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () =>
      requestJson<{ success: true; revoked: boolean; notice?: string }>(
        "/api/proton",
        { method: "DELETE" },
        PROTON_ERRORS.disconnectFailed
      ),
    onSuccess: () => {
      setFork(null);
      void client.invalidateQueries({ queryKey: ["proton", sessionId] });
    },
  });

  return {
    summary: summaryQuery.data ?? null,
    isLoading: summaryQuery.isLoading,
    loadError: summaryQuery.error?.message ?? null,
    /** Sign-in URL from this page load's `start()`; unrecoverable after a reload. */
    fork,
    forkPending,
    pollStatus,
    isStarting: startMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
    start: () => startMutation.mutateAsync(),
    disconnect: async (): Promise<{ notice?: string }> => {
      const { notice } = await disconnectMutation.mutateAsync();
      return { notice };
    },
  };
}
