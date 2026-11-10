import { ErrorState, LoadingState } from "@/components/ds";
import { cn } from "@/lib/utils";

interface ComputingStateProps {
  status: "loading" | "pending" | "computing" | "failed";
  error?: string | null;
  onRecompute?: () => void;
}

/** Loading / computing / failed states for a stored period snapshot. */
export function ComputingState({ status, error, onRecompute }: ComputingStateProps) {
  if (status === "failed") {
    return (
      <ErrorState
        title="이 기간을 계산하지 못했어요"
        description={error ?? "잠시 후 다시 시도해 주세요."}
        actions={
          onRecompute ? (
            <button
              type="button"
              onClick={onRecompute}
              className="inline-flex h-9 cursor-pointer items-center rounded-[9px] border-0 bg-surface px-3.5 text-[13px] font-semibold text-ink shadow-ring transition-[scale,box-shadow] duration-150 hover:shadow-ring-hover active:scale-96 focus-visible:outline-2 focus-visible:outline-brand"
            >
              다시 계산
            </button>
          ) : null
        }
      />
    );
  }

  const label = status === "loading" ? "개요를 불러오는 중" : "이 기간을 계산하는 중";
  return (
    <div className="flex flex-col gap-3">
      {status !== "loading" ? (
        <output aria-live="polite" className="text-[13px] leading-5 text-ink-2">
          이 기간을 계산하고 있어요. 끝나면 바로 보여드릴게요.
        </output>
      ) : null}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <LoadingState label={label} />
        <LoadingState label={label} className="hidden lg:flex" />
        <LoadingState label={label} className="hidden lg:flex" />
      </div>
    </div>
  );
}

/**
 * Inline note beside the period meta while a stale snapshot recomputes. The page
 * keeps showing the last computed numbers; this only says fresher ones are coming.
 */
export function UpdatingNote({ className }: { className?: string }) {
  return (
    <output
      aria-live="polite"
      data-testid="overview-updating"
      className={cn(
        "ds-reveal inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2",
        className
      )}
    >
      <span aria-hidden="true" className="size-1.5 flex-none animate-pulse rounded-full bg-brand" />
      최신 기록으로 업데이트하고 있어요
    </output>
  );
}
