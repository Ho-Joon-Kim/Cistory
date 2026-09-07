"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import type { BodyResult } from "@/modules/insights/service";
import type { ActivityCorrelationDay, HealthSummary } from "./types";

export type { HealthDayPoint, HealthMetricSeries, HealthSummary } from "./types";

export async function requestHealthData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("건강 데이터를 불러오지 못했습니다.");
  return response.json() as Promise<T>;
}

function useHealthQuery<T>(section: string, url: string) {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["health", session?.session.id, section, url],
    enabled: !!session?.user.id,
    queryFn: ({ signal }) => requestHealthData<T>(url, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useHealthSummary() {
  const query = useHealthQuery<HealthSummary>("summary", "/api/fitbit/summary");
  const client = useQueryClient();
  return {
    summary: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => {
      void client.invalidateQueries({ queryKey: ["health"] });
    },
  };
}

export function useBody() {
  const year = new Date().getFullYear();
  const query = useHealthQuery<{ data: BodyResult }>(
    "body",
    `/api/insights?section=body&year=${year}`
  );
  return {
    data: query.data?.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => {
      void query.refetch();
    },
  };
}

export function useActivityCorrelation() {
  const query = useHealthQuery<{ days: ActivityCorrelationDay[] }>(
    "correlation",
    "/api/fitbit/activity-correlation"
  );
  return {
    days: query.data?.days ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => {
      void query.refetch();
    },
  };
}
