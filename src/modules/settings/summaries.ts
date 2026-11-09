"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";

export interface SummaryCounts {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

/** Commit-summary status counts, shared by the todo item and the AI 요약 panel. */
export function useSummaryCounts() {
  const { data: session } = useSession();
  return useQuery<SummaryCounts>({
    queryKey: ["summary-stats", session?.session.id],
    enabled: !!session,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/summaries/process", { signal });
      if (!response.ok) throw new Error("요약 상태를 불러오지 못했습니다.");
      return response.json();
    },
  });
}

/** Re-queue every failed summary (fresh retry budget) and run them. */
export function useRetryFailedSummaries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/summaries/retry-failed", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        requeued?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "요약을 다시 시도하지 못했습니다.");
      return body.requeued ?? 0;
    },
    onSuccess: (requeued) => {
      toast.success(
        requeued > 0
          ? `실패한 요약 ${requeued.toLocaleString("ko-KR")}건을 다시 만들고 있어요.`
          : "다시 시도할 요약이 없어요."
      );
      void client.invalidateQueries({ queryKey: ["summary-stats"] });
      // The run happens after the response; check back once it has had time.
      setTimeout(() => void client.invalidateQueries({ queryKey: ["summary-stats"] }), 8000);
    },
    onError: (error) => toast.error(error.message),
  });
}

/** Completion share with one decimal that never rounds an unfinished set up to 100%. */
export function completionText(completed: number, total: number): string {
  if (total === 0) return "0%";
  const pct = Math.floor((completed / total) * 1000) / 10;
  return `${pct.toFixed(1)}%`;
}
