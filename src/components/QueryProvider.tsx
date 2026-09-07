"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useSession } from "@/lib/auth-client";

function SessionQueries({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Remount the cache at every authentication boundary, including a new session for the same user. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { data } = useSession();
  return <SessionQueries key={data?.session.id ?? "anonymous"}>{children}</SessionQueries>;
}
