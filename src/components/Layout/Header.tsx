"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/modules/auth/components/UserMenu";
import { SyncStatus } from "@/modules/sync/components/SyncStatus";
import { SyncButton } from "@/modules/sync/components/SyncButton";
import { MobileNav } from "./MobileNav";
import { Settings, Home } from "lucide-react";

interface HeaderProps {
  showSync?: boolean;
  onSyncStarted?: () => void;
}

export function Header({ showSync = true, onSyncStarted }: HeaderProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "타임라인", icon: Home },
    { href: "/settings", label: "설정", icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* 로고 & 모바일 네비게이션 */}
        <div className="flex items-center gap-2">
          <MobileNav items={navItems} />
          <Link href="/" className="font-semibold text-lg">
            Cistory
          </Link>
        </div>

        {/* 데스크톱 네비게이션 */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Button
              key={item.href}
              variant={pathname === item.href ? "secondary" : "ghost"}
              size="sm"
              asChild
            >
              <Link href={item.href}>
                <item.icon className="h-4 w-4 mr-2" />
                {item.label}
              </Link>
            </Button>
          ))}
        </nav>

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
