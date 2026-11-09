"use client";

import { toast } from "sonner";
import { LoadingState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { completionText, useRetryFailedSummaries, useSummaryCounts } from "../summaries";
import { PanelActions, PanelNote, PanelStats, PanelText } from "./panel";

/**
 * AI 요약 panel: where the commit summaries stand, with the one action that
 * matters for each state — run the queue (pending) or retry the failures
 * (failed rows have used up their automatic retries and stay put otherwise).
 */
export function SummaryStats() {
  const query = useSummaryCounts();
  const retry = useRetryFailedSummaries();
  const stats = query.data;

  if (query.isPending) {
    return <LoadingState variant="rows" rows={2} label="AI 요약 상태를 불러오는 중" />;
  }
  if (query.isError) {
    return (
      <PanelNote
        tone="gain"
        action={
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            다시 불러오기
          </Button>
        }
      >
        {query.error.message}
      </PanelNote>
    );
  }
  if (!stats || stats.total === 0) {
    return (
      <PanelText>동기화된 커밋이 없어요. 커밋이 들어오면 요약이 자동으로 만들어져요.</PanelText>
    );
  }

  const runQueue = async () => {
    const response = await fetch("/api/summaries/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    }).catch(() => null);
    if (response?.ok) {
      toast.success("대기 중인 요약을 만들기 시작했어요.");
      setTimeout(() => void query.refetch(), 5000);
    } else {
      toast.error("요약 생성을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const unsummarized =
    stats.total - stats.completed - stats.pending - stats.processing - stats.failed;
  return (
    <div className="flex flex-col gap-4">
      <PanelText>
        커밋 <span className="tabular-nums text-ink">{formatCount(stats.total)}</span>건 중{" "}
        <span className="font-semibold tabular-nums text-ink">
          {completionText(stats.completed, stats.total)}
        </span>
        의 요약이 만들어졌어요. 새 커밋은 10분마다 백그라운드에서 요약돼요.
      </PanelText>
      <PanelStats
        items={[
          { label: "완료", value: stats.completed },
          { label: "대기", value: stats.pending, tone: stats.pending ? "ink" : "muted" },
          { label: "처리 중", value: stats.processing, tone: stats.processing ? "ink" : "muted" },
          { label: "실패", value: stats.failed, tone: stats.failed ? "gain" : "muted" },
        ]}
      />
      {stats.failed > 0 ? (
        <PanelNote
          tone="gain"
          action={
            <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending ? "요청 중…" : `${formatCount(stats.failed)}건 다시 시도`}
            </Button>
          }
        >
          실패한 <span className="tabular-nums">{formatCount(stats.failed)}</span>건은 자동 재시도를
          모두 써서 더는 저절로 다시 만들지 않아요.
        </PanelNote>
      ) : null}
      {stats.pending > 0 ? (
        <PanelActions>
          <Button variant="outline" size="sm" onClick={runQueue}>
            대기 중인 {formatCount(stats.pending)}건 지금 만들기
          </Button>
        </PanelActions>
      ) : null}
      {unsummarized > 0 ? (
        <PanelText className="text-ink-3">
          요약 기록이 아직 없는 커밋{" "}
          <span className="tabular-nums">{formatCount(unsummarized)}</span>건은 다음 동기화 때
          대기열에 들어가요.
        </PanelText>
      ) : null}
    </div>
  );
}
