"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/modules/auth/components/UserMenu";
import { SyncStatus } from "@/modules/sync/components/SyncStatus";
import { SyncButton } from "@/modules/sync/components/SyncButton";

interface HeaderProps {
  showSync?: boolean;
  onSyncStarted?: () => void;
}

export function Header({ showSync = true, onSyncStarted }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* 로고 */}
        <Link href="/" className="font-semibold text-lg">
          Cistory
        </Link>

        {/* 액션 버튼들 */}
        <div className="flex items-center gap-2 sm:gap-4">
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
