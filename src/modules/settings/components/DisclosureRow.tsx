"use client";

import { type ReactNode, useState } from "react";
import { Chevron, Disclosure, type SourceIconName, SourceTile } from "@/components/ds";
import { cn } from "@/lib/utils";

/**
 * Embeds an existing settings card without its card chrome: the disclosure row
 * already names the item, so the card's own frame and title are dropped and its
 * description + controls read as the panel body.
 */
const BARE =
  "[&_[data-slot=card]]:gap-4 [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:py-0 [&_[data-slot=card]]:shadow-none [&_[data-slot=card-header]]:px-0 [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-footer]]:px-0 [&_[data-slot=card-title]]:sr-only [&_[data-slot=card-description]]:text-[13px] [&_[data-slot=card-description]]:leading-5 [&_[data-slot=card-description]]:text-ink-2";

export function DisclosureRow({
  id,
  title,
  meta,
  metaTone = "ink3",
  icon,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  metaTone?: "ink3" | "warn" | "danger";
  icon?: SourceIconName;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `settings-${id}`;
  // A closed panel is inert and collapsed, but its body still mounted — so every
  // card's on-mount fetch (the location dry run alone scans millions of points)
  // ran on page load for panels nobody opened. Mount on first open, then keep it
  // mounted so closing animates and the card keeps its state.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  return (
    <div className="scroll-mt-24 border-b border-line" id={`row-${id}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent text-left text-ink transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-brand",
          icon ? "min-h-[60px] py-3" : "py-3.5"
        )}
      >
        {icon ? <SourceTile icon={icon} /> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] leading-[22px] font-semibold">{title}</span>
          {meta ? (
            // Wraps instead of truncating: on a 320 row a cut "계정 …" had no way to be read.
            <span
              className={cn(
                "text-[13px] leading-[18px] text-pretty",
                metaTone === "warn"
                  ? "text-warn"
                  : metaTone === "danger"
                    ? "text-danger"
                    : "text-ink-3"
              )}
            >
              {meta}
            </span>
          ) : null}
        </span>
        {badge}
        <Chevron />
      </button>
      <Disclosure open={open} id={panelId}>
        <div className={cn("pb-5", icon && "pl-11", BARE)}>{everOpened ? children : null}</div>
      </Disclosure>
    </div>
  );
}
