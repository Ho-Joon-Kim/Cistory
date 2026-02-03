"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommitHeatmap } from "@/components/CommitHeatmap";
import { UserMenu } from "@/modules/auth/components/UserMenu";
import { SyncStatus } from "@/modules/sync/components/SyncStatus";
import { SyncButton } from "@/modules/sync/components/SyncButton";

interface HeaderProps {
  showSync?: boolean;
  onSyncStarted?: () => void;
  actions?: ReactNode;
}

export function Header({ showSync = true, onSyncStarted, actions }: HeaderProps) {
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
          {actions}
          {showSync && (
            <>
              <div className="hidden sm:block">
                <SyncStatus />
              </div>
              <SyncButton
                size="icon"
                variant="ghost"
                onSyncStarted={onSyncStarted}
              />
            </>
          )}
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
