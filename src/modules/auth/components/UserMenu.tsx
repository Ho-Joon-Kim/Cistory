"use client";

import { LogOut, Settings, User } from "lucide-react";
import Link from "next/link";
import { menuItemTapClass } from "@/components/ds";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "../hooks";

export function UserMenu() {
  const { user, signOut, isLoading } = useAuth();

  if (isLoading || !user) {
    return null;
  }

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="계정 메뉴"
          className="relative size-9 rounded-full p-0 hover:bg-transparent"
        >
          <Avatar className="size-8 shadow-[inset_0_0_0_1px_var(--line)]">
            <AvatarImage src={user.image ?? undefined} alt={user.name} />
            <AvatarFallback className="bg-sunken text-xs font-semibold text-ink-2">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 max-w-[calc(100vw-1rem)]" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-snug break-words">{user.name}</p>
            {user.email && (
              <p className="text-xs leading-snug text-muted-foreground break-all">{user.email}</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/repositories" className={`cursor-pointer ${menuItemTapClass}`}>
            <User className="mr-2 h-4 w-4" />
            레포지토리
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className={`cursor-pointer ${menuItemTapClass}`}>
            <Settings className="mr-2 h-4 w-4" />
            설정
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={signOut}
          className={`cursor-pointer ${menuItemTapClass}`}
        >
          <LogOut className="mr-2 h-4 w-4" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
