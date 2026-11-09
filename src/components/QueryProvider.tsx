"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { INITIAL_QUERY_SCOPE, nextQueryScope } from "./query-scope";

function SessionQueries({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Remount the cache at every authentication boundary, including a new session
 * for the same user — but not when the first session request settles (see
 * nextQueryScope), which used to abort and refetch every query on page load.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  const identity = isPending && !data ? undefined : (data?.session.id ?? "anonymous");
  const [scope, setScope] = useState(INITIAL_QUERY_SCOPE);
  const next = nextQueryScope(scope, identity);
  if (next !== scope) setScope(next);
  return <SessionQueries key={next.generation}>{children}</SessionQueries>;
}
