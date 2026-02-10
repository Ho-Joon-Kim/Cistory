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
    <header className="relative z-50 pointer-events-none h-14 px-4 flex items-center justify-between">
      {/* Left: Logo + Heatmap */}
      <div className="flex items-center gap-3 pointer-events-auto dark:bg-background/30 dark:backdrop-blur-md rounded-full px-3 py-1">
        <Link
          href="/"
          className="uppercase tracking-[0.3em] font-light text-sm text-foreground dark:text-[#5CAACC] dark:drop-shadow-[0_0_8px_rgba(92,170,204,0.5)]"
        >
          Cistory
        </Link>
        <div className="hidden md:block">
          <CommitHeatmap />
        </div>
      </div>

      {/* Right: Action pills */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <div className="flex items-center gap-2 dark:bg-background/30 dark:backdrop-blur-md rounded-full px-2 py-1">
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
