"use client";

import { type ReactNode, useId, useState } from "react";
import type { EvidenceState } from "@/components/ds";
import { cn } from "@/lib/utils";

/**
 * A ranked list row: share bar behind the name, value and a trailing column on
 * the right, a hairline under it. A row with members expands (chevron button)
 * into an indented member list.
 */
export function RankRow({
  name,
  shortName,
  sub,
  flag,
  flagTone = "place",
  value,
  trailing,
  share,
  members,
  current,
  evidence,
  columns = "minmax(0,1fr) auto 64px",
}: {
  name: string;
  /** Shorter name below sm ("대전 · 12곳"). */
  shortName?: string;
  sub?: string;
  flag?: string | null;
  flagTone?: "place" | "warn";
  value: ReactNode;
  trailing?: ReactNode;
  share: number;
  members?: { name: string; value: string; flag?: string | null }[] | null;
  current?: boolean;
  evidence?: EvidenceState;
  columns?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const content = (
    <>
      {shortName && shortName !== name ? (
        <>
          <span title={name} className="max-w-full truncate sm:hidden">
            {shortName}
          </span>
          <span title={name} className="hidden max-w-full truncate sm:inline">
            {name}
          </span>
        </>
      ) : (
        <span title={name} className="max-w-full truncate">
          {name}
        </span>
      )}
      {sub ? <span className="shrink-0 truncate text-xs text-ink-3">{sub}</span> : null}
      {flag ? <Flag tone={flagTone}>{flag}</Flag> : null}
    </>
  );
  return (
    <div
      data-evidence={evidence}
      className="relative grid min-h-10 items-center gap-x-4 border-b border-line text-sm"
      style={{ gridTemplateColumns: columns }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "ds-growx absolute top-1.5 left-0 h-7 rounded-[6px]",
          current || evidence === "on" ? "bg-brand-soft" : "bg-sunken"
        )}
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
      />
      {members?.length ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="group relative flex min-h-10 min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent py-0 pr-0 pl-2.5 text-left text-ink focus-visible:outline-2 focus-visible:outline-brand"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "shrink-0 text-ink-3 transition-[rotate] duration-150",
              open && "rotate-90"
            )}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 group-hover:[&>span:first-child]:underline group-hover:[&>span:first-child]:underline-offset-3">
            {content}
          </span>
        </button>
      ) : (
        <span className="relative flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 pl-2.5">
          {content}
        </span>
      )}
      <span className="num relative text-right">{value}</span>
      <span className="num relative text-right text-[13px] text-ink-3">{trailing}</span>
      {open && members?.length ? (
        <div
          id={id}
          className="ds-reveal relative col-span-full mb-2 ml-7 max-h-[168px] overflow-auto border-l border-line"
        >
          {members.map((m) => (
            <div
              key={m.name}
              className="flex justify-between gap-3 py-1 pl-3.5 text-[13px] leading-5 text-ink-2"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span title={m.name} className="max-w-full truncate">
                  {m.name}
                </span>
                {m.flag ? <Flag>{m.flag}</Flag> : null}
              </span>
              <span className="num shrink-0">{m.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Flag({
  children,
  tone = "place",
}: {
  children: ReactNode;
  tone?: "place" | "warn";
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[5px] text-xs leading-4 whitespace-nowrap text-ink-2">
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full"
        style={{ background: tone === "place" ? "var(--place)" : "var(--warn)" }}
      />
      {children}
    </span>
  );
}
