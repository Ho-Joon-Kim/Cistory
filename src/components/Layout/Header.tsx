"use client";

import { LayoutDashboard, PieChart, Wallet } from "lucide-react";
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
    overview: LayoutDashboard,
  };

  return (
    <header className="shrink-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* 로고 */}
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold text-lg">
            Cistory
          </Link>
          {/* 30일 커밋 히트맵 */}
          <div className="hidden md:block">
            <CommitHeatmap />
          </div>
        </div>

        {/* 액션 버튼들 */}
        <div className="flex items-center gap-2 sm:gap-4">
          {HEADER_NAV_ITEMS.map((item) => {
            const Icon = icons[item.id];
            const active = pathname === item.href;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-1.5 text-sm transition-colors ${
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
