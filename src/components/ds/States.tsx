import type { ReactNode } from "react";
import { sameErrorCopy, userErrorMessage } from "@/lib/user-error";
import { cn } from "@/lib/utils";

/** Titles are labels, not sentences: no trailing period ("…없어요", not "…없어요."). */
function titleText(title: ReactNode): ReactNode {
  return typeof title === "string" ? title.replace(/\s*\.$/, "") : title;
}

/**
 * Missing data is never drawn as 0. Empty: a neutral icon tile, a title that
 * names what is missing, one sentence on why, and one action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2.5", className)}>
      {icon ? (
        <span className="grid size-8 place-items-center rounded-control bg-sunken text-ink-2 [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="text-[15px] leading-[22px] font-semibold text-ink">{titleText(title)}</span>
      {description ? <span className="text-[13px] leading-5 text-ink-2">{description}</span> : null}
      {action ? <div className="mt-1 flex gap-2">{action}</div> : null}
    </div>
  );
}

const ERROR_TITLE_FALLBACK = "문제가 생겼어요";

/**
 * Error: red title with a stroke alert icon, what failed and since when, then actions.
 *
 * Raw error text never renders: string titles/descriptions and `error` all pass
 * through {@link userErrorMessage} (Korean kept, a network TypeError mapped,
 * anything else replaced), and a description that only repeats the title is dropped.
 * Pass the caught value as `error` and a fixed Korean `title` naming what failed.
 */
export function ErrorState({
  title,
  description,
  error,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The caught value; becomes the description (sanitized) when none is given. */
  error?: unknown;
  actions?: ReactNode;
  className?: string;
}) {
  const shownTitle =
    typeof title === "string" ? titleText(userErrorMessage(title, ERROR_TITLE_FALLBACK)) : title;
  let shownDescription: ReactNode =
    typeof description === "string"
      ? userErrorMessage(description)
      : (description ?? (error !== undefined ? userErrorMessage(error) : null));
  if (
    typeof shownTitle === "string" &&
    typeof shownDescription === "string" &&
    sameErrorCopy(shownTitle, shownDescription)
  ) {
    shownDescription = null;
  }
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2.5", className)}>
      <span className="flex items-center gap-2 text-[15px] leading-[22px] font-semibold text-danger">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5" />
          <path d="M12 16.2v.3" />
        </svg>
        {shownTitle}
      </span>
      {shownDescription ? (
        <span className="text-[13px] leading-5 text-ink-2">{shownDescription}</span>
      ) : null}
      {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const SKELETON_BARS = [40, 62, 35, 80, 55, 90, 48, 70, 30, 66, 52, 84, 44, 58];

/**
 * Loading in the shape of what's coming (label · hero number · bars, or rows).
 * Hidden for the first 300ms so fast loads never flash a skeleton.
 */
export function LoadingState({
  variant = "kpi",
  rows = 4,
  label = "불러오는 중",
  className,
}: {
  variant?: "kpi" | "rows" | "block";
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("ds-delayed-in flex flex-col gap-2.5", className)}
    >
      {variant === "kpi" ? (
        <>
          <span className="h-3 w-30 rounded bg-track" />
          <span className="h-9 w-45 rounded-md bg-track" />
          <span className="flex h-14 items-end gap-1">
            {SKELETON_BARS.map((h, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                key={i}
                className="flex-1 rounded-t-[3px] bg-track"
                style={{ height: `${h}%` }}
              />
            ))}
          </span>
        </>
      ) : variant === "rows" ? (
        Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <span key={i} className="flex items-center gap-3 border-b border-line py-2.5">
            <span className="size-8 rounded-control bg-track" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="h-3 w-2/5 rounded bg-track" />
              <span className="h-2.5 w-1/4 rounded bg-track" />
            </span>
            <span className="h-3 w-16 rounded bg-track" />
          </span>
        ))
      ) : (
        <span className="h-40 w-full rounded-xl bg-track" />
      )}
    </div>
  );
}
