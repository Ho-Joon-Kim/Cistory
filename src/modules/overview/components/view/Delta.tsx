import { cn } from "@/lib/utils";
import type { Direction } from "@/modules/overview/view/hero";

function Arrow({ dir }: { dir: Exclude<Direction, null> }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink"
    >
      <path d={dir === "up" ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M5 12l7 7 7-7"} />
    </svg>
  );
}

/** "↑ 9월 4,415보다 6% 많음" — the comparison line under a figure (13/20, ink2). */
export function Delta({
  text,
  dir,
  className,
}: {
  text: string;
  dir: Direction;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[13px] leading-5 text-ink-2", className)}
    >
      {dir ? <Arrow dir={dir} /> : null}
      {dir ? <span className="sr-only">{dir === "up" ? "증가:" : "감소:"}</span> : null}
      <span>{text}</span>
    </span>
  );
}
