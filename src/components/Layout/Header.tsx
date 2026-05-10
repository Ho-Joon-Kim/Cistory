"use client";

import { BarChart3, Lightbulb, PieChart, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommitHeatmap } from "@/components/CommitHeatmap";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/modules/auth/components/UserMenu";
import { SyncButton } from "@/modules/sync/components/SyncButton";
import { SyncStatus } from "@/modules/sync/components/SyncStatus";

interface HeaderProps {
  showSync?: boolean;
  onSyncStarted?: () => void;
}

export function Header({ showSync = true, onSyncStarted }: HeaderProps) {
  const pathname = usePathname();
  const isReportPage = pathname === "/report";
  const isSpendingPage = pathname === "/spending";
  const isInsightsPage = pathname === "/insights";
  const isPortfolioPage = pathname === "/portfolio";

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
          <Link
            href="/spending"
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              isSpendingPage
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wallet className="h-4 w-4" />
            <span className="hidden lg:inline">소비</span>
          </Link>
          <Link
            href="/portfolio"
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              isPortfolioPage
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PieChart className="h-4 w-4" />
            <span className="hidden lg:inline">포트폴리오</span>
          </Link>
          <Link
            href="/insights"
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              isInsightsPage
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Lightbulb className="h-4 w-4" />
            <span className="hidden lg:inline">인사이트</span>
          </Link>
          <Link
            href={isReportPage ? "/" : "/report"}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden lg:inline">{isReportPage ? "타임라인" : "보고서"}</span>
          </Link>
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
