import { cn } from "@/lib/utils";

/** Stroke icon paths for every collected source (24-unit viewBox). */
export const SOURCE_ICON_PATHS = {
  wakatime: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  health: "M22 12h-4l-3 9L9 3l-3 9H2",
  github: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6M15 12h6",
  location: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  toss: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  kis: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  withings:
    "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 10a5 5 0 0 1 7 0l-2.2 2.5h-2.6z",
  heart:
    "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z",
  alert: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  card: "M2 7h20v12H2zM2 11h20M6 15h4",
  trip: "M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
} as const;

export type SourceIconName = keyof typeof SOURCE_ICON_PATHS;

/** 32px sunken tile holding a 16px stroke icon (the mockups' `.tile`). */
export function SourceTile({
  icon,
  className,
  dot,
}: {
  icon: SourceIconName;
  className?: string;
  /** Optional 6px corner dot color (CSS color), e.g. the search result kind. */
  dot?: string;
}) {
  return (
    <span
      className={cn(
        "relative grid size-8 flex-none place-items-center rounded-[9px] bg-sunken text-ink-2",
        className
      )}
    >
      <SourceGlyph icon={icon} />
      {dot ? (
        <span
          aria-hidden="true"
          className="absolute -top-px -right-px size-1.5 rounded-full"
          style={{ background: dot }}
        />
      ) : null}
    </span>
  );
}

export function SourceGlyph({ icon, size = 16 }: { icon: SourceIconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={SOURCE_ICON_PATHS[icon]} />
    </svg>
  );
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "flex-none text-ink-3 transition-[rotate] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none [[aria-expanded=true]_&]:rotate-180",
        className
      )}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Height-animated disclosure body (grid-rows 0fr → 1fr). Content stays mounted
 * so its own state survives closing; `inert` keeps it out of the tab order.
 */
export function Disclosure({
  open,
  id,
  children,
  className,
}: {
  open: boolean;
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-opacity",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
