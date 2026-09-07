"use client";

import { Activity, LayoutDashboard, PieChart, Plane, Search, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommitHeatmap } from "@/components/CommitHeatmap";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/modules/auth/components/UserMenu";
import { SyncButton } from "@/modules/sync/components/SyncButton";
import { SyncStatus } from "@/modules/sync/components/SyncStatus";
import { HEADER_NAV_ITEMS } from "./header-nav";

interface HeaderProps {
  showSync?: boolean;
  onSyncStarted?: () => void;
}

export function Header({ showSync = true, onSyncStarted }: HeaderProps) {
  const pathname = usePathname();
  const icons = {
    spending: Wallet,
    portfolio: PieChart,
    travel: Plane,
    health: Activity,
    overview: LayoutDashboard,
    search: Search,
  };

  return (
    <header className="shrink-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 flex flex-wrap items-center justify-between gap-x-3 sm:h-14 sm:flex-nowrap">
        {/* 로고 */}
        <div className="flex h-14 shrink-0 items-center gap-4">
          <Link href="/" className="font-semibold text-lg">
            Cistory
          </Link>
          {/* 30일 커밋 히트맵 */}
          <div className="hidden xl:block">
            <CommitHeatmap />
          </div>
        </div>

        {/* 액션 버튼들 */}
        <nav
          aria-label="주요 메뉴"
          className="order-last flex w-full justify-between border-t py-1 sm:order-none sm:ml-auto sm:w-auto sm:justify-start sm:gap-1 sm:border-0 sm:py-0 lg:gap-2"
        >
          {HEADER_NAV_ITEMS.map((item) => {
            const Icon = icons[item.id];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded px-2 text-sm transition-colors ${
                  active
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {showSync && (
            <>
              <div className="hidden lg:block">
                <SyncStatus />
              </div>
              <SyncButton size="icon" variant="ghost" onSyncStarted={onSyncStarted} />
            </>
          )}
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
