import { Loader2 } from "lucide-react";

export function MapSkeleton() {
  return (
    <div
      role="status"
      className="h-full w-full bg-muted flex items-center justify-center rounded-lg"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">지도 불러오는 중…</span>
    </div>
  );
}
