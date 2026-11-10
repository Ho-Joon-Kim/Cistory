"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/modules/auth/components/UserMenu";
import { CommitGraph } from "./CommitGraph";
import { HeaderSync } from "./HeaderSync";
import {
  HEADER_NAV_ITEMS,
  isNavItemActive,
  NAV_FADE_PX,
  navEdges,
  navLeftFadeFor,
  navScrollLeftFor,
} from "./header-nav";

/** The strip's pills in scroll-content coordinates. */
function navPills(nav: HTMLElement): Array<{ left: number; width: number }> {
  const origin = nav.getBoundingClientRect().left - nav.scrollLeft;
  return Array.from(nav.querySelectorAll<HTMLElement>("a")).map((a) => ({
    left: a.getBoundingClientRect().left - origin,
    width: a.offsetWidth,
  }));
}

interface HeaderProps {
  /** Called after a manual sync was accepted (the timeline refreshes on it). */
  onSyncStarted?: () => void;
}

/**
 * The app bar shared by every page.
 *
 * PC (≥1024): one 64px row — serif wordmark + commit graph, the seven nav pills,
 * then sync status · refresh · theme · account on the right.
 * Mobile: row 1 (52px) wordmark + graph + refresh + theme + account; row 2
 * (44px) the same nav as a horizontally scrolling pill strip. The nav and the
 * sync cluster render once and are re-flowed with CSS order, so there is a
 * single navigation landmark and a single sync connection.
 */
export function Header({ onSyncStarted }: HeaderProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Mobile strip edges with hidden pills: those edges fade out (mask) so a pill
  // cut by the edge reads as "more this way", not as a clipped label.
  const [edges, setEdges] = useState({ left: false, right: false });
  const syncEdges = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const next = navEdges(nav);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    // Written straight to the element: it changes on every scroll frame.
    const left = navLeftFadeFor({ items: navPills(nav), scrollLeft: nav.scrollLeft });
    nav.style.setProperty("--nav-fade-left", `${left.fade}px`);
    nav.style.setProperty("--nav-clear-left", `${left.clear}px`);
  }, []);

  // Mobile: the pill strip scrolls horizontally; bring the current page's pill
  // into view with the least movement (no-op on PC, where the strip doesn't
  // overflow, and for pills that already show — the strip starts at the first tab).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every navigation
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = navScrollLeftFor({
        itemLeft:
          active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft,
        itemWidth: active.offsetWidth,
        viewportWidth: nav.clientWidth,
        scrollWidth: nav.scrollWidth,
        scrollLeft: nav.scrollLeft,
        items: navPills(nav),
      });
    }
    syncEdges();
  }, [pathname]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [syncEdges]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-pop focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        본문으로 건너뛰기
      </a>
      <header className="relative z-50 shrink-0 border-b border-line bg-page">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center lg:h-16 lg:flex-nowrap lg:gap-6 lg:px-page">
          <span className="flex h-[52px] shrink-0 items-center gap-2.5 pl-4 lg:h-auto lg:gap-3.5 lg:pl-0">
            <Link
              href="/dashboard"
              className="rounded-sm font-serif text-lg font-bold tracking-[-0.02em] text-ink lg:text-xl"
            >
              Cistory
            </Link>
            <CommitGraph />
          </span>

          <nav
            ref={navRef}
            aria-label="주요 메뉴"
            onScroll={syncEdges}
            data-fade-left={edges.left ? "" : undefined}
            data-fade-right={edges.right ? "" : undefined}
            style={{ "--nav-fade": `${NAV_FADE_PX}px` } as CSSProperties}
            className="ds-nav-strip order-last flex h-11 w-full items-center gap-0.5 overflow-x-auto px-4 [scrollbar-width:none] lg:order-none lg:h-auto lg:w-auto lg:gap-0.5 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {HEADER_NAV_ITEMS.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-8 flex-none items-center whitespace-nowrap rounded-lg px-3 text-sm transition-[background-color,color] duration-150 ease-out focus-ring focus-visible:outline-offset-0",
                    // 44px tall hit area on the mobile strip (the strip itself is 44).
                    "after:absolute after:inset-x-0 after:-inset-y-1.5 lg:after:hidden",
                    active
                      ? "bg-brand-soft font-semibold text-ink"
                      : "font-medium text-ink-2 hover:bg-track hover:text-ink"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ds-appbar-actions ml-auto flex items-center gap-2 pr-3 lg:gap-1 lg:pr-0">
            <HeaderSync onSyncStarted={onSyncStarted} />
            <ThemeToggle />
            <span className="inline-flex size-9 items-center justify-center lg:ml-1.5">
              <UserMenu />
            </span>
          </div>
        </div>
      </header>
    </>
  );
}
