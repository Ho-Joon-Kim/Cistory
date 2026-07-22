import { Clock3 } from "lucide-react";

export function AsOfBadge({ computedAt }: { computedAt: string | null | undefined }) {
  if (!computedAt) return null;
  const date = new Date(computedAt);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <time
      dateTime={date.toISOString()}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
      title={`기준 시각 ${date.toLocaleString("ko-KR")}`}
    >
      <Clock3 aria-hidden="true" className="size-3" />
      {date.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
      기준
    </time>
  );
}
