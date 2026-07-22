import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ComputingStateProps {
  status: "loading" | "pending" | "computing" | "failed";
  error?: string | null;
  onRecompute?: () => void;
}

export function ComputingState({ status, error, onRecompute }: ComputingStateProps) {
  if (status === "failed") {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-xl border p-8 text-center"
      >
        <AlertCircle aria-hidden="true" className="size-6 text-destructive" />
        <div>
          <p className="font-medium">대시보드를 계산하지 못했습니다</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error ?? "잠시 후 다시 시도해 주세요."}
          </p>
        </div>
        {onRecompute ? (
          <Button type="button" variant="outline" size="sm" onClick={onRecompute}>
            <RefreshCw aria-hidden="true" className="size-4" />
            다시 계산
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <output
      aria-live="polite"
      className="flex items-center justify-center gap-3 rounded-xl border p-8 text-sm text-muted-foreground"
    >
      <Loader2 aria-hidden="true" className="size-5 animate-spin" />
      {status === "loading" ? "대시보드를 불러오는 중입니다" : "대시보드를 계산하는 중입니다"}
    </output>
  );
}
